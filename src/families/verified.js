import { bashCalls, reads, EDIT_TOOLS } from '../window.js';
import { agentive } from '../claim.js';

const FACT = /\b(?:(?:tests?|specs?|suites?) (?:pass(?:es)?|passing|are green|is green)|all (?:(?:tests?|specs?|suites?) )?(?:pass|passing|green)|builds? (?:is |are |was |were )?clean|build (?:passes|succeeded)|compiles clean|it works now|works now|no errors|error[- ]free|lint (?:is |was )?clean|type[- ]?check(?:s)? (?:is |was )?clean|exit(?:ed)? 0)\b/i;
const ATTRIBUTED = /\b(?:verified|confirmed|checked|tested|proved|proven)\b/i;

// "the output is emptied when the build is clean" describes behaviour; it claims nothing about this run.
// A subordinator governs its whole clause, so a bare coordinator inside it cannot cancel it.
const SUBORDINATE = /\b(?:if|when|once|unless|until|whether|means?|meant)\b/i;
const DESCRIBES = /\b(?:would|could|should|will|may|might|must|needs?|makes?|returns?|prints?|reports?|shows?|keeps?|leaves?|treats?|allows?|ensures?|requires?|expects?|assumes?)\b/i;
const HYPOTHETICAL = /\b(?:by design|in theory|in principle|on paper)\b/i;
// ", and" and ", which means" close that clause: "I fixed the test that failed when X, and all tests pass."
const BREAKS = [/[.;!?]/g, /,\s*(?:and|or|but|so|plus|then)\b/gi, /,\s*which\s+means\b/gi];
// "I made the mock async and all tests pass" is a claim: a coordinator ends the description.
const CUTS = [/[.;!?]/g, /\b(?:and|or|plus|then|but|so)\b/gi];

// The executable must be a runner: `cat build.log` mentions the build, it does not run it.
const RUNNERS = 'npm|pnpm|yarn|bun|npx|bunx|pnpx|uv|uvx|poetry|pipenv|tox|nox|hatch|pdm|rye|make|just|rake|bazel|cmake|ninja|tsc|vue-tsc|eslint|prettier|ruff|black|mypy|vitest|jest|pytest|mocha|cargo|go|mvn|mvnw|gradle|gradlew|rails|dotnet|node|python3?|deno|ruby|php|esbuild|vite|rollup|webpack|swc|shellcheck|ctest|bash|sh';
const EXE = new RegExp(`^\\s*(?:sudo\\s+|env\\s+\\S+=\\S+\\s+|time\\s+)*(?:\\S*\\/)?(?:${RUNNERS})\\b`);
const BASE = new RegExp(`^(?:${RUNNERS})$`);

// A runner asked for its version, its help or a dry run has checked nothing, and neither has an install.
const INFO = /(?:^|\s)(?:--version|-V|--help|-h|--collect-only|--list-tests|--listTests)\b|^\s*(?:\S*\/)?(?:npm|pnpm|yarn|bun|uv|pip3?|cargo|go|poetry)\s+(?:pip\s+)?(?:ls|list|view|info|env|tree|show|search|config|which|why|outdated|audit|i|install|ci|add|remove|uninstall|un|rm|link|unlink|dedupe|pack|publish)\b|^\s*(?:\S*\/)?make\s+-n\b/;

// A path argument is not the runner: `npx eslint test/services/scim.test.ts` is a lint run.
const PATHISH = /\/|\.\w+$/;
const INLINE = /^(?:-e|-c|--eval)$/;

