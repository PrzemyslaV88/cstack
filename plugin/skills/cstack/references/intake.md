# Prepare an observable outcome

Use this reference for a rough request, a larger feature, or missing acceptance.
Discover the relevant interface, existing tests, project vocabulary and decisions.
Infer routine engineering choices from the repository. Ask only when an unresolved
behavior materially changes the result. Existing implementation authorization
covers preparation and execution; there is no generic approval pause.

Use the bundled controller:

```
CSTACK intake "Observable goal" --repo PROJECT --out NEW_PRIVATE_DIRECTORY
CSTACK intake compile --brief BRIEF_JSON --repo PROJECT --out NEW_PRIVATE_DIRECTORY
```

The first command creates a non-executable brief. Fill it from the request and
repository evidence. Each outcome contains `criterion`, `source` and `seam`:
`criterion` is an existing probe, supported test or genuinely manual criterion;
`source` identifies the requirement or independent example establishing the expected
result; `seam` names the public interface that exposes it. Never derive expected
values from the buggy implementation. Expected behavior that is unknown stays an
unresolved question, rather than a fabricated oracle or manual-only workaround.

Create tasks with `id`, `title`, `depends_on` and `criteria`. Each task delivers one
complete verifiable behavior. Use dependency edges only for real prerequisites.
For changes spanning interfaces, include the complete integration scenario and list
its required criterion IDs in `integration_criteria`. Place integration after the
implementation tasks it depends on. Compilation validates the existing task graph;
it does not execute checks or prove that a specification is correct.

Keep `non_goals`, `assumptions` and `decisions` compact. Reference large glossaries
and ADRs through selected project profile conventions. Record load-bearing user
corrections explicitly. Use `execution` for supported model, reasoning, policy,
budget, attempt limit and implementation paths. The `workflow` object selects the
versioned session policy; its limits are tuning settings, not measured model limits.

The compiled output is the existing acceptance input for `plan`. Planning captures
the baseline and freezes its source, environment, acceptance, workflow and brief.
Continue into the authorized implementation. A compiled brief is preparation,
never a completed FIX or FEATURE.

For larger uncertain work, keep the destination and milestones visible while
resolving the next material decision. Detail future implementation only when its
prerequisites are known. Stay within the requested scope. Changes to an executable
frozen task graph or acceptance require a new linked plan, never mutation of an
active contract. Do not use new runs or context resets to bypass a consumed budget.
