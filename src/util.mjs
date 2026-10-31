import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';

export class CstackError extends Error {
  constructor(message, code = 'INVALID') { super(message); this.name = 'CstackError'; this.code = code; }
}
export const hash = value => createHash('sha256').update(value).digest('hex');
export const json = value => JSON.stringify(value, null, 2) + '\n';
export const dataHome = () => resolve(process.env.CSTACK_HOME || join(homedir(), '.cstack'));
export const safeId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
export function requireThat(condition, message, code) { if (!condition) throw new CstackError(message, code); }
export function redact(text) {
  return String(text ?? '').replace(/\bsk-[A-Za-z0-9_-]{12,}/g, '[REDACTED]')
    .replace(/(Bearer\s+)[^\s"']+/gi, '$1[REDACTED]')
    .replace(/((?:api[_-]?key|access[_-]?token|password|secret)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]');
}
export function integer(value, fallback, min, max, name) {
  const n = value ?? fallback;
  requireThat(Number.isSafeInteger(n) && n >= min && n <= max, `${name} must be an integer in ${min}..${max}`);
  return n;
}
export function argv(value, name = 'argv') {
  requireThat(Array.isArray(value) && value.length > 0 && value.every(x => typeof x === 'string' && x.length > 0 && !x.includes('\0')), `${name} must be a nonempty argv array`);
  return [...value];
}
export function matches(path, patterns) {
  return patterns.some(pattern => {
    const re = pattern.split('**').map(p => p.split('*').map(x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')).join('.*');
    return new RegExp(`^${re}$`).test(path);
  });
}
