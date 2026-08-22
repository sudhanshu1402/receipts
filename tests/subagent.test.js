import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEvents, subagentPath, toEvents } from '../src/transcript.js';
import { analyze, resolveDelegates } from '../src/analyze.js';
import { transcript, reset } from './helpers.js';

const SESSION = 'session-1';

function write(records, path) {
  writeFileSync(path, records.map((r) => `${JSON.stringify(r)}\n`).join(''));
}

// A real directory, because the whole point is that the subagent file is found on disk.
function session(main, agents = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'receipts-sub-'));
  const path = join(dir, `${SESSION}.jsonl`);
  write(main, path);
  for (const [agentId, records] of Object.entries(agents)) {
    const file = subagentPath(path, agentId);
    mkdirSync(join(file, '..'), { recursive: true });
    write(records, file);
  }
  return path;
}

function sub(calls) {
  reset();
  const t = transcript();
  for (const [command, ts, isError] of calls) {
    t.bash(command, { sidechain: true, ts, isError: isError === true });
  }
  return t.records();
}

async function judge(path) {
  const events = await loadEvents(path);
  return analyze(events, { delegates: await resolveDelegates(events, path) });
}

test('a subagent Bash run backs the claim the main thread made', async () => {
  reset();
  const main = transcript()
    .edit('/a.ts', { ts: '2026-01-15T10:01:00.000Z' })
    .agent('run the suite', { agentId: 'a1', ts: '2026-01-15T10:02:00.000Z' })
    .says('All tests pass.', { ts: '2026-01-15T10:03:00.000Z' })
    .records();
  const path = session(main, { a1: sub([['npm test', '2026-01-15T10:02:30.000Z']]) });

  const { findings } = await judge(path);
  const one = findings.find((f) => f.family === 'verified');
  assert.equal(one.verdict, 'ok');
  assert.equal(one.viaAgent, false);
});

