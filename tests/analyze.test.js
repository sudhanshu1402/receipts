import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toEvents } from '../src/transcript.js';
import { analyze, tally, firstBlocking } from '../src/analyze.js';
import { transcript, reset } from './helpers.js';

function run(build) {
  reset();
  return analyze(toEvents(build(transcript()).records()));
}

test('a failed check under a pass claim is the one blocking finding', () => {
  const { findings } = run((t) => t.bash('npm test', { isError: true }).says('Tests pass.'));
  const worst = firstBlocking(findings);
  assert.ok(worst);
  assert.equal(worst.family, 'verified');
  assert.equal(tally(findings).problems, 1);
});

test('work handed to a subagent is reported but never blocked on', () => {
  const { findings } = run((t) => t.tool('Agent', { prompt: 'go' }).says('Tests pass.'));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].viaAgent, true);
  assert.equal(findings[0].blocking, false);
  assert.equal(firstBlocking(findings), null);
  assert.equal(tally(findings).problems, 0);
});

test('a weak finding never counts as a problem', () => {
  const { findings } = run((t) => t.edit('/tmp/a.ts').says('I read the whole file.'));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].weak, true);
  assert.equal(tally(findings).problems, 0);
});

test('an honest session produces no findings', () => {
  const { findings, summary } = run((t) =>
    t.edit('/tmp/a.ts').edit('/tmp/b.ts').bash('npm test').says('Fixed both files and tests pass.')
  );
  assert.equal(tally(findings).problems, 0);
  assert.equal(summary.files.length, 2);
  assert.equal(summary.toolCalls, 3);
});

test('the summary spans the session and counts failures', () => {
  const { summary } = run((t) => t.bash('npm test', { isError: true }).says('done'));
  assert.equal(summary.failedCalls, 1);
  assert.equal(summary.spoke, 1);
  assert.ok(summary.from <= summary.to);
});

test('a long claim is truncated for display', () => {
  const long = `Fixed all 9 files ${'x'.repeat(200)}`;
  const { findings } = run((t) => t.edit('/tmp/a.ts').says(long));
  assert.ok(findings[0].claim.length <= 72);
  assert.ok(findings[0].claim.endsWith('…'));
});

test('a cursor keeps a second run from re-reporting the same claims', () => {
  reset();
  const events = toEvents(
    transcript().edit('/tmp/a.ts').says('I fixed all 3 files.').bash('npm test').says('Tests pass.').records()
  );
  const all = analyze(events);
  assert.equal(all.turns, 2);
  assert.equal(all.findings.length, 2);

  assert.equal(all.lastTs, all.findings[all.findings.length - 1].ts);

  const future = analyze(
    toEvents(
      transcript()
        .edit('/tmp/a.ts')
        .says('I fixed all 3 files.', { ts: new Date(Date.now() + 3600000).toISOString() })
        .records()
    )
  );
  assert.equal(future.findings.length, 0);
  assert.equal(future.lastTs, null);

  const delta = analyze(events, { since: all.findings[0].ts });
  assert.deepEqual(delta.findings.map((f) => f.turn), [1]);
  assert.equal(analyze(events, { since: all.lastTs }).findings.length, 0);
});
