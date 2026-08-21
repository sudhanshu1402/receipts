import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const RETAIN_DAYS = 30;

export function root() {
  return process.env.RECEIPTS_HOME ?? join(homedir(), '.claude', 'receipts');
}

function ensure(dir) {
  mkdirSync(dir, { recursive: true });
  return dir;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function statePath(sessionId, suffix) {
  return sessionId ? join(ensure(join(root(), 'state')), `${sessionId}.${suffix}`) : null;
}

export function markerPath(sessionId) {
  return statePath(sessionId, 'blocked');
}

// No session id means no key for the marker, so blocking is skipped.
export function alreadyBlocked(sessionId) {
  const path = markerPath(sessionId);
  return path === null || existsSync(path);
}

export function markBlocked(sessionId) {
  const path = markerPath(sessionId);
  if (path) writeFileSync(path, new Date().toISOString());
}

export function cursor(sessionId) {
  const path = statePath(sessionId, 'cursor');
  if (path === null || !existsSync(path)) return null;
  const value = readFileSync(path, 'utf8').trim();
  return value === '' ? null : value;
}

export function setCursor(sessionId, ts) {
  const path = statePath(sessionId, 'cursor');
  if (path && typeof ts === 'string' && ts !== '') writeFileSync(path, ts);
}

export function append({ sessionId, cwd, body, counts, families }) {
  const dir = ensure(root());
  const file = join(dir, `${today()}.md`);
  const block = [
    `## ${new Date().toISOString().slice(11, 19)}  ${cwd ?? ''}`,
    `session: ${sessionId ?? 'unknown'}`,
    '',
    '```',
    body,
    '```',
    `<!-- receipts:json ${JSON.stringify({ counts, families })} -->`,
    '',
  ].join('\n');
  appendFileSync(file, block);
  return file;
}

function pruneDir(dir, cutoff, prefix, owned) {
  if (!existsSync(dir)) return [];
  const removed = [];
  for (const name of readdirSync(dir)) {
    // Only files this tool writes: RECEIPTS_HOME may point at a directory holding other things.
    if (!owned.test(name)) continue;
    const path = join(dir, name);
    let info;
    try {
      info = statSync(path);
    } catch {
      continue;
    }
    if (info.isDirectory()) continue;
    if (info.mtimeMs < cutoff) {
      rmSync(path, { force: true });
      removed.push(`${prefix}${name}`);
    }
  }
  return removed;
}

export function prune(retainDays = RETAIN_DAYS) {
  const cutoff = Date.now() - retainDays * 86400000;
  return [
    ...pruneDir(root(), cutoff, '', /^\d{4}-\d{2}-\d{2}\.md$/),
    ...pruneDir(join(root(), 'state'), cutoff, 'state/', /\.(?:cursor|blocked)$/),
  ];
}

export function days(limit = 7) {
  const dir = root();
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir)
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.md$/.test(name))
    .sort()
    .slice(-limit);

  return files.map((name) => {
    const text = readFileSync(join(dir, name), 'utf8');
    const day = { date: name.slice(0, 10), problems: 0, checked: 0, families: {} };
    for (const match of text.matchAll(/<!-- receipts:json (.*?) -->/g)) {
      let parsed;
      try {
        parsed = JSON.parse(match[1]);
      } catch {
        continue;
      }
      day.problems += parsed.counts?.problems ?? 0;
      day.checked += parsed.counts?.checked ?? 0;
      for (const [family, n] of Object.entries(parsed.families ?? {})) {
        day.families[family] = (day.families[family] ?? 0) + n;
      }
    }
    return day;
  });
}
