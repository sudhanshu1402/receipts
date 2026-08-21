import { reads, bashCalls } from '../window.js';

const CLAIM = /\b(?:read|reviewed|went through|looked (?:at|over)|checked|scanned|examined|combed)\b[^.]{0,48}?\b(?:whole|entire|all|every|each|full|complete)\b|\b(?:whole|entire|full)\s+(?:file|document|doc|chapter|book|codebase|repo|manuscript|spreadsheet)\b/i;

// Can only tell some reading from none: a limited Read looks like a full one.
export default {
  name: 'reading',
  weak: true,
  blocking: false,
  check(sentence, evidence) {
    if (!CLAIM.test(sentence)) return null;

    const seen = reads(evidence);
    if (seen.length === 0) {
      // A shell command reads too, so no Read tool only counts with no Bash.
      if (bashCalls(evidence).length > 0) return null;
      return { verdict: 'unbacked', detail: 'nothing read', weak: true };
    }
    return { verdict: 'ok', detail: `${seen.length} read call(s)`, weak: true };
  },
};
