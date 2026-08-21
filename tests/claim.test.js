import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentive, clauseAround, FIRST_PERSON } from '../src/claim.js';

const MERGED = /\bmerged\b/i;
const VERIFIED = /\bverified\b/i;

test('a first-person or bare clause is the agent claiming credit', () => {
  for (const sentence of [
    'I merged the PR',
    "I've merged it already",
    'Merged the PR and deleted the branch',
    'did: merged all three',
    'Fixed the bug and merged it',
  ]) {
    assert.equal(agentive(sentence, MERGED), true, sentence);
  }
});

test('reporting someone else’s work is not a claim', () => {
  for (const sentence of [
    'mongo-patterns and otel-sdk-node merged, engineering-projects is next',
    'The PR was merged by CI',
    'you merged it yesterday',
    'Nothing lands until the PR is reviewed and merged',
    'It gets merged automatically',
  ]) {
    assert.equal(agentive(sentence, MERGED), false, sentence);
  }
});

test('an adjective is not a claim', () => {
  assert.equal(agentive("grounded in each repo's verified output", VERIFIED), false);
  assert.equal(agentive('testable in jsdom instead of hand-verified', VERIFIED), false);
  assert.equal(agentive('Verified: the suite is green', VERIFIED), true);
});

test('a clause stops at hard punctuation', () => {
  const sentence = 'merged all 7 banners; set all 3 repo fields.';
  assert.equal(clauseAround(sentence, sentence.indexOf('3')).includes('banners'), false);
  assert.equal(clauseAround(sentence, sentence.indexOf('7')).includes('merged'), true);
});

test('first person is detected without matching words that contain it', () => {
  assert.equal(FIRST_PERSON.test('I pushed it'), true);
  assert.equal(FIRST_PERSON.test('it is live'), false);
});
