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
export function compareText(a, b) {
  const x = Array.from(a), y = Array.from(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = x[i].codePointAt(0) - y[i].codePointAt(0); if (d) return d;
  }
  return x.length - y.length;
}
export function canonicalJson(value) {
  const walk = v => {
    if (v === null || typeof v === 'boolean' || typeof v === 'string') return v;
    if (typeof v === 'number') { requireThat(Number.isFinite(v), 'Non-finite canonical number'); return v; }
    if (Array.isArray(v)) return v.map(walk);
    requireThat(v && Object.getPrototypeOf(v) === Object.prototype, 'Canonical JSON requires plain JSON values');
    return Object.fromEntries(Object.keys(v).sort(compareText).map(k => [k, walk(v[k])]));
  };
  return JSON.stringify(walk(value));
}
export const digestOf = value => hash(canonicalJson(value));
export function exactKeys(value, keys, name = 'object') {
  requireThat(value && typeof value === 'object' && !Array.isArray(value), `${name} must be an object`);
  for (const key of Object.keys(value)) requireThat(keys.includes(key), `Unknown ${name} property: ${key}`);
}
export function relativePath(p, { dot = false } = {}) {
  requireThat(typeof p === 'string' && p.length > 0 && p.length <= 4096 && !/[\\\0\r\n\t]/.test(p) && !p.startsWith('/') &&
    (dot && p === '.' || p.split('/').every(x => x && x !== '.' && x !== '..')) && !p.split('/').includes('.git'), 'Unsafe relative path: ' + p);
  return p;
}
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
