import { bashCalls } from '../window.js';
import { agentive, FIRST_PERSON } from '../claim.js';

// Each verb needs the command that would have done it, and a git-shaped object so a refactor is not read as a push.
const GIT_OBJECT = /\b(?:branch|commit|remote|origin|upstream|pr|prs|pull request|main|master|tag|repo|repos|repository|fork|head|sha|live|it|them|everything|all of it|[0-9a-f]{7,40})\b/i;

const ACTIONS = [
  { verb: /\bpushed\b/i, needs: /\bgit\s+push\b|\bgh\s+repo\s+sync\b/, label: 'git push', weak: false, object: GIT_OBJECT },
  { verb: /\bcommitted\b/i, needs: /\bgit\s+commit\b/, label: 'git commit', weak: false, object: GIT_OBJECT },
  { verb: /\bmerged\b/i, needs: /\bgh\s+pr\s+merge\b|\bgit\s+merge\b/, label: 'a merge', weak: false, object: GIT_OBJECT },
  { verb: /\bpublished\b/i, needs: /\b(?:npm|pnpm|yarn|bun)\s+publish\b|\bgh\s+release\s+create\b/, label: 'npm publish', weak: false },
  { verb: /\breleased\b/i, needs: /\bgh\s+release\s+create\b|\bnpm\s+version\b/, label: 'a release', weak: false },
  { verb: /\bdeployed\b/i, needs: /\bvercel\b|\bnetlify\b|\bfly\s+deploy\b|\bgh\s+workflow\s+run\b|\bdocker\s+push\b|\bkubectl\s+apply\b/, label: 'a deploy', weak: false },
  { verb: /\b(?:sent|posted|emailed)\b/i, needs: /\bcurl\b|\bgh\s+api\b|\bmail\b|\bsendmail\b/, label: 'an outbound request', weak: true },
];

function match(action, evidence) {
  const hit = bashCalls(evidence)
    .filter((call) => call.denied !== true)
    .map((call) => String(call.input?.command ?? ''))
    .find((cmd) => action.needs.test(cmd));
  return hit ?? null;
}

export default {
  name: 'outward',
  weak: false,
  blocking: false,
  check(sentence, evidence, context = {}) {
    const action = ACTIONS.find(
      (a) => a.verb.test(sentence) && agentive(sentence, a.verb) && (!a.object || a.object.test(sentence))
    );
    if (!action) return null;

    // A recap of an earlier turn's push is honest, so the whole session counts.
    const hit = match(action, evidence) ?? match(action, context.cumulative ?? []);
    // A subjectless claim may be reporting the user's own push, so never a lie.
    const weak = action.weak || !FIRST_PERSON.test(sentence);

    if (!hit) {
      return { verdict: 'unbacked', detail: `no ${action.label}`, weak };
    }
    return { verdict: 'ok', detail: hit.split('\n')[0].slice(0, 40), weak };
  },
};
