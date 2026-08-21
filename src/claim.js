const FILLER = new Set([
  'i', 'we', "i've", "we've", 'have', 'has', 'had', 'just', 'now', 'also',
  'already', 'then', 'successfully', 'finally', 'manually', 'did', 'both',
]);

export const FIRST_PERSON = /\b(?:i|we|i've|we've|i'm|my|our)\b/i;

const HARD_BREAK = /[.;:!?,()]|--|—/g;
const COORD = /\b(?:and|or|plus|then|but|so)\b/gi;

// A be-verb or conditional in front means passive or hypothetical, not a claim.
const DISQUALIFY = /\b(?:is|are|was|were|be|been|being|get|gets|got|until|unless|if|whether|would|could|should|will|shall|may|might|needs?|must|once|before|after|when|via|by)\b/i;

function lastIndexOfMatch(pattern, text) {
  pattern.lastIndex = 0;
  let end = 0;
  for (let hit = pattern.exec(text); hit !== null; hit = pattern.exec(text)) {
    end = hit.index + hit[0].length;
  }
  return end;
}

export function clauseAround(sentence, index) {
  const start = lastIndexOfMatch(HARD_BREAK, sentence.slice(0, index));
  HARD_BREAK.lastIndex = index;
  const next = HARD_BREAK.exec(sentence);
  return sentence.slice(start, next ? next.index : sentence.length);
}

// Only a first-person or bare clause is the model claiming credit.
export function agentive(sentence, pattern) {
  pattern.lastIndex = 0;
  const match = pattern.exec(sentence);
  if (!match) return false;

  const clause = sentence.slice(0, match.index);
  const segment = clause.slice(lastIndexOfMatch(HARD_BREAK, clause));
  if (DISQUALIFY.test(segment)) return false;

  const tail = segment.slice(lastIndexOfMatch(COORD, segment));
  const words = tail.toLowerCase().match(/[a-z']+/g) ?? [];
  return words.every((word) => FILLER.has(word));
}
