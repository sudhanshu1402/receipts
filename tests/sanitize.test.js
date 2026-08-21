import { test } from 'node:test';
import assert from 'node:assert/strict';
import { strip, sentences, isFuture, isNegated, isInstruction, claimable } from '../src/sanitize.js';

test('a fenced block cannot claim anything', () => {
  const text = 'Here is the diff:\n```\nI fixed all 9 files and tests pass\n```\nOne file changed.';
  assert.equal(strip(text).includes('all 9 files'), false);
  assert.equal(claimable(text).some((s) => s.includes('9 files')), false);
});

test('an unclosed fence swallows the rest, so nothing after it is claimed', () => {
  const text = 'Output below.\n```\nI fixed all 9 files';
  assert.equal(strip(text).includes('9 files'), false);
});

test('inline code and block quotes are not the model speaking', () => {
  assert.equal(strip('Run `git push origin main` next.').includes('git push'), false);
  assert.equal(strip('> I merged the PR\nNothing merged.').includes('I merged'), false);
});

test('a double-quoted string is someone else’s words', () => {
  assert.equal(strip('The log said "all 12 files updated" which is wrong.').includes('12 files'), false);
});

test('contractions survive, so negation is still detectable', () => {
  assert.equal(strip("I didn't push it").includes("didn't"), true);
  assert.equal(isNegated("I didn't push it"), true);
  assert.equal(isNegated('The build never ran'), true);
  assert.equal(isNegated('I pushed it'), false);
});

test('intent is not a claim', () => {
  assert.equal(isFuture('I will push the branch'), true);
  assert.equal(isFuture('Let me run the tests'), true);
  assert.equal(isFuture('I pushed the branch'), false);
});

test('hedging in one sentence does not silence a claim in the next', () => {
  const claims = claimable('I will run the suite. I fixed all 3 files.');
  assert.deepEqual(claims, ['I fixed all 3 files.']);
});

test('list markers are stripped and lines split into sentences', () => {
  assert.deepEqual(sentences('- one thing\n* two thing'), ['one thing', 'two thing']);
});

test('a nested fence does not close the outer one, so later claims survive', () => {
  const text = 'Diff:\n````\n```bash\nnpm test\n```\n````\nI fixed all 3 files.';
  assert.equal(strip(text).includes('npm test'), false);
  assert.deepEqual(claimable(text), ['Diff:', 'I fixed all 3 files.']);
});

test('scare quotes round a word keep the sentence claimable', () => {
  assert.equal(strip('I "fixed" all 3 files.').includes('3 files'), true);
  assert.equal(strip('It printed "all 3 files updated" already.').includes('3 files'), false);
});

test('telling the user what to run is not a claim', () => {
  assert.equal(isInstruction('Run npm test to make sure the tests pass.'), true);
  assert.equal(isInstruction('You can check it with git log.'), true);
  assert.equal(isInstruction('Tests pass.'), false);
  assert.deepEqual(claimable('Run npm test to confirm. I fixed all 3 files.'), ['I fixed all 3 files.']);
});
