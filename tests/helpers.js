let counter = 0;

function next() {
  counter += 1;
  return `uuid-${String(counter).padStart(4, '0')}`;
}

export function reset() {
  counter = 0;
}

function record(parentUuid, type, content, extra = {}) {
  const uuid = next();
  const rec = {
    uuid,
    parentUuid,
    type,
    // Fixed past date: analyze refuses to move its cursor to a future stamp.
    timestamp: extra.ts ?? `2026-01-15T10:${String(counter).padStart(2, '0')}:00.000Z`,
    cwd: extra.cwd ?? '/tmp/project',
    isSidechain: extra.sidechain ?? false,
    message: { role: type, content },
  };
  if (extra.toolUseResult) rec.toolUseResult = extra.toolUseResult;
  return rec;
}

// Builds a transcript the way Claude Code writes one: one block per record, chained by parentUuid.
export function transcript() {
  const records = [];
  let parent = null;

  const push = (rec) => {
    records.push(rec);
    parent = rec.uuid;
    return rec;
  };

  const api = {
    user(text, extra) {
      push(record(parent, 'user', text, extra));
      return api;
    },
    says(text, extra) {
      push(record(parent, 'assistant', [{ type: 'text', text }], extra));
      return api;
    },
    thinks(text, extra) {
      push(record(parent, 'assistant', [{ type: 'thinking', thinking: text }], extra));
      return api;
    },
    tool(name, input, { isError = false, denied = false, output = null, toolUseResult = null, ...extra } = {}) {
      const id = `tool-${next()}`;
      const content = output ?? (denied
        ? "The user doesn't want to proceed with this tool use. The tool use was rejected."
        : 'ok');
      push(record(parent, 'assistant', [{ type: 'tool_use', id, name, input }], extra));
      push(record(parent, 'user', [{ type: 'tool_result', tool_use_id: id, is_error: isError || denied, content }], { ...extra, toolUseResult }));
      return api;
    },
    agent(description, { agentId = null, ...extra } = {}) {
      return api.tool('Agent', { description }, { ...extra, toolUseResult: agentId ? { agentId, status: 'completed' } : null });
    },
    edit(path, extra) {
      return api.tool('Edit', { file_path: path }, extra);
    },
    bash(command, extra) {
      return api.tool('Bash', { command }, extra);
    },
    read(path, extra) {
      return api.tool('Read', { file_path: path }, extra);
    },
    branchFrom(uuid) {
      parent = uuid;
      return api;
    },
    at(index) {
      return records[index];
    },
    records() {
      return records;
    },
  };
  return api;
}
