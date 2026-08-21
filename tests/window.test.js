import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toEvents } from '../src/transcript.js';
import { windows, editedFiles, bashCalls, reads, delegated } from '../src/window.js';
import { transcript, reset } from './helpers.js';

function win(build) {
  reset();
  return windows(toEvents(build(transcript()).records()));
}

test('evidence is the tool calls made before the model spoke', () => {
  const [first, second] = win((t) =>
    t.edit('/tmp/a.ts').edit('/tmp/b.ts').says('fixed two files').bash('npm test').says('tests pass')
  );
  assert.equal(first.text, 'fixed two files');
  assert.deepEqual(editedFiles(first.evidence), ['/tmp/a.ts', '/tmp/b.ts']);
  assert.equal(bashCalls(second.evidence).length, 1);
  assert.equal(editedFiles(second.evidence).length, 0);
});

test('a repeated edit to one file counts once', () => {
  const [only] = win((t) => t.edit('/tmp/a.ts').edit('/tmp/a.ts').says('fixed three files'));
  assert.deepEqual(editedFiles(only.evidence), ['/tmp/a.ts']);
});

test('reads and delegation are recognised, edits are not reads', () => {
  const [only] = win((t) => t.read('/tmp/a.ts').tool('Grep', { pattern: 'x' }).edit('/tmp/b.ts').says('read it all'));
  assert.equal(reads(only.evidence).length, 2);
  assert.equal(delegated(only.evidence), false);

  const [withAgent] = win((t) => t.tool('Agent', { prompt: 'go' }).says('done'));
  assert.equal(delegated(withAgent.evidence), true);
});

test('trailing tool calls with no following text produce no window', () => {
  assert.equal(win((t) => t.says('starting').edit('/tmp/a.ts')).length, 1);
});
