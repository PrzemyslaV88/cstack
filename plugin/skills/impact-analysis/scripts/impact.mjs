#!/usr/bin/env node
process.argv.splice(2,0,'impact');
await import(new URL('../../cstack/scripts/cstack.mjs',import.meta.url));
