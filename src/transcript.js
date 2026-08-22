import { createReadStream, existsSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { createInterface } from 'node:readline';

const TEXT = 'text';
const TOOL_USE = 'tool_use';
const TOOL_RESULT = 'tool_result';

function blocks(record) {
  const content = record?.message?.content;
  if (Array.isArray(content)) return content;
  if (typeof content === 'string') return [{ type: TEXT, text: content, injected: true }];
  return [];
}

// A refusal is anchored and errored: the same phrase inside output is a result, not a refusal.
const DENIED = /^(?:\[request interrupted by user|the user (?:doesn['’]t want to (?:proceed|take this action)|rejected)|tool use was rejected|user rejected tool use)/i;

function resultText(block) {
  const content = block.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => (typeof part === 'string' ? part : part?.text ?? '')).join(' ');
  }
  return '';
}

function normalize(record) {
  const base = {
    uuid: record.uuid,
    parentUuid: record.parentUuid ?? null,
    ts: record.timestamp ?? null,
    role: record.message?.role ?? record.type ?? null,
    sidechain: record.isSidechain === true,
    cwd: record.cwd ?? null,
  };
  const events = [];
  for (const block of blocks(record)) {
    if (!block || typeof block !== 'object') continue;
    if (block.type === TEXT && base.role === 'assistant') {
      events.push({ ...base, kind: TEXT, text: block.text ?? '' });
    } else if (block.type === TOOL_USE) {
      events.push({ ...base, kind: TOOL_USE, id: block.id, name: block.name, input: block.input ?? {} });
    } else if (block.type === TOOL_RESULT) {
      events.push({
        ...base,
        kind: TOOL_RESULT,
        toolUseId: block.tool_use_id,
        isError: block.is_error === true,
        denied: block.is_error === true && DENIED.test(resultText(block).trim()),
        // toolUseResult sits on the record, not in the content block, and names the subagent's own file.
        agentId: record.toolUseResult?.agentId ?? null,
      });
    }
  }
  return events;
}

// A compaction hangs the previous thread off logicalParentUuid, not parentUuid.
function parentOf(record) {
  return record.parentUuid ?? record.logicalParentUuid ?? null;
}

// A rewind interleaves abandoned records, so walk parents from the newest leaf.
export function activeChain(input) {
  const records = (input ?? []).filter((r) => r && typeof r === 'object' && r.uuid);
  if (records.length === 0) return [];
  const byUuid = new Map();
  const hasChild = new Set();
  for (const r of records) {
    byUuid.set(r.uuid, r);
    const parent = parentOf(r);
    if (parent) hasChild.add(parent);
  }
  const leaves = records.filter((r) => !hasChild.has(r.uuid));
  const pool = leaves.length > 0 ? leaves : records;
  const newest = pool.reduce((a, b) => ((b.timestamp ?? '') > (a.timestamp ?? '') ? b : a));

  const chain = [];
  const seen = new Set();
  let node = newest;
  while (node && !seen.has(node.uuid)) {
    seen.add(node.uuid);
    chain.push(node);
    const parent = parentOf(node);
    node = parent ? byUuid.get(parent) : null;
  }
  return chain.reverse();
}

export async function readRecords(path) {
  const records = [];
  const stream = createInterface({ input: createReadStream(path, 'utf8'), crlfDelay: Infinity });
  for await (const line of stream) {
    if (line.trim() === '') continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      continue;
    }
  }
  return records;
}

// A subagent's file is all sidechain; a sidechain record in a main transcript is still not speech.
export function toEvents(records, { sidechain = false } = {}) {
  const chain = activeChain(records);
  const events = [];
  for (const record of chain) {
    for (const event of normalize(record)) {
      if (event.sidechain !== sidechain) continue;
      events.push(event);
    }
  }
  const resultById = new Map();
  for (const event of events) {
    if (event.kind === TOOL_RESULT) resultById.set(event.toolUseId, event);
  }
  for (const event of events) {
    if (event.kind !== TOOL_USE) continue;
    const result = resultById.get(event.id);
    event.isError = result?.isError ?? false;
    event.denied = result?.denied ?? false;
    event.agentId = result?.agentId ?? null;
  }
  return events;
}

export async function loadEvents(path) {
  return toEvents(await readRecords(path));
}

// The id comes out of the transcript, so it must not be able to walk out of the session directory.
const AGENT_ID = /^[A-Za-z0-9_-]+$/;

export function subagentPath(transcriptPath, agentId) {
  if (typeof agentId !== 'string' || !AGENT_ID.test(agentId)) return null;
  const session = basename(transcriptPath, extname(transcriptPath));
  return join(dirname(transcriptPath), session, 'subagents', `agent-${agentId}.jsonl`);
}

// Absent is normal: sessions older than the subagents/ layout have the id but no file.
export async function loadAgentEvents(transcriptPath, agentId) {
  const path = subagentPath(transcriptPath, agentId);
  if (path === null || !existsSync(path)) return null;
  return toEvents(await readRecords(path), { sidechain: true });
}

export const kinds = { TEXT, TOOL_USE, TOOL_RESULT };
