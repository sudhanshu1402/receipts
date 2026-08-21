import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readdirSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function sandbox(body) {
  const dir = mkdtempSync(join(tmpdir(), 'receipts-test-'));
  const previous = process.env.RECEIPTS_HOME;
  process.env.RECEIPTS_HOME = dir;
  try {
    return body(dir);
  } finally {
    if (previous === undefined) delete process.env.RECEIPTS_HOME;
    else process.env.RECEIPTS_HOME = previous;
    rmSync(dir, { recursive: true, force: true });
  }
}

const store = await import('../src/store.js');

test('RECEIPTS_HOME decides where receipts live', () => {
  sandbox((dir) => {
    assert.equal(store.root(), dir);
  });
});

test('a receipt is appended with a machine-readable trailer', () => {
  sandbox(() => {
    const file = store.append({
      sessionId: 'abc',
      cwd: '/tmp/project',
      body: 'SESSION RECEIPT',
      counts: { problems: 2, checked: 5 },
      families: { verified: 2 },
    });
    const [day] = store.days(7);
    assert.match(file, /\d{4}-\d{2}-\d{2}\.md$/);
    assert.equal(day.problems, 2);
    assert.equal(day.checked, 5);
    assert.deepEqual(day.families, { verified: 2 });
  });
});

test('two receipts in one day add up', () => {
  sandbox(() => {
    const write = () => store.append({ sessionId: 'a', cwd: '/x', body: 'b', counts: { problems: 1, checked: 3 }, families: { counting: 1 } });
    write();
    write();
    const [day] = store.days(7);
    assert.equal(day.problems, 2);
    assert.equal(day.checked, 6);
    assert.deepEqual(day.families, { counting: 2 });
  });
});

test('a corrupt trailer is skipped, not fatal', () => {
  sandbox((dir) => {
    const file = join(dir, '2026-08-01.md');
    writeFileSync(file, '<!-- receipts:json {not json} -->\n<!-- receipts:json {"counts":{"problems":3}} -->\n');
    assert.equal(store.days(7)[0].problems, 3);
  });
});

test('the block marker fires once per session', () => {
  sandbox(() => {
    assert.equal(store.alreadyBlocked('s1'), false);
    store.markBlocked('s1');
    assert.equal(store.alreadyBlocked('s1'), true);
    assert.equal(store.alreadyBlocked('s2'), false);
  });
});

test('prune drops files past the retention window and keeps the rest', () => {
  sandbox((dir) => {
    writeFileSync(join(dir, '2026-01-01.md'), 'old');
    writeFileSync(join(dir, '2026-08-21.md'), 'new');
    const old = new Date(Date.now() - 40 * 86400000);
    utimesSync(join(dir, '2026-01-01.md'), old, old);
    store.markBlocked('s1');

    writeFileSync(join(dir, 'notes.md'), 'not ours');
    utimesSync(join(dir, 'notes.md'), old, old);

    assert.deepEqual(store.prune(30), ['2026-01-01.md']);
    assert.deepEqual(readdirSync(dir).sort(), ['2026-08-21.md', 'notes.md', 'state']);
  });
});

test('days returns nothing when no receipt has been written', () => {
  sandbox(() => {
    assert.deepEqual(store.days(7), []);
    assert.deepEqual(store.prune(30), []);
  });
});

test('no session id means no marker, so a block is never attempted', () => {
  sandbox(() => {
    assert.equal(store.markerPath(null), null);
    assert.equal(store.alreadyBlocked(null), true);
    store.markBlocked(null);
    assert.equal(store.cursor(null), null);
    store.setCursor(null, '2026-08-21T10:00:00.000Z');
    assert.equal(store.cursor(null), null);
  });
});

test('a cursor round-trips per session and starts empty', () => {
  sandbox(() => {
    assert.equal(store.cursor('s9'), null);
    store.setCursor('s9', '2026-08-21T10:00:00.000Z');
    assert.equal(store.cursor('s9'), '2026-08-21T10:00:00.000Z');
    assert.equal(store.cursor('s10'), null);
  });
});
