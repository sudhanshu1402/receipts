import { families } from './families/index.js';
import { claimable } from './sanitize.js';
import { windows, editedFiles, bashCalls, delegated } from './window.js';
import { kinds } from './transcript.js';

const MAX_CLAIM = 72;

function trim(sentence) {
  return sentence.length > MAX_CLAIM ? `${sentence.slice(0, MAX_CLAIM - 1)}…` : sentence;
}

// The header must describe the same slice the rows do, or the numbers lie.
function summarize(events, since = null) {
  const scoped = since === null ? events : events.filter((e) => e.ts && e.ts > since);
  const stamps = scoped.map((e) => e.ts).filter(Boolean).sort();
  const tools = scoped.filter((e) => e.kind === kinds.TOOL_USE);
  return {
    from: stamps[0] ?? null,
    to: stamps[stamps.length - 1] ?? null,
    files: editedFiles(tools),
    toolCalls: tools.length,
    bashCalls: bashCalls(tools).length,
    failedCalls: tools.filter((e) => e.isError).length,
    spoke: scoped.filter((e) => e.kind === kinds.TEXT).length,
  };
}

// The cursor is a timestamp, not a turn number, because a rewind renumbers turns.
export function analyze(events, { since = null } = {}) {
  const findings = [];
  const cumulative = [];
  const now = new Date().toISOString();
  let turn = -1;
  let last = since;
  // Only the leading run of judged turns is skipped, so one odd stamp cannot silence the rest.
  let judging = since === null;
  for (const window of windows(events)) {
    turn += 1;
    cumulative.push(...window.evidence);
    // A stamp ahead of the clock can never be passed by the cursor, so it is left unjudged.
    if (window.ts !== null && window.ts > now) continue;
    if (window.ts && (last === null || window.ts > last)) last = window.ts;
    if (!judging) {
      if (window.ts === null || window.ts <= since) continue;
      judging = true;
    }
    const viaAgent = delegated(window.evidence);
    const context = { cumulative: [...cumulative] };
    for (const sentence of claimable(window.text)) {
      for (const family of families) {
        const result = family.check(sentence, window.evidence, context);
        if (!result) continue;
        findings.push({
          family: family.name,
          claim: trim(sentence),
          ts: window.ts,
          turn,
          verdict: result.verdict,
          detail: result.detail,
          viaAgent,
          weak: result.weak ?? family.weak ?? false,
          blocking: family.blocking === true && result.blocking === true && !viaAgent,
        });
      }
    }
  }
  return { findings, turns: turn + 1, since, lastTs: last, summary: summarize(events, since) };
}

export function tally(findings) {
  const counts = { ok: 0, short: 0, unbacked: 0, weak: 0, viaAgent: 0 };
  for (const finding of findings) {
    counts[finding.verdict] = (counts[finding.verdict] ?? 0) + 1;
    if (finding.weak) counts.weak += 1;
    if (finding.viaAgent) counts.viaAgent += 1;
  }
  counts.problems = findings.filter(
    (f) => f.verdict !== 'ok' && !f.weak && !f.viaAgent
  ).length;
  return counts;
}

export function firstBlocking(findings) {
  return findings.find((f) => f.blocking && f.verdict === 'unbacked') ?? null;
}
