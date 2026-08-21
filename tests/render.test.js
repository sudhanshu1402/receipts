import { test } from 'node:test';
import assert from 'node:assert/strict';
import { receipt, blockLine, statusline, digest } from '../src/render.js';

const at = (iso) => new Date(iso);
const summary = (from, to) => ({ from, to, files: ['/tmp/a.ts'], toolCalls: 4 });

test('a clean session gets one quiet line, not a table', () => {
  const text = receipt({
    findings: [{ family: 'verified', claim: 'Tests pass.', verdict: 'ok', detail: 'npm test' }],
    summary: summary('2026-08-21T10:00:00.000Z', '2026-08-21T10:12:00.000Z'),
  });
  assert.match(text, /1 claim\(s\) checked, all backed\./);
  assert.equal(text.includes('VERDICT'), false);
  assert.equal(text.split('\n').length, 2);
});

test('no checkable claim says so instead of implying innocence', () => {
  const text = receipt({ findings: [], summary: summary(null, null) });
  assert.match(text, /no checkable claims this session\./);
  assert.match(text, /--:-- {0,2}/);
});

test('a problem gets a table row with claim, evidence and verdict', () => {
  const text = receipt({
    findings: [{ family: 'counting', claim: 'Fixed all 3 files.', verdict: 'short', detail: 'claimed 3, edited 1' }],
    summary: summary('2026-08-21T10:00:00.000Z', '2026-08-21T10:45:00.000Z'),
  });
  assert.match(text, /CLAIMED/);
  assert.match(text, /"Fixed all 3 files\."/);
  assert.match(text, /claimed 3, edited 1/);
  assert.match(text, /1 unbacked or short/);
});

test('the span reads in minutes, hours or days', () => {
  const span = (from, to) => receipt({ findings: [], summary: summary(from, to) }).split('\n')[0];
  assert.match(span('2026-08-21T10:00:00.000Z', '2026-08-21T10:45:00.000Z'), /\b45m\b/);
  assert.match(span('2026-08-21T10:00:00.000Z', '2026-08-21T13:10:00.000Z'), /\b3h10m\b/);
  assert.match(span('2026-08-19T02:00:00.000Z', '2026-08-21T12:00:00.000Z'), /\b2d10h\b/);
});

test('the clock is local time, so it matches the wall clock of whoever ran it', () => {
  const iso = '2026-08-21T10:07:00.000Z';
  const head = receipt({ findings: [], summary: summary(iso, iso) }).split('\n')[0];
  const two = (n) => String(n).padStart(2, '0');
  assert.match(head, new RegExp(`${two(at(iso).getHours())}:${two(at(iso).getMinutes())}`));
});

test('the statusline is empty unless there is a problem', () => {
  assert.equal(statusline({ findings: [{ verdict: 'ok' }] }), '');
  assert.equal(statusline({ findings: [{ verdict: 'unbacked' }] }), 'receipts 1!');
  assert.equal(statusline({ findings: [{ verdict: 'unbacked', weak: true }] }), '');
});

test('the block line quotes the claim and names what is missing', () => {
  const line = blockLine({ claim: 'Tests pass.', detail: '`npm test` failed' });
  assert.match(line, /you said "Tests pass\." but `npm test` failed/);
});

test('the digest trends on the halves of the window', () => {
  const day = (date, problems) => ({ date, problems, checked: 5, families: { verified: problems } });
  assert.match(digest([day('2026-08-19', 4), day('2026-08-20', 1)]), /improving/);
  assert.match(digest([day('2026-08-19', 1), day('2026-08-20', 4)]), /getting worse/);
  assert.match(digest([day('2026-08-19', 2), day('2026-08-20', 2)]), /flat/);
  assert.match(digest([day('2026-08-19', 2)]), /not enough days to trend/);
  assert.match(digest([]), /no receipts stored yet\./);
  assert.match(digest([day('2026-08-19', 4), day('2026-08-20', 1)]), /worst family: verified \(5\)/);
});

test('a session crossing midnight carries its date in the header', () => {
  const one = receipt({ findings: [], summary: { from: '2026-08-19T20:24:00.000Z', to: '2026-08-22T20:24:00.000Z', files: [], toolCalls: 3 } });
  assert.match(one.split('\n')[0], /\d\d-\d\d \d\d:\d\d-\d\d-\d\d \d\d:\d\d/);
  const same = receipt({ findings: [], summary: { from: '2026-08-19T04:00:00.000Z', to: '2026-08-19T05:00:00.000Z', files: [], toolCalls: 3 } });
  assert.match(same.split('\n')[0], /SESSION RECEIPT {2}\d\d:\d\d-\d\d:\d\d {2}1h00m/);
});
