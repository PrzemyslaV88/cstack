import { posix } from 'node:path';
import { requireThat } from './util.mjs';

export const testPath = p => /(^|\/)(__tests__|tests?|testing|specs?|fixtures|testdata|test_data)(\/|$)|(^|\/)test_[^/]+\.py$|_test\.(py|go|rb)$|\.(test|spec)\.[^.]+$/i.test(p);
export const configPath = p => /(^|\/)(\.github|\.codex|\.cstack)(\/|$)|(^|\/)(package(-lock)?\.json|AGENTS\.md|conftest\.py|pytest\.ini|tox\.ini|.*\.config\.[^.]+)$/.test(p);
export const credentialPath = p => /(^|\/)(\.env(?:\.(?!example$|sample$)[^/]*)?|auth\.json|\.npmrc|id_rsa|id_ed25519)$|\.(pem|key|p12)$/i.test(p);

export function normalizeTestFixtures(value = []) {
  requireThat(Array.isArray(value) && value.length <= 32, 'approved_test_fixtures must contain at most 32 exact files');
  const seen = new Set();
  return value.map(item => {
    requireThat(item && typeof item === 'object' && !Array.isArray(item), 'Invalid approved test fixture');
    requireThat(Object.keys(item).every(k => ['path', 'sha256', 'reason'].includes(k)), 'Unknown approved test fixture property');
    const p = item.path;
    requireThat(typeof p === 'string' && p === posix.normalize(p) && !p.startsWith('/') && !p.startsWith('../') &&
      !/[\\\0\r\n*?\[\]]/.test(p) && !p.split('/').some(x => ['.git', '.codex', '.cstack'].includes(x)), 'Fixture path must be an exact relative file path');
    requireThat(testPath(p) && credentialPath(p), 'Only credential-named files inside recognised test paths can be approved');
    requireThat(!seen.has(p), 'Duplicate approved test fixture'); seen.add(p);
    requireThat(typeof item.sha256 === 'string' && /^[a-f0-9]{64}$/.test(item.sha256), 'Approved test fixture needs a SHA-256 digest');
    requireThat(typeof item.reason === 'string' && item.reason.trim().length >= 8 && item.reason.length <= 500, 'Approved test fixture needs a review reason');
    return { path: p, sha256: item.sha256, reason: item.reason.trim() };
  });
}
