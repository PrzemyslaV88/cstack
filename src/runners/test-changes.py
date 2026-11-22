"""Controller-owned static classifier for changed Python test files.

It parses source with the verifier interpreter's own grammar. It never imports,
executes or compiles candidate code for execution. Input arrives on stdin as
JSON {"files": [{"path", "baseline": base64 | null, "candidate": base64}]}.

A change to an existing test module is ADDITIVE only when:
  * every baseline module statement is still present, unchanged and in order
    (comments and formatting are ignored; anything else is a modification);
  * an existing test class may gain test methods, but its header and existing
    body statements are unchanged;
  * additions are only test functions, Test classes and plain imports;
  * no addition rebinds an existing module/class name or a builtin;
  * decorators on additions are pytest.mark.* markers only;
  * defaults, annotations and class bases on additions contain no calls,
    lambdas, comprehensions, walrus, await or yield;
  * at least one test is added.
Anything else is reported as a modification that needs human review.
"""
import ast, base64, builtins, copy, json, sys

BUILTINS = frozenset(dir(builtins))
ACTIVE = (ast.Call, ast.Lambda, ast.NamedExpr, ast.Await, ast.Yield, ast.YieldFrom,
          ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp)
FUNCTIONS = (ast.FunctionDef, ast.AsyncFunctionDef)


def dump(node):
    return ast.dump(node, include_attributes=False)


def header(node):
    clone = copy.copy(node)
    clone.body = []
    return dump(clone)


def subsequence(old, new):
    """Indices of `new` not consumed by `old` in order, or None if `old` is not a subsequence."""
    i, added = 0, []
    for j, key in enumerate(new):
        if i < len(old) and key == old[i]:
            i += 1
        else:
            added.append(j)
    return added if i == len(old) else None


def bound_names(body):
    names, star = set(), False
    for statement in body:
        for node in ast.walk(statement):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                names.add(node.name)
            elif isinstance(node, (ast.Import, ast.ImportFrom)):
                for alias in node.names:
                    if alias.name == '*':
                        star = True
                    else:
                        names.add((alias.asname or alias.name).split('.')[0])
            elif isinstance(node, ast.Name) and isinstance(node.ctx, (ast.Store, ast.Del)):
                names.add(node.id)
            elif isinstance(node, (ast.Global, ast.Nonlocal)):
                names.update(node.names)
        # Nested function/class bodies are separate scopes, but over-approximating
        # bound names only makes the rebinding rule stricter.
    return names, star


def inert(node):
    return node is None or not any(isinstance(child, ACTIVE) for child in ast.walk(node))


def pytest_marker(decorator):
    target = decorator.func if isinstance(decorator, ast.Call) else decorator
    return (isinstance(target, ast.Attribute) and isinstance(target.value, ast.Attribute)
            and target.value.attr == 'mark' and isinstance(target.value.value, ast.Name)
            and target.value.value.id == 'pytest')


def plain_pytest_import(body):
    """True when module name `pytest` is bound only by `import pytest`."""
    found = False
    for statement in body:
        for node in ast.walk(statement):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    bound = alias.asname or alias.name.split('.')[0]
                    if bound == 'pytest':
                        if alias.name != 'pytest' or alias.asname:
                            return False
                        found = True
            elif isinstance(node, ast.ImportFrom):
                if any((a.asname or a.name) == 'pytest' for a in node.names):
                    return False
            elif isinstance(node, ast.Name) and node.id == 'pytest' and isinstance(node.ctx, (ast.Store, ast.Del)):
                return False
            elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and node.name == 'pytest':
                return False
    return found


def function_problems(node, where, uses_marker):
    problems = []
    args = node.args
    for value in [*args.defaults, *args.kw_defaults]:
        if not inert(value):
            problems.append(f'{where}: default values must not call or compute at import time')
    for arg in [*args.posonlyargs, *args.args, *args.kwonlyargs, args.vararg, args.kwarg]:
        if arg is not None and not inert(arg.annotation):
            problems.append(f'{where}: annotations must not call or compute at import time')
    if not inert(node.returns):
        problems.append(f'{where}: return annotation must not call or compute at import time')
    for decorator in node.decorator_list:
        if not pytest_marker(decorator):
            problems.append(f'{where}: only pytest.mark.* decorators are allowed on added tests')
        else:
            uses_marker.append(where)
    return problems


def tests_in_class(node):
    return [f'{node.name}::{item.name}' for item in node.body
            if isinstance(item, FUNCTIONS) and item.name.startswith('test')]


def enumerate_tests(body):
    tests = []
    for node in body:
        if isinstance(node, FUNCTIONS) and node.name.startswith('test'):
            tests.append(node.name)
        elif isinstance(node, ast.ClassDef) and node.name.startswith('Test'):
            tests.extend(tests_in_class(node))
    return tests


def parse(source, path):
    return ast.parse(source, filename=path, type_comments=False)


