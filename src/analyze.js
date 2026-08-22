import { families } from './families/index.js';
import { claimable } from './sanitize.js';
import { windows, editedFiles, bashCalls, delegateCalls, delegatedIds } from './window.js';
import { kinds, loadAgentEvents } from './transcript.js';

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

// A subagent's tool calls are real work, so they are evidence; its own sentences are not judged.
export async function resolveDelegates(events, transcriptPath) {
  const found = new Map();
  if (!transcriptPath) return found;
  const queue = delegatedIds(events.filter((e) => e.kind === kinds.TOOL_USE));
  const seen = new Set(queue);
  while (queue.length > 0) {
    const id = queue.shift();
    const agent = await loadAgentEvents(transcriptPath, id);
    if (!agent) continue;
    const calls = agent.filter((e) => e.kind === kinds.TOOL_USE);
    found.set(id, calls);
    // A subagent can delegate onward, and that deeper file holds the run its own file lacks.
    for (const next of delegatedIds(calls)) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return found;
}

// A missing stamp inherits the previous one, so it keeps its place instead of sorting to the
// front as the oldest thing in the window, and a dateless run is never dropped from evidence.
function filled(events) {
  const keyed = [];
  let carry = '';
  for (const event of events) {
    if (event.ts) carry = event.ts;
    keyed.push([carry, event]);
  }
  return keyed;
}

function ordered(evidence, extra) {
  const keyed = [...filled(evidence), ...filled(extra)];
  return keyed.sort((a, b) => a[0].localeCompare(b[0])).map(([, event]) => event);
}

// Only what the subagent had finished when the sentence was written can back it. A background
// agent that runs on afterwards is not evidence for a claim made before it started.
function collect(calls, delegates, cutoff, seen) {
  const out = [];
  for (const call of calls) {
    if (!call.agentId) return null;
    if (seen.has(call.agentId)) continue;
    seen.add(call.agentId);
    const agent = delegates.get(call.agentId);
    if (!agent) return null;
    const before = filled(agent).filter(([ts]) => ts <= cutoff).map(([, event]) => event);
    if (before.length === 0) return null;
    const nested = collect(delegateCalls(before), delegates, cutoff, seen);
    if (nested === null) return null;
    out.push(...before, ...nested);
  }
  return out;
}

// Incomplete evidence is worse than none: one unreadable subagent leaves the whole window unjudged.
function harvest(evidence, delegates, cutoff) {
  const calls = delegateCalls(evidence);
  if (calls.length === 0) return { evidence, viaAgent: false, extra: [] };
  const extra = cutoff === null ? null : collect(calls, delegates, cutoff, new Set());
  if (extra === null) return { evidence, viaAgent: true, extra: [] };
  return { evidence: ordered(evidence, extra), viaAgent: false, extra };
}

// The cursor is a timestamp, not a turn number, because a rewind renumbers turns.
export function analyze(events, { since = null, delegates = new Map() } = {}) {
  const findings = [];
  const cumulative = [];
  const harvested = [];
  // Two windows can delegate to one agent, and the second cutoff re-collects the first slice.
  const counted = new Set();
  const now = new Date().toISOString();
  let turn = -1;
  let last = since;
  // Only the leading run of judged turns is skipped, so one odd stamp cannot silence the rest.
  let judging = since === null;
  for (const raw of windows(events)) {
    turn += 1;
    const { evidence, viaAgent, extra } = harvest(raw.evidence, delegates, raw.ts);
    const window = { ...raw, evidence };
    cumulative.push(...evidence);
    // A stamp ahead of the clock can never be passed by the cursor, so it is left unjudged.
    if (window.ts !== null && window.ts > now) continue;
    if (window.ts && (last === null || window.ts > last)) last = window.ts;
    if (!judging) {
      if (window.ts === null || window.ts <= since) continue;
      judging = true;
    }
    for (const event of extra) {
      if (counted.has(event)) continue;
      counted.add(event);
      harvested.push(event);
    }
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
  // The header counts the subagents' work too, or it contradicts the rows that were judged on it.
  return { findings, turns: turn + 1, since, lastTs: last, summary: summarize([...events, ...harvested], since) };
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
