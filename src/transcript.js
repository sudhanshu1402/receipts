import { createReadStream } from 'node:fs';
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

export function toEvents(records) {
  const chain = activeChain(records);
  const events = [];
  for (const record of chain) {
    for (const event of normalize(record)) {
      if (event.sidechain) continue;
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
  }
  return events;
}

export async function loadEvents(path) {
  return toEvents(await readRecords(path));
}

export const kinds = { TEXT, TOOL_USE, TOOL_RESULT };
