import { editedFiles, bashCalls } from '../window.js';
import { clauseAround, agentive } from '../claim.js';

const WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

// File-ish nouns only: "23 tests pass" is a verified claim, not a counting one.
const NOUNS = [
  'files?', 'docs?', 'documents?', 'pages?', 'chapters?', 'repos?', 'repositories',
  'repository', 'readmes?', 'scripts?', 'configs?', 'components?', 'modules?',
  'places?', 'spots?', 'locations?', 'sheets?', 'templates?', 'workflows?', 'manifests?',
].join('|');

const WRITER = /\b(?:sed|perl|awk|tee|mv|cp|rm|touch|jq|yq|node|python3?|bash|sh|zsh|xargs|gh\s+repo\s+edit|npm\s+pkg\s+set|git\s+(?:apply|checkout|restore))\b|(?<![\d&])>>?\s*[^&\s]/;

// Quoted text is data, not a redirect: `grep "a > b"` writes nothing.
function writes(cmd) {
  return WRITER.test(cmd.replace(/"[^"]*"|'[^']*'/g, ' '));
}

const EDIT_VERB = /\b(?:fixed|updated|added|changed|edited|removed|renamed|wrote|rewrote|applied|replaced|bumped|corrected|patched|adjusted|set|filled|deleted|created)\b/i;

const NUMERAL = `\\d+|${Object.keys(WORDS).join('|')}`;
const PATTERNS = [
  new RegExp(`\\b(?:all|every|each)\\s+(?:one\\s+of\\s+)?(?:the\\s+)?(${NUMERAL})\\s+(?:${NOUNS})\\b`, 'i'),
  new RegExp(`\\b(?:in|across|to|for)\\s+(?:all\\s+)?(${NUMERAL})\\s+(?:${NOUNS})\\b`, 'i'),
  new RegExp(`\\b(${NUMERAL})\\s+(?:${NOUNS})\\b`, 'i'),
  new RegExp(`\\bboth\\s+(?:of\\s+the\\s+)?(?:${NOUNS})\\b`, 'i'),
];

// "set all 3 repo fields" counts fields, so a following noun means a modifier.
const COMPOUND = /^\s+(?:fields?|names?|urls?|links?|entries|keys?|values?|topics?|settings?|paths?|counts?|descriptions?|badges?|labels?|owners?|branches|tags?)\b/i;

function claimedCount(sentence) {
  for (const pattern of PATTERNS) {
    const hit = sentence.match(pattern);
    if (!hit) continue;
    if (COMPOUND.test(sentence.slice(hit.index + hit[0].length))) continue;
    const clause = clauseAround(sentence, hit.index);
    if (!EDIT_VERB.test(clause)) continue;
    if (!agentive(clause, EDIT_VERB)) continue;
    if (/^both/i.test(hit[0])) return 2;
    const raw = hit[1]?.toLowerCase();
    const n = /^\d+$/.test(raw) ? Number(raw) : WORDS[raw];
    if (Number.isInteger(n) && n > 0) return n;
  }
  return null;
}

export default {
  name: 'counting',
  weak: false,
  blocking: false,
  check(sentence, evidence, context = {}) {
    const claimed = claimedCount(sentence);
    if (claimed === null) return null;
    if (editedFiles(evidence).length === 0) return null;

    // "all 3 files" usually means the session, not this turn.
    const files = editedFiles(context.cumulative ?? evidence);
    if (claimed <= files.length) {
      return { verdict: 'ok', detail: `edited ${files.length}` };
    }
    return {
      verdict: 'short',
      detail: `claimed ${claimed}, edited ${files.length}`,
      files,
      short: claimed - files.length,
      // A sed or a script edits files invisibly, so a writing command makes the count a guess.
      weak: bashCalls(context.cumulative ?? evidence).some((call) => writes(String(call.input?.command ?? ''))),
    };
  },
};
