import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { transcript, reset } from './helpers.js';

const BIN = join(dirname(dirname(fileURLToPath(import.meta.url))), 'bin', 'receipts.js');

function run(mode, payload, home) {
  try {
    const stdout = execFileSync(process.execPath, [BIN, mode], {
      input: JSON.stringify(payload),
      env: { ...process.env, RECEIPTS_HOME: home },
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { code: 0, stdout, stderr: '' };
  } catch (error) {
    return { code: error.status, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
  }
}

function fixture(build) {
  reset();
  const dir = mkdtempSync(join(tmpdir(), 'receipts-hook-'));
  const path = join(dir, 'session.jsonl');
  writeFileSync(path, build(transcript()).records().map((r) => JSON.stringify(r)).join('\n'));
  return { dir, path };
}

test('a lie exits 2 with one line on stderr, and only once per session', () => {
  const { dir, path } = fixture((t) => t.bash('npm test', { isError: true }).says('Tests pass.'));
  try {
    const payload = { transcript_path: path, session_id: 's1', cwd: '/tmp/project' };
    const first = run('hook', payload, dir);
    assert.equal(first.code, 2);
    assert.match(first.stderr, /^receipts: you said "Tests pass\." but/);
    assert.equal(first.stderr.trim().split('\n').length, 1);

    const second = run('hook', payload, dir);
    assert.equal(second.code, 0, 'a second Stop must not re-block, or the session loops');

    const flagged = run('hook', { ...payload, session_id: 's2', stop_hook_active: true }, dir);
    assert.equal(flagged.code, 0, 'stop_hook_active must also suppress the block');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an honest session exits 0 and still writes a receipt', () => {
  const { dir, path } = fixture((t) => t.edit('/tmp/a.ts').bash('npm test').says('Fixed one file and tests pass.'));
  try {
    const result = run('hook', { transcript_path: path, session_id: 's3', cwd: '/tmp/project' }, dir);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /SESSION RECEIPT/);
    assert.match(run('digest', {}, dir).stdout, /RECEIPTS DIGEST/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a missing or unreadable transcript is a silent exit 0', () => {
  const dir = mkdtempSync(join(tmpdir(), 'receipts-hook-'));
  try {
    assert.equal(run('hook', {}, dir).code, 0);
    assert.equal(run('hook', { transcript_path: '/nope/nope.jsonl' }, dir).code, 0);
    assert.equal(run('hook', {}, dir).stdout, '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the statusline stays empty on a clean session', () => {
  const { dir, path } = fixture((t) => t.edit('/tmp/a.ts').bash('npm test').says('Tests pass.'));
  try {
    assert.equal(run('statusline', { transcript_path: path }, dir).stdout, '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('with no mode it prints usage and exits 0', () => {
  const dir = mkdtempSync(join(tmpdir(), 'receipts-hook-'));
  try {
    const result = run('', {}, dir);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /receipts hook/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
