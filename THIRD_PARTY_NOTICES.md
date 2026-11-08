# Adapted workflow guidance

Cstack's 0.6 request preparation, diagnosis, behavioral testing, interface design,
handoff, review and retrospective guidance is informed by Matt Pocock's skills:
https://github.com/mattpocock/skills/tree/4ae2317ddb22b046e26455e4f9c9b3aaaf62212d

Relevant upstream paths: `skills/engineering/{diagnosing-bugs,tdd,to-spec,to-tickets,
domain-modeling,codebase-design,code-review,retro}/SKILL.md` and
`skills/productivity/{handoff,writing-for-agents}/SKILL.md`.

The adaptation keeps Cstack's single worker, controller-owned evidence, offline
verification and human gates. It removes upstream automatic commits, issue
publication, mandatory generic confirmation and parallel-agent orchestration.
No upstream instructions are fetched dynamically during execution.

The upstream notice is retained in the distributed plugin at
`skills/cstack/references/matt-pocock-license.txt`:

MIT License

Copyright (c) 2026 Matt Pocock

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
