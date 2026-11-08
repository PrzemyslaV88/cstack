import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, existsSync, realpathSync } from 'node:fs';
import { writeFile, rename, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { CstackError, requireThat, hash, json, dataHome, safeId, digestOf } from './util.mjs';
import { validateWorkflow } from './workflow.mjs';

// v1 DB is deliberately left untouched. Its evidence lacked required provenance.
export function openStore(home = dataHome()) {
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(join(home, 'state-v2.db'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, contract TEXT NOT NULL, contract_hash TEXT NOT NULL, state TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS events (run_id TEXT NOT NULL, seq INTEGER NOT NULL, at TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(run_id,seq));
    CREATE TABLE IF NOT EXISTS locks (run_id TEXT PRIMARY KEY, token TEXT NOT NULL, pid INTEGER NOT NULL, host TEXT NOT NULL, birth TEXT NOT NULL);
    PRAGMA user_version=2;`);
  return db;
}
export function createRecord(run, home) {
  const db = openStore(home);
  try {
    db.exec('BEGIN IMMEDIATE');
    const contract = json(run.contract); run.contract_hash = hash(contract); run.revision = 0; run.event_seq = 0;
    db.prepare('INSERT INTO runs VALUES(?,?,?,?,?)').run(run.id, 0, contract, run.contract_hash, json(run));
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; } finally { db.close(); }
}
export async function loadRun(id, home = dataHome()) {
  requireThat(safeId(id), 'Invalid run ID');
  const db = openStore(home);
  try {
    const row = db.prepare('SELECT * FROM runs WHERE id=?').get(id);
    requireThat(row, 'Unknown v0.2 run. Legacy v0.1 runs are not trusted; start a new run from a reviewed candidate.', 'NOT_FOUND');
    const run = JSON.parse(row.state);
    requireThat(hash(row.contract) === row.contract_hash && hash(json(run.contract)) === row.contract_hash, 'Frozen contract integrity failure', 'INTEGRITY');
    requireThat(run.revision === row.revision, 'Run revision mismatch', 'INTEGRITY');
    validateWorkflow(run);
    if (run.preparation) requireThat(digestOf(run.preparation)===run.preparation_digest,'Preparation changed','INTEGRITY');
    return run;
  } finally { db.close(); }
}
export function commitRun(run, kind, payload = {}, home = dataHome(), token) {
  const db = openStore(home);
  const before = { revision: run.revision, event_seq: run.event_seq };
  try {
    db.exec('BEGIN IMMEDIATE');
    const row = db.prepare('SELECT revision,contract_hash,state FROM runs WHERE id=?').get(run.id);
    requireThat(row && row.revision === run.revision, 'Concurrent/stale run revision; reload before writing', 'CONFLICT');
    requireThat(hash(json(run.contract)) === row.contract_hash, 'Frozen contract changed', 'INTEGRITY');
    const previous=JSON.parse(row.state);
    requireThat(previous.workflow_digest===run.workflow_digest && previous.preparation_digest===run.preparation_digest,'Frozen workflow/preparation changed','INTEGRITY');
    validateWorkflow(run);
    if(run.preparation)requireThat(digestOf(run.preparation)===run.preparation_digest,'Frozen preparation changed','INTEGRITY');
    if (token) requireThat(db.prepare('SELECT token FROM locks WHERE run_id=?').get(run.id)?.token === token, 'Lost run lock', 'CONFLICT');
    run.revision++;
    run.event_seq = Number(db.prepare('SELECT COALESCE(MAX(seq),0)+1 AS seq FROM events WHERE run_id=?').get(run.id).seq);
    const event = { seq: run.event_seq, at: new Date().toISOString(), kind, payload };
    db.prepare('INSERT INTO events VALUES(?,?,?,?,?)').run(run.id, event.seq, event.at, kind, json(payload));
    db.prepare('UPDATE runs SET revision=?,state=? WHERE id=?').run(run.revision, json(run), run.id);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK'); Object.assign(run, before); throw e;
  } finally { db.close(); }
}
function birth(pid) {
  if (process.platform !== 'linux') return '';
  try { return readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ')[19]; } catch { return ''; }
}
export function lockRun(id, home = dataHome()) {
  const db = openStore(home), token = randomUUID();
  try {
    db.exec('BEGIN IMMEDIATE');
    const previous = db.prepare('SELECT * FROM locks WHERE run_id=?').get(id);
    if (previous) {
      let live = previous.host !== hostname();
      if (!live) {
        try { process.kill(previous.pid, 0); live = !previous.birth || previous.birth === birth(previous.pid); }
        catch (e) { live = e.code !== 'ESRCH'; }
      }
      requireThat(!live, 'Run is already active; concurrent resume refused', 'LOCKED');
    }
    db.prepare('INSERT OR REPLACE INTO locks VALUES(?,?,?,?,?)').run(id, token, process.pid, hostname(), birth(process.pid));
    db.exec('COMMIT'); return token;
  } catch (e) { db.exec('ROLLBACK'); throw e; } finally { db.close(); }
}
export function unlockRun(id, token, home) {
  const db = openStore(home);
  try { db.prepare('DELETE FROM locks WHERE run_id=? AND token=?').run(id, token); } finally { db.close(); }
}
export async function exportState(run, home = dataHome()) {
  const dir = join(home, 'runs', run.id); await mkdir(dir, { recursive: true, mode: 0o700 });
  const db = openStore(home);
  try {
    const rows = db.prepare('SELECT seq,at,kind,payload FROM events WHERE run_id=? ORDER BY seq').all(run.id);
    for (const [name, content] of [['run.json', json(run)], ['contract.json', json(run.contract)],
      ['events.jsonl', rows.map(e => JSON.stringify({ ...e, payload: JSON.parse(e.payload) })).join('\n') + '\n']]) {
      const temp = join(dir, name + '.tmp-' + randomUUID());
      await writeFile(temp, content, { mode: 0o600 }); await rename(temp, join(dir, name));
    }
  } finally { db.close(); }
}

export function listRuns({home=dataHome(),repo=null,limit=20}={}){
 requireThat(Number.isSafeInteger(limit)&&limit>=1&&limit<=100,'Run limit must be 1..100');const file=join(home,'state-v2.db');if(!existsSync(file))return [];if(repo)repo=realpathSync(repo);
 const db=new DatabaseSync(file,{readOnly:true});try{return db.prepare('SELECT state FROM runs').all().map(row=>JSON.parse(row.state)).filter(run=>!repo||run.repo===repo).sort((a,b)=>b.created.localeCompare(a.created)||b.id.localeCompare(a.id)).slice(0,limit).map(run=>({id:run.id,created:run.created,repo:run.repo,goal:run.contract.goal,status:run.status,active:run.active,attempts:run.attempts.length,delivery:run.delivery?.status||'NOT_APPLIED'}));}finally{db.close();}
}
