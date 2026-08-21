import { kinds } from './transcript.js';

export const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit']);
export const READ_TOOLS = new Set(['Read', 'Grep', 'Glob', 'NotebookRead']);
export const DELEGATE_TOOLS = new Set(['Agent', 'Task', 'SendMessage']);

export function windows(events) {
  const out = [];
  let buffer = [];
  for (const event of events) {
    if (event.kind === kinds.TOOL_USE) {
      buffer.push(event);
      continue;
    }
    if (event.kind === kinds.TEXT) {
      out.push({ text: event.text, ts: event.ts, cwd: event.cwd, evidence: buffer });
      buffer = [];
    }
  }
  return out;
}

export function editedFiles(evidence) {
  const files = new Set();
  for (const call of evidence) {
    if (!EDIT_TOOLS.has(call.name)) continue;
    const path = call.input?.file_path ?? call.input?.notebook_path;
    if (path) files.add(path);
  }
  return [...files];
}

export function bashCalls(evidence) {
  return evidence.filter((call) => call.name === 'Bash');
}

export function reads(evidence) {
  return evidence.filter((call) => READ_TOOLS.has(call.name));
}

export function delegated(evidence) {
  return evidence.some((call) => DELEGATE_TOOLS.has(call.name));
}
