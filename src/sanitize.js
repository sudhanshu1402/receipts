const FENCE_LINE = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*(\S*)/;
const INLINE_CODE = /`[^`\n]*`/g;
const BLOCK_QUOTE = /^[ \t]*>[^\n]*$/gm;
// A quoted clause is someone else's words; scare quotes round a word or two are the model's own.
const QUOTED = /["“”]([^"“”\n]{0,400})["“”]/g;
const QUOTE_KEEP = 3;

const FUTURE = /\b(?:i'?ll|we'?ll|will|going to|gonna|about to|next,? i|let me|shall|should|would|could|plan to|intend to|then i)\b/i;
const NEGATED = /(?:\bnot\b|n['’]t\b|\bnever\b|\bno longer\b|\bfailed\b|\bfailing\b|\bunable\b|\bcannot\b|\bcan't\b|\bwithout\b|\byet to\b|\bstill need\b|\bskipped\b|\bunverified\b)/i;
const IMPERATIVE = /^(?:run|try|check|make|use|see|verify|confirm|ensure|open|install|add|apply|paste|copy|start|stop|rerun|re-run|go|do|read|watch|note)\b/i;
const INSTRUCTION = /\b(?:to make sure|to confirm|to check|to verify|so that|expect(?:ed)? (?:to|output)|you (?:can|should|must|need))\b/i;

// CommonMark: only a bare marker at least as long as the opener closes a fence.
function stripFences(text) {
  const out = [];
  let open = null;
  for (const line of text.split('\n')) {
    const hit = FENCE_LINE.exec(line);
    if (open === null) {
      if (hit) {
        open = hit[1];
        out.push('');
        continue;
      }
      out.push(line);
      continue;
    }
    if (hit && hit[2] === '' && hit[1][0] === open[0] && hit[1].length >= open.length) open = null;
  }
  return out.join('\n');
}

function words(text) {
  return (text.match(/[^\s]+/g) ?? []).length;
}

export const stages = [
  { name: 'fences', apply: stripFences },
  { name: 'inline-code', apply: (t) => t.replace(INLINE_CODE, ' CODE ') },
  { name: 'block-quotes', apply: (t) => t.replace(BLOCK_QUOTE, '') },
  { name: 'quoted', apply: (t) => t.replace(QUOTED, (whole, inner) => (words(inner) >= QUOTE_KEEP ? ' QUOTED ' : inner)) },
];

export function strip(text, skip = []) {
  let out = String(text ?? '');
  for (const stage of stages) {
    if (skip.includes(stage.name)) continue;
    out = stage.apply(out);
  }
  return out;
}

export function sentences(text) {
  return text
    .split(/\n+|(?<=[.!?])\s+/)
    .map((s) => s.replace(/^[\s*\-+•\d.)]+/, '').trim())
    .filter((s) => s.length > 0);
}

export function isFuture(sentence) {
  return FUTURE.test(sentence);
}

export function isNegated(sentence) {
  return NEGATED.test(sentence);
}

export function isInstruction(sentence) {
  return IMPERATIVE.test(sentence) || INSTRUCTION.test(sentence);
}

export function claimable(text, { skip = [] } = {}) {
  return sentences(strip(text, skip)).filter(
    (s) => !isFuture(s) && !isNegated(s) && !isInstruction(s)
  );
}
