"""Controller-owned pytest 8.3.5 protocol. Candidate code runs only in scratch."""
import os, sys, json, pathlib, shutil, hashlib
PREFIX = 'CSTACK_TEST_EVENT '
def emit(kind, **values):
    print(PREFIX + json.dumps(dict(schema_version=1, kind=kind, **values), ensure_ascii=True), flush=True)
def inventory(root):
    result, size = [], 0
    for p in sorted(pathlib.Path(root).rglob('*')):
        name = p.relative_to(root).as_posix()
        if p.is_symlink(): result.append([name, 'symlink', os.readlink(p)])
        elif p.is_file():
            size += p.stat().st_size
            if size > 96 * 1024 * 1024 - 1048576: raise RuntimeError('SCRATCH_CAPACITY')
            result.append([name, 'file', hashlib.sha256(p.read_bytes()).hexdigest(), bool(p.stat().st_mode & 0o111)])
    return hashlib.sha256(json.dumps(result, separators=(',', ':')).encode()).hexdigest()
def main():
    spec = json.loads(sys.argv[1]); source = '/candidate'; dest = '/tmp/project'
    before = inventory(source)
    if os.path.lexists(source + '/node_modules'): raise RuntimeError('DEPENDENCY_PATH_COLLISION')
    shutil.copytree(source, dest, symlinks=True)
    after = inventory(dest)
    if before != after: raise RuntimeError('STAGING_INTEGRITY')
    os.chdir(dest); sys.path.insert(0, dest)
    os.environ['PYTEST_DISABLE_PLUGIN_AUTOLOAD'] = '1'
    os.environ.pop('PYTEST_ADDOPTS', None); os.environ.pop('PYTEST_PLUGINS', None)
    import pytest
    if pytest.__version__ != '8.3.5': raise RuntimeError('TEST_RUNNER_VERSION_UNSUPPORTED')
    class Reporter:
        def __init__(self): self.ids=[]; self.reports={}; self.errors=[]
        def pytest_collection_finish(self, session): self.ids=[i.nodeid for i in session.items]
        def pytest_collectreport(self, report):
            if report.failed: self.errors.append(str(report.longrepr))
        def pytest_internalerror(self, excrepr): self.errors.append(str(excrepr))
        def pytest_runtest_logreport(self, report): self.reports.setdefault(report.nodeid, []).append(report)
    reporter=Reporter()
    args=['-q','-p','no:cacheprovider','-o','addopts=','--rootdir='+dest]
    for plugin in spec['plugins']: args += ['-p',plugin]
    if spec['config']: args += ['-c',spec['config']]
    if spec['collect_only']: args += ['--collect-only']
    code=int(pytest.main(args + spec['roots'], plugins=[reporter]))
    emit('collection', ids=sorted(reporter.ids))
    counts={}
    for name in reporter.ids:
        reports=reporter.reports.get(name,[])
        if spec['collect_only']: outcome='todo'
        elif any(r.failed for r in reports): outcome='failed'
        elif any(hasattr(r,'wasxfail') for r in reports): outcome='xpass' if any(r.when=='call' and r.passed for r in reports) else 'xfail'
        elif any(r.skipped for r in reports): outcome='skipped'
        elif any(r.when=='call' and r.passed for r in reports) and any(r.when=='teardown' and r.passed for r in reports): outcome='passed'
        else: outcome='error'
        counts[outcome]=counts.get(outcome,0)+1; emit('case',id=name,outcome=outcome)
    for error in reporter.errors: emit('error',message=error[:6000])
    emit('complete',adapter='pytest',version=pytest.__version__,counts=counts,exit_status=code,staging_before=before,staging_after=after)
    return code
try: sys.exit(main())
except Exception as exc:
    emit('error',message=str(exc)[:6000]); sys.exit(2)
