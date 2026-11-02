import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { relativePath, requireThat } from './util.mjs';

function inside(root, path) {
  const rel = relative(root, path);
  return rel === '' || (rel !== '..' && !rel.startsWith('../') && !rel.startsWith('/'));
}
function sameObject(a, b) { return a.dev === b.dev && a.ino === b.ino && a.mode === b.mode; }
function sameState(a, b) {
  return sameObject(a, b) && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
}
function expectedObject(actual, expected) {
  return !expected || Number(actual.dev) === expected.dev && Number(actual.ino) === expected.ino && Number(actual.mode) === expected.mode;
}

// Node does not expose openat(2). Pin the final object with O_NOFOLLOW and reject
// changed object identities or parents before bytes leave this helper. This
// closes final-component swaps and ordinary ancestor changes. A hostile actor
// able to race every validation step still requires descriptor-relative openat
// traversal; callers must not use this helper for destructive path operations.
export async function openPinnedFile(root, path, { flags = constants.O_RDONLY | constants.O_NONBLOCK,
  expected, code = 'INTEGRITY', message = 'File path changed during access' } = {}) {
  root = await realpath(resolve(root)); relativePath(path);
  const full = join(root, path), parent = await realpath(dirname(full));
  requireThat(inside(root, parent), 'File parent escapes trusted root', code);
  const handle = await open(full, flags | constants.O_NOFOLLOW);
  let closed = false;
  try {
    const opened = await handle.stat({ bigint: true });
    requireThat(opened.isFile() && expectedObject(opened, expected), message, code);
    const revalidate = async () => {
      const current = await handle.stat({ bigint: true }), named = await lstat(full, { bigint: true });
      const currentParent = await realpath(dirname(full));
      requireThat(current.isFile() && named.isFile() && sameState(opened, current) && sameObject(current, named) &&
        currentParent === parent && inside(root, currentParent), message, code);
      return current;
    };
    await revalidate();
    return { handle, stat: opened, revalidate, async close() { if (!closed) { closed = true; await handle.close(); } } };
  } catch (error) {
    if (!closed) { closed = true; await handle.close(); }
    throw error;
  }
}

export async function readPinnedFile(root, path, { expected, maxBytes = 256 * 1024 * 1024,
  code = 'INTEGRITY', message = 'File changed during read' } = {}) {
  const pinned = await openPinnedFile(root, path, { expected, code, message });
  try {
    requireThat(Number.isSafeInteger(maxBytes) && maxBytes >= 0 && pinned.stat.size <= BigInt(maxBytes), 'File exceeds read limit', code);
    const chunks=[];let length=0;
    while(length<maxBytes){const buffer=Buffer.allocUnsafe(Math.min(64*1024,maxBytes-length));const {bytesRead}=await pinned.handle.read(buffer,0,buffer.length,length);if(!bytesRead)break;chunks.push(buffer.subarray(0,bytesRead));length+=bytesRead;}
    const probe=Buffer.allocUnsafe(1),extra=await pinned.handle.read(probe,0,1,length);requireThat(extra.bytesRead===0,'File exceeds read limit',code);
    const content=Buffer.concat(chunks,length);
    requireThat(BigInt(content.length) === pinned.stat.size, message, code);
    await pinned.revalidate();
    return content;
  } finally { await pinned.close(); }
}
