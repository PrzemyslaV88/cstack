#!/usr/bin/env node
process.argv.splice(2, 0, 'analyze-stack');
await import(new URL('../../cstack/scripts/cstack.mjs', import.meta.url));