function runner(segment) {
  const words = [];
  let flag = false;
  for (const word of segment.split(/\s+/)) {
    if (INLINE.test(word)) break;
    const value = flag && !word.startsWith('-');
    flag = word.startsWith('--') && !word.includes('=');
    // `./node_modules/.bin/mocha` is the runner itself, so its basename survives the path cut.
    const base = word.replace(/^.*\//, '').replace(/\.\w+$/, '');
    // `--mode build` names a mode, not a build, but `uv run --frozen pytest` still names pytest.
    if (value && !BASE.test(base)) continue;
    if (!PATHISH.test(word)) {
      words.push(word);
      continue;
    }
    if (BASE.test(base)) words.push(base);
  }
  return words.join(' ');
}

// A script alias hides what it runs, so a subject miss beside one is a guess, not a lie.
const OPAQUE = /^\s*(?:(?:npm|pnpm|yarn|bun)\s+run\b|make\b|npx\s+\S+\.(?:js|mjs|ts)\b|(?:\.\/|bash\s+|sh\s+|zsh\s+)\S+\.sh\b)/;

// An alias whose own name is a chore hides nothing: `npm run dev` was never the check.
const CHORE = /^(?:clean|dev|start|serve|watch|format|fix|install|setup|deploy|release|seed|migrate|publish)$/;

// The alias's own name, not the whole segment: `npm run build >/dev/null` is a build, not a dev script.
function chore(segment) {
  const words = segment.trim().split(/\s+/).filter((word) => !/^\d*[<>]/.test(word));
  let at = 0;
  if (/^(?:npm|pnpm|yarn|bun)$/.test(words[0]) && words[1] === 'run') at = 2;
  else if (/^(?:bash|sh|zsh)$/.test(words[0]) || /^(?:\S*\/)?make$/.test(words[0])) at = 1;
  while (at < words.length && words[at].startsWith('-')) at += 1;
  return (words[at] ?? '').replace(/^.*\//, '').replace(/\.\w+$/, '').split(':').some((part) => CHORE.test(part));
}

// A passing lint does not back a claim about the tests, so subject must match.
const SUBJECTS = [
  // A verdict close by means a suite, unless another subject or another counted item sits between.
  { name: 'test', noun: /\b(?:tests?|suites?|specs?)\b/i, claim: /\b(?:tests?|suites?|specs?)\b(?=(?:(?!,\s*\d)(?!\b(?:build|bundle|compiles?|lint|eslint|ruff|black|prettier|type[- ]?check|tsc|types?)\b)[^.]){0,28}?(?:\b(?:pass|passing|green|clean|exits?|works?)\w*\b|\bno errors\b|\berror[- ]free\b))|\b(?:all|every|the whole)\s+(?:tests?|suites?|specs?)\b/i, command: /\btest\b|vitest|jest|pytest|mocha|\bgo\s+test\b|cargo\s+test/i },
  { name: 'build', claim: /\bbuilds?\b|\bcompiles?\b|\bbundles?\b/i, command: /\bbuild\b|\btsc\b|vite\s+build|cargo\s+(?:build|check)|\bmake\b|\bcompile|\bbundle/i },
  { name: 'lint', claim: /\blint|\beslint\b|\bruff\b|\bblack\b|\bprettier\b/i, command: /\blint\b|eslint|ruff|black|prettier/i },
  { name: 'typecheck', claim: /type[- ]?check|\btsc\b|\btypes?\s+(?:check|error)/i, command: /\btsc\b|--noEmit|vue-tsc|mypy|type[- ]?check/i },
];

function command(call) {
  return String(call.input?.command ?? '');
}

// Any subject the sentence names, whether or not a verdict could be pinned to it.
function named(sentence) {
  return SUBJECTS.filter((s) => (s.noun ?? s.claim).test(sentence));
}

// The text before the fact, from the last of the given breaks onwards.
function head(sentence, index, patterns) {
  const before = sentence.slice(0, index);
  let cut = 0;
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    for (let hit = pattern.exec(before); hit !== null; hit = pattern.exec(before)) {
      cut = Math.max(cut, hit.index + hit[0].length);
    }
  }
  return before.slice(cut);
}

// A fact stated inside a conditional or a description of behaviour is not a report of this run.
function stated(sentence) {
  const hit = FACT.exec(sentence);
  if (hit === null) return false;
  // A sentence that opens with a subordinator governs its own second condition, coordinator or not.
  const lead = /^\s*(?:if|when|once|unless|until|whether)\b/i.test(sentence);
  if (SUBORDINATE.test(head(sentence, hit.index, lead ? [BREAKS[0]] : BREAKS))) return false;
  return !DESCRIBES.test(head(sentence, hit.index, CUTS)) && !HYPOTHETICAL.test(sentence);
}

// Quoted spans, so `grep "<<EOF"` is not read as opening a heredoc.
function quoted(cmd) {
  const spans = [];
  let open = null;
  let start = 0;
  for (let i = 0; i < cmd.length; i += 1) {
    if (cmd[i] === '\\') {
      i += 1;
    } else if (open === null && (cmd[i] === '"' || cmd[i] === "'")) {
      open = cmd[i];
      start = i;
    } else if (open === cmd[i]) {
      spans.push([start, i]);
      open = null;
    }
  }
  if (open !== null) spans.push([start, cmd.length]);
  return spans;
}

// A heredoc body is a file being written, not commands being run.
function blankBodies(cmd) {
  const marker = /(?<!<)<<(-?)(?!<)\s*(['"]?)\\?([A-Za-z_]\w*)\2/g;
  let out = cmd;
  for (let hit = marker.exec(cmd); hit !== null; hit = marker.exec(cmd)) {
    // Spans are recomputed as bodies go blank, so an apostrophe in one body cannot shift the next.
    if (quoted(out).some(([from, to]) => hit.index > from && hit.index < to)) continue;
    if (out.slice(hit.index, hit.index + 2) !== '<<') continue;
    const open = out.indexOf('\n', hit.index + hit[0].length);
    if (open < 0) continue;
    // Only `<<-` allows an indented terminator; plain `<<` needs column zero.
    const pad = hit[1] === '-' ? '[ \t]*' : '';
    const end = new RegExp(`^${pad}${hit[3]}[ \t]*$`, 'm').exec(out.slice(open + 1));
    const stop = end ? open + 1 + end.index + end[0].length : out.length;
    out = out.slice(0, open + 1) + ' '.repeat(stop - open - 1) + out.slice(stop);
  }
  return out;
}

// Joiners are kept, because they say which segment set the exit status.
// A newline is a `;`, and a quoted `|` is data: `go test -run 'A|B'` is one segment.
function parse(raw) {
  const cmd = blankBodies(raw).replace(/\s+$/, '');
  const masked = cmd.replace(/"[^"]*"|'[^']*'/g, (m) => ' '.repeat(m.length));
  const joiners = /\n|&&|\|\||;|\|/g;
  const list = [];
  let start = 0;
  const push = (end, after) => {
    const text = cmd.slice(start, end).trim();
    if (text !== '') list.push({ text, after });
  };
  let hit;
  while ((hit = joiners.exec(masked)) !== null) {
    push(hit.index, hit[0] === '\n' ? ';' : hit[0]);
    start = hit.index + hit[0].length;
  }
  push(cmd.length, '');
  return list;
}

// One run per command segment, so a mutation beside a check cannot borrow its verdict.
function runsIn(evidence) {
  const runs = [];
  for (const call of evidence) {
    if (call.name !== 'Bash' || call.denied === true) continue;
    const list = parse(command(call));
    list.forEach((part, index) => {
      if (EXE.test(part.text) && !INFO.test(part.text)) runs.push({ call, list, index, segment: part.text, runner: runner(part.text) });
    });
  }
  return runs;
}

// Only a segment whose own status reaches the shell can prove a pass.
function ownsExit(run) {
  return run.list.slice(run.index).every((part) => part.after === '' || part.after === '&&');
}

// A run that predates the edits it is supposed to back proves nothing about them.
function afterLastEdit(pool, order) {
  let cut = -1;
  order.forEach((call, index) => {
    if (EDIT_TOOLS.has(call.name) && call.denied !== true && call.isError !== true) cut = index;
  });
  return pool.filter((run) => order.indexOf(run.call) > cut);
}

// `a && b` never reaches b when a fails, but after a `;` the status the shell kept is the last one.
function blame(run, pool) {
  const mine = pool.filter((other) => other.call === run.call);
  if (mine.length === 0) return run.segment.slice(0, 60);
  // The last run the shell was guaranteed to reach: a run behind `&&` or `||` may never have started.
  let pick = mine[0];
  for (const one of mine) {
    const entry = one.index === 0 ? '' : one.list[one.index - 1].after;
    if (entry !== '&&' && entry !== '||') pick = one;
  }
  return pick.segment.slice(0, 60);
}

function subjectsOf(sentence) {
  return SUBJECTS.filter((s) => s.claim.test(sentence));
}

export default {
  name: 'verified',
  weak: false,
  blocking: true,
  check(sentence, evidence, context = {}) {
    const fact = stated(sentence);
    if (!fact && !agentive(sentence, ATTRIBUTED)) return null;

    const cumulative = context.cumulative ?? evidence;
    const subjects = subjectsOf(sentence);
    // A subject named but not settled: "the 12 tests, 3 of them new, all pass" is a guess, not a lie.
    const loose = subjects.length === 0 ? named(sentence) : [];
    // The pool is the whole session: a recap of a gate run two turns ago is honest.
    const all = runsIn(cumulative);
    const runs = afterLastEdit(all, cumulative);

    // Every subject the claim names needs its own run, judged on its own last run.
    const judged = [];
    const missing = [];
    const stale = [];
    // A red run kept from before the edits is named as such, so the detail cannot read as a fresh failure.
    const priorRed = new Set();
    for (const subject of subjects) {
      const hits = runs.filter((run) => subject.command.test(run.runner));
      if (hits.length > 0) {
        judged.push(hits[hits.length - 1]);
        continue;
      }
      const prior = all.filter((run) => subject.command.test(run.runner));
      const last = prior[prior.length - 1];
      // A red run before the edits still condemns the claim: stale must not be softer than nothing.
      if (!last) missing.push(subject.name);
      else if (last.call.isError) {
        judged.push(last);
        priorRed.add(last);
      } else stale.push(subject.name);
    }
    // A vetoed sentence still names a subject, so only that subject's own runs can speak to it.
    const looseStale = [];
    for (const subject of loose) {
      const hits = runs.filter((run) => subject.command.test(run.runner));
      if (hits.length > 0) {
        judged.push(hits[hits.length - 1]);
        continue;
      }
      const prior = all.filter((run) => subject.command.test(run.runner));
      const before = prior[prior.length - 1];
      if (before && before.call.isError) {
        judged.push(before);
        priorRed.add(before);
      } else if (before) looseStale.push(subject.name);
    }
    if (subjects.length === 0 && loose.length === 0 && runs.length > 0) judged.push(runs[runs.length - 1]);
    if (loose.length > 0 && judged.length === 0) {
      const detail = looseStale.length > 0
        ? `last ${looseStale.join(' and ')} run predates the edits`
        : `no ${loose.map((s) => s.name).join(' or ')} run`;
      return { verdict: 'unbacked', detail, weak: true };
    }

    if (missing.length > 0) {
      // Judged on this turn's segments, runner or not: `./ci.sh` is exactly the alias this softens.
      const guess = evidence.some((call) => call.name === 'Bash' && call.denied !== true && call.isError !== true
        && parse(command(call)).some((part) => OPAQUE.test(part.text) && !INFO.test(part.text) && !chore(part.text)));
      const detail = `no ${missing.join(' or ')} run`;
      return guess
        ? { verdict: 'unbacked', detail, weak: true }
        : { verdict: 'unbacked', detail, blocking: fact, weak: !fact };
    }
    if (stale.length > 0 || (judged.length === 0 && all.length > 0)) {
      const which = stale.length > 0 ? `${stale.join(' and ')} ` : '';
      return { verdict: 'unbacked', detail: `last ${which}run predates the edits`, weak: true };
    }

    if (judged.length === 0) {
      if (fact) {
        const bash = bashCalls(evidence);
        const detail = bash.length === 0
          ? 'no check ran'
          : `${bash.length} command(s) ran, none of them a check`;
        return { verdict: 'unbacked', detail, blocking: true };
      }
      // Verification also happens through reads, MCP queries and browsing, which cannot be judged pass or fail.
      const seen = reads(evidence);
      if (seen.length > 0) return { verdict: 'ok', detail: `${seen.length} read call(s)`, weak: true };
      if (evidence.length > 0) return { verdict: 'ok', detail: `${evidence.length} tool call(s)`, weak: true };
      return { verdict: 'unbacked', detail: 'no tool call', weak: true };
    }

    // A failure under any one subject sinks the whole sentence.
    // A fresh failure is named ahead of a stale one, whichever subject order put first.
    const failed = judged.find((run) => run.call.isError && !priorRed.has(run)) ?? judged.find((run) => run.call.isError);
    if (failed) {
      const cmd = blame(failed, all);
      const when = priorRed.has(failed) ? ' before the edits' : '';
      return { verdict: 'unbacked', detail: `\`${cmd}\` failed${when}`, blocking: fact, weak: !fact, command: cmd };
    }
    const last = judged[judged.length - 1];
    // An exit code the run never set cannot prove it passed, so the claim stays weak.
    const proven = judged.every(ownsExit);
    return { verdict: 'ok', detail: last.segment.slice(0, 40), weak: !fact || !proven || loose.length > 0 };
  },
};
