#!/usr/bin/env node
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEvents } from '../src/transcript.js';
import { analyze, resolveDelegates, tally, firstBlocking } from '../src/analyze.js';
import { receipt, blockLine, statusline, digest } from '../src/render.js';
import * as store from '../src/store.js';

const USAGE = `receipts — checks what the agent said it did against what it did

  receipts hook              read a Claude Code hook payload on stdin (Stop)
  receipts show [id|path]    print the receipt for a session, newest by default
  receipts statusline        one short segment for your statusline
  receipts digest [days]     trend across stored receipts, default 7
`;

function projectsDir() {
  return join(homedir(), '.claude', 'projects');
}

// Claude Code replaces every non-alphanumeric character, not only slashes.
function slug(cwd) {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

function newestIn(dir) {
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.jsonl'))
    .map((name) => join(dir, name));
  if (files.length === 0) return null;
  return files.reduce((a, b) => (statSync(b).mtimeMs > statSync(a).mtimeMs ? b : a));
}

function findTranscript(target) {
  if (target && existsSync(target)) return target;
  const base = projectsDir();
  if (target) {
    if (!existsSync(base)) return null;
    for (const project of readdirSync(base)) {
      const candidate = join(base, project, `${target}.jsonl`);
      if (existsSync(candidate)) return candidate;
    }
    return null;
  }
  return newestIn(join(base, slug(process.cwd())));
}

async function read(transcript, options = {}) {
  const events = await loadEvents(transcript);
  return analyze(events, { ...options, delegates: await resolveDelegates(events, transcript) });
}

async function readStdin() {
  if (process.stdin.isTTY) return {};
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    return {};
  }
}

function familyCounts(findings) {
  const counts = {};
  for (const finding of findings) {
    if (finding.verdict === 'ok' || finding.weak || finding.viaAgent) continue;
    counts[finding.family] = (counts[finding.family] ?? 0) + 1;
  }
  return counts;
}

async function runHook() {
  const payload = await readStdin();
  const transcript = payload.transcript_path;
  if (!transcript || !existsSync(transcript)) return 0;

  // Stop fires every turn, so only claims since the last run are judged.
  const sessionId = payload.session_id ?? null;
  const result = await read(transcript, { since: store.cursor(sessionId) });
  const counts = tally(result.findings);
  store.setCursor(sessionId, result.lastTs);

  if (result.findings.length === 0) return 0;

  store.append({
    sessionId,
    cwd: payload.cwd ?? process.cwd(),
    body: receipt(result),
    counts: { ...counts, checked: result.findings.length },
    families: familyCounts(result.findings),
  });
  store.prune();

  const worst = firstBlocking(result.findings);
  const reBlocking = payload.stop_hook_active === true || store.alreadyBlocked(sessionId);
  if (worst && !reBlocking) {
    store.markBlocked(sessionId);
    process.stderr.write(`${blockLine(worst)}\n`);
    return 2;
  }

  process.stdout.write(`${receipt(result)}\n`);
  return 0;
}

async function runShow(target) {
  const transcript = findTranscript(target);
  if (!transcript) {
    process.stderr.write('receipts: no transcript found for this folder\n');
    return 1;
  }
  process.stdout.write(`${receipt(await read(transcript))}\n`);
  return 0;
}

async function runStatusline() {
  const payload = await readStdin();
  const transcript = payload.transcript_path ?? findTranscript(null);
  if (!transcript || !existsSync(transcript)) return 0;
  const line = statusline(await read(transcript));
  if (line) process.stdout.write(line);
  return 0;
}

function runDigest(daysArg) {
  const n = Number.parseInt(daysArg ?? '7', 10);
  process.stdout.write(`${digest(store.days(Number.isFinite(n) && n > 0 ? n : 7))}\n`);
  return 0;
}

async function main() {
  const [mode, arg] = process.argv.slice(2);
  switch (mode) {
    case 'hook':
      return runHook();
    case 'show':
      return runShow(arg);
    case 'statusline':
      return runStatusline();
    case 'digest':
      return runDigest(arg);
    default:
      process.stdout.write(USAGE);
      return mode ? 1 : 0;
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    // A hook that throws must not break the session.
    if (process.argv[2] !== 'hook') process.stderr.write(`receipts: ${error.message}\n`);
    process.exitCode = process.argv[2] === 'hook' ? 0 : 1;
  });