test('a subagent run that failed still blocks', async () => {
  reset();
  const main = transcript()
    .edit('/a.ts', { ts: '2026-01-15T10:01:00.000Z' })
    .agent('run the suite', { agentId: 'a1', ts: '2026-01-15T10:02:00.000Z' })
    .says('All tests pass.', { ts: '2026-01-15T10:03:00.000Z' })
    .records();
  const path = session(main, { a1: sub([['npm test', '2026-01-15T10:02:30.000Z', true]]) });

  const { findings } = await judge(path);
  const one = findings.find((f) => f.family === 'verified');
  assert.equal(one.verdict, 'unbacked');
  assert.equal(one.blocking, true);
  assert.match(one.detail, /npm test` failed/);
});

test('a delegated call with no file on disk is still excused, never called a lie', async () => {
  reset();
  const main = transcript()
    .edit('/a.ts', { ts: '2026-01-15T10:01:00.000Z' })
    .agent('run the suite', { agentId: 'gone', ts: '2026-01-15T10:02:00.000Z' })
    .says('All tests pass.', { ts: '2026-01-15T10:03:00.000Z' })
    .records();
  const path = session(main);

  const { findings } = await judge(path);
  const one = findings.find((f) => f.family === 'verified');
  assert.equal(one.viaAgent, true);
  assert.equal(one.blocking, false);
});

test('one readable subagent and one missing leaves the window unjudged', async () => {
  reset();
  const main = transcript()
    .edit('/a.ts', { ts: '2026-01-15T10:01:00.000Z' })
    .agent('run the suite', { agentId: 'a1', ts: '2026-01-15T10:02:00.000Z' })
    .agent('run the build', { agentId: 'gone', ts: '2026-01-15T10:02:10.000Z' })
    .says('All tests pass.', { ts: '2026-01-15T10:03:00.000Z' })
    .records();
  const path = session(main, { a1: sub([['npm test', '2026-01-15T10:02:30.000Z']]) });

  const { findings, summary } = await judge(path);
  assert.equal(findings.find((f) => f.family === 'verified').viaAgent, true);
  // The readable subagent's run is discarded too: partial evidence never judges the window.
  assert.equal(summary.bashCalls, 0);
});

test('a subagent run that postdates the claim cannot back it or contradict it', async () => {
  reset();
  const main = transcript()
    .edit('/a.ts', { ts: '2026-01-15T10:01:00.000Z' })
    .bash('npm test', { ts: '2026-01-15T10:01:30.000Z' })
    .agent('keep digging', { agentId: 'a1', ts: '2026-01-15T10:02:00.000Z' })
    .says('All tests pass.', { ts: '2026-01-15T10:03:00.000Z' })
    .records();
  const path = session(main, { a1: sub([['npx vitest run flaky.test.ts', '2026-01-15T10:07:00.000Z', true]]) });

  const { findings } = await judge(path);
  const one = findings.find((f) => f.family === 'verified');
  assert.equal(one.verdict, 'ok');
  assert.equal(one.blocking, false);
});

test('a background subagent with no work yet leaves the window unjudged', async () => {
  reset();
  const main = transcript()
    .edit('/a.ts', { ts: '2026-01-15T10:01:00.000Z' })
    .agent('run the suite', { agentId: 'a1', ts: '2026-01-15T10:02:00.000Z' })
    .says('All tests pass.', { ts: '2026-01-15T10:03:00.000Z' })
    .records();
  const path = session(main, { a1: sub([['npm test', '2026-01-15T10:09:00.000Z']]) });

  const { findings } = await judge(path);
  assert.equal(findings.find((f) => f.family === 'verified').viaAgent, true);
});

test('a subagent that delegates onward is followed to the file holding the run', async () => {
  reset();
  const deep = sub([['npm test', '2026-01-15T10:02:20.000Z']]);
  reset();
  const middle = transcript()
    .agent('you run it', { agentId: 'a2', sidechain: true, ts: '2026-01-15T10:02:10.000Z' })
    .records();
  reset();
  const main = transcript()
    .edit('/a.ts', { ts: '2026-01-15T10:01:00.000Z' })
    .agent('get the suite run', { agentId: 'a1', ts: '2026-01-15T10:02:00.000Z' })
    .says('All tests pass.', { ts: '2026-01-15T10:03:00.000Z' })
    .records();
  const path = session(main, { a1: middle, a2: deep });

  const { findings } = await judge(path);
  const one = findings.find((f) => f.family === 'verified');
  assert.equal(one.verdict, 'ok');
  assert.equal(one.viaAgent, false);
});

test('a nested delegate with no file of its own leaves the window unjudged', async () => {
  reset();
  const middle = transcript()
    .agent('you run it', { agentId: 'gone', sidechain: true, ts: '2026-01-15T10:02:10.000Z' })
    .records();
  reset();
  const main = transcript()
    .edit('/a.ts', { ts: '2026-01-15T10:01:00.000Z' })
    .agent('get the suite run', { agentId: 'a1', ts: '2026-01-15T10:02:00.000Z' })
    .says('All tests pass.', { ts: '2026-01-15T10:03:00.000Z' })
    .records();
  const path = session(main, { a1: middle });

  const { findings } = await judge(path);
  const one = findings.find((f) => f.family === 'verified');
  assert.equal(one.viaAgent, true);
  assert.equal(one.blocking, false);
});

test('a subagent run with no timestamp is still evidence, not a dropped run', async () => {
  reset();
  const agent = transcript();
  agent.bash('ls', { sidechain: true, ts: '2026-01-15T10:02:10.000Z' });
  agent.bash('npm test', { sidechain: true, ts: '2026-01-15T10:02:20.000Z' });
  const records = agent.records();
  // The helper always stamps a record, so drop the stamp the way a real gap would.
  delete records.find((r) => JSON.stringify(r).includes('npm test')).timestamp;

  reset();
  const main = transcript()
    .edit('/a.ts', { ts: '2026-01-15T10:01:00.000Z' })
    .agent('run the suite', { agentId: 'a1', ts: '2026-01-15T10:02:00.000Z' })
    .says('All tests pass.', { ts: '2026-01-15T10:03:00.000Z' })
    .records();
  const path = session(main, { a1: records });

  const { findings } = await judge(path);
  const one = findings.find((f) => f.family === 'verified');
  assert.equal(one.verdict, 'ok');
  assert.equal(one.blocking, false);
});

test('one agent delegated to twice is counted once in the header', async () => {
  reset();
  const main = transcript()
    .agent('run the suite', { agentId: 'a1', ts: '2026-01-15T10:02:00.000Z' })
    .says('Kicked off the suite.', { ts: '2026-01-15T10:03:00.000Z' })
    .tool('SendMessage', { to: 'a1' }, { ts: '2026-01-15T10:04:00.000Z', toolUseResult: { agentId: 'a1' } })
    .says('The suite is green.', { ts: '2026-01-15T10:05:00.000Z' })
    .records();
  const path = session(main, { a1: sub([['npm test', '2026-01-15T10:02:30.000Z']]) });

  const { summary } = await judge(path);
  assert.equal(summary.bashCalls, 1);
});

test('an agentId that walks out of the session directory resolves to nothing', () => {
  assert.equal(subagentPath('/p/sess.jsonl', '../../../../tmp/evil'), null);
  assert.equal(subagentPath('/p/sess.jsonl', 'a1'), '/p/sess/subagents/agent-a1.jsonl');
});

test('a delegate call without an agentId cannot be resolved', async () => {
  reset();
  const main = transcript()
    .edit('/a.ts', { ts: '2026-01-15T10:01:00.000Z' })
    .agent('run the suite', { ts: '2026-01-15T10:02:00.000Z' })
    .says('All tests pass.', { ts: '2026-01-15T10:03:00.000Z' })
    .records();
  const path = session(main);

  const { findings } = await judge(path);
  assert.equal(findings.find((f) => f.family === 'verified').viaAgent, true);
});

test('files the subagent edited count toward the claimed number', async () => {
  reset();
  const agent = transcript();
  agent.tool('Edit', { file_path: '/c.ts' }, { sidechain: true, ts: '2026-01-15T10:02:10.000Z' });
  agent.tool('Edit', { file_path: '/d.ts' }, { sidechain: true, ts: '2026-01-15T10:02:20.000Z' });
  agent.tool('Edit', { file_path: '/e.ts' }, { sidechain: true, ts: '2026-01-15T10:02:30.000Z' });
  const records = agent.records();

  reset();
  const main = transcript()
    .edit('/a.ts', { ts: '2026-01-15T10:01:00.000Z' })
    .edit('/b.ts', { ts: '2026-01-15T10:01:10.000Z' })
    .agent('edit the rest', { agentId: 'a1', ts: '2026-01-15T10:02:00.000Z' })
    .says('Fixed all 5 files.', { ts: '2026-01-15T10:03:00.000Z' })
    .records();
  const path = session(main, { a1: records });

  const { findings, summary } = await judge(path);
  const counting = findings.find((f) => f.family === 'counting');
  assert.equal(counting.verdict, 'ok');
  assert.equal(counting.detail, 'edited 5');
  assert.equal(summary.files.length, 5);
});

test('a sidechain record inside a main transcript is still not the agent speaking', () => {
  reset();
  const records = transcript()
    .says('All tests pass.', { sidechain: true })
    .records();
  assert.equal(toEvents(records).length, 0);
  assert.equal(toEvents(records, { sidechain: true }).length, 1);
});
