import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toEvents, activeChain, kinds } from '../src/transcript.js';
import { transcript, reset } from './helpers.js';

test('one content block per record becomes one event', () => {
  reset();
  const t = transcript().user('do it').says('done').edit('/tmp/a.ts');
  const events = toEvents(t.records());
  assert.deepEqual(
    events.map((e) => e.kind),
    [kinds.TEXT, kinds.TOOL_USE, kinds.TOOL_RESULT]
  );
});

test('thinking blocks are not claims', () => {
  reset();
  const events = toEvents(transcript().thinks('I should lie').says('real text').records());
  assert.equal(events.filter((e) => e.kind === kinds.TEXT).length, 1);
});

test('tool_use inherits the error flag from its result', () => {
  reset();
  const t = transcript().bash('npm test', { isError: true }).bash('ls');
  const calls = toEvents(t.records()).filter((e) => e.kind === kinds.TOOL_USE);
  assert.deepEqual(calls.map((c) => c.isError), [true, false]);
});

test('a refusal is denied, the same phrase inside output is not', () => {
  reset();
  const t = transcript()
    .bash('npm test', { denied: true })
    .bash('npm test', { isError: true, output: 'FAIL marks a call the user rejected tool use as denied' });
  const calls = toEvents(t.records()).filter((e) => e.kind === kinds.TOOL_USE);
  assert.deepEqual(calls.map((c) => c.denied), [true, false]);
});

test('a rewound branch is excluded, the live thread wins', () => {
  reset();
  const t = transcript().user('start');
  const fork = t.at(0).uuid;
  t.says('abandoned answer');
  t.branchFrom(fork).says('live answer');

  const chain = activeChain(t.records());
  const texts = toEvents(t.records())
    .filter((e) => e.kind === kinds.TEXT)
    .map((e) => e.text);

  assert.equal(chain.length, 2);
  assert.deepEqual(texts, ['live answer']);
});

test('subagent records are dropped', () => {
  reset();
  const t = transcript().says('main thread').says('sidechain noise', { sidechain: true });
  const texts = toEvents(t.records()).filter((e) => e.kind === kinds.TEXT).map((e) => e.text);
  assert.deepEqual(texts, ['main thread']);
});

test('malformed and empty lines do not stop the parse', () => {
  reset();
  const good = transcript().says('kept').records();
  const events = toEvents([...good, null, undefined, { type: 'assistant' }, { type: 'user' }]);
  assert.equal(events.filter((e) => e.kind === kinds.TEXT).length, 1);
});