def classify_existing(path, old_source, new_source):
    try:
        old = parse(old_source, path)
    except (SyntaxError, ValueError, RecursionError, MemoryError) as error:
        return {'status': 'unparsable', 'added_tests': [], 'reasons': [f'Baseline does not parse: {type(error).__name__}']}
    try:
        new = parse(new_source, path)
    except (SyntaxError, ValueError, RecursionError, MemoryError) as error:
        return {'status': 'unparsable', 'added_tests': [], 'reasons': [f'Candidate does not parse: {type(error).__name__}']}

    old_keys = [dump(s) for s in old.body]
    counts = {}
    for statement in old.body:
        if isinstance(statement, ast.ClassDef):
            counts[statement.name] = counts.get(statement.name, 0) + 1
    old_classes = {s.name: s for s in old.body if isinstance(s, ast.ClassDef) and counts[s.name] == 1}

    new_keys, extended = [], {}
    for index, statement in enumerate(new.body):
        key = dump(statement)
        original = old_classes.get(statement.name) if isinstance(statement, ast.ClassDef) else None
        if original is not None and key != dump(original) and header(original) == header(statement):
            inner = subsequence([dump(s) for s in original.body], [dump(s) for s in statement.body])
            if inner:
                key = dump(original)
                extended[index] = (original, [statement.body[i] for i in inner])
        new_keys.append(key)

    added = subsequence(old_keys, new_keys)
    if added is None:
        return {'status': 'modified', 'added_tests': [],
                'reasons': ['Existing module statements were changed, removed or reordered']}

    problems, tests, markers = [], [], []
    names, star = bound_names(old.body)
    builtins_or_names = names | BUILTINS
    new_names = set()

    def claim(name, where):
        if name in builtins_or_names:
            problems.append(f'{where}: rebinds an existing module name or builtin')
        elif name in new_names:
            problems.append(f'{where}: added twice')
        new_names.add(name)

    for index in added:
        statement = new.body[index]
        if isinstance(statement, (ast.Import, ast.ImportFrom)):
            where = f'line {statement.lineno} import'
            if star:
                problems.append(f'{where}: imports cannot be added to a module that uses star imports')
            if isinstance(statement, ast.ImportFrom) and statement.module == '__future__':
                problems.append(f'{where}: __future__ imports change module compilation')
            for alias in statement.names:
                if alias.name == '*':
                    problems.append(f'{where}: star imports are not additive')
                else:
                    claim((alias.asname or alias.name).split('.')[0], where)
        elif isinstance(statement, FUNCTIONS):
            where = f'{statement.name}'
            if not statement.name.startswith('test'):
                problems.append(f'{where}: added module functions must be tests (fixtures, hooks and helpers need review)')
            claim(statement.name, where)
            problems += function_problems(statement, where, markers)
            tests.append(statement.name)
        elif isinstance(statement, ast.ClassDef):
            where = statement.name
            if not statement.name.startswith('Test'):
                problems.append(f'{where}: added classes must be Test classes')
            claim(statement.name, where)
            for value in [*statement.bases, *(k.value for k in statement.keywords)]:
                if not inert(value):
                    problems.append(f'{where}: class bases must not call or compute at import time')
            for decorator in statement.decorator_list:
                if not pytest_marker(decorator):
                    problems.append(f'{where}: only pytest.mark.* decorators are allowed on added classes')
                else:
                    markers.append(where)
            for item in statement.body:
                if isinstance(item, FUNCTIONS):
                    problems += function_problems(item, f'{where}::{item.name}', markers)
                elif isinstance(item, ast.Pass) or (isinstance(item, ast.Expr) and isinstance(item.value, ast.Constant) and isinstance(item.value.value, str)):
                    continue
                else:
                    problems.append(f'{where}: added classes may contain only methods and a docstring')
            tests.extend(tests_in_class(statement))
        else:
            problems.append(f'line {statement.lineno}: added {type(statement).__name__} statements need review')

    for index, (original, items) in extended.items():
        if index in added:
            continue
        existing, _ = bound_names(original.body)
        for item in items:
            where = f'{original.name}::{getattr(item, "name", type(item).__name__)}'
            if not isinstance(item, FUNCTIONS) or not item.name.startswith('test'):
                problems.append(f'{where}: only test methods can be added to an existing class')
                continue
            if item.name in existing:
                problems.append(f'{where}: rebinds an existing class member')
            existing.add(item.name)
            problems += function_problems(item, where, markers)
            tests.append(f'{original.name}::{item.name}')

    if markers and not plain_pytest_import([*old.body, *(new.body[i] for i in added)]):
        problems.append('pytest.mark decorators require the module name pytest to come only from `import pytest`')
    if not added and not extended:
        problems.append('Only comments or formatting changed; no test was added')
    elif not tests:
        problems.append('No test was added')
    if problems:
        return {'status': 'modified', 'added_tests': [], 'reasons': sorted(set(problems))[:20]}
    return {'status': 'additive', 'added_tests': sorted(set(tests)), 'reasons': []}


def classify_added(path, new_source):
    try:
        new = parse(new_source, path)
    except (SyntaxError, ValueError, RecursionError, MemoryError) as error:
        return {'status': 'unparsable', 'added_tests': [], 'reasons': [f'Candidate does not parse: {type(error).__name__}']}
    return {'status': 'added-file', 'added_tests': sorted(set(enumerate_tests(new.body))), 'reasons': []}


def main():
    request = json.loads(sys.stdin.buffer.read())
    results = []
    for item in request['files']:
        path, candidate = item['path'], base64.b64decode(item['candidate'], validate=True)
        if item['baseline'] is None:
            result = classify_added(path, candidate)
        else:
            result = classify_existing(path, base64.b64decode(item['baseline'], validate=True), candidate)
        results.append({'path': path, **result})
    version = '.'.join(map(str, sys.version_info[:3]))
    sys.stdout.write(json.dumps({'schema_version': 1, 'python': version, 'files': results}, sort_keys=True))
    return 0


if __name__ == '__main__':
    sys.exit(main())
