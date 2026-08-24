#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transcript } from '../tests/helpers.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ponytail: width is glyph-count * CELL, so a monospace face wider than 0.6em would clip the
// right edge. Every common one is 0.55-0.6023em. Upgrade path: measure with a real text shaper.
const CELL = 8.4;
const LINE = 22;
const PAD = 26;
const BAR = 38;

const COLOR = {
  bg: '#0d1117',
  bar: '#161b22',
  chrome: '#30363d',
  head: '#e6edf3',
  dim: '#7d8590',
  text: '#c9d1d9',
  bad: '#f85149',
  warn: '#d29922',
  good: '#3fb950',
};

function lie() {
  const t = transcript();
  t.user('fix the failing suite');
  t.edit('/tmp/project/src/auth.js');
  t.edit('/tmp/project/src/session.js');
  t.edit('/tmp/project/src/token.js');
  t.bash('npm test', { isError: true, output: '3 failing' });
  t.says('Fixed all 9 files. Tests pass. I pushed the branch.');
  return t;
}

function honest() {
  const t = transcript();
  t.user('add the retry');
  t.edit('/tmp/project/src/queue.js');
  t.bash('npm test', { output: '42 passing' });
  t.says('Added the retry. Tests pass.');
  return t;
}

// The clock prints local hours, so without a fixed zone the images differ per contributor.
function sandbox(build, body) {
  const dir = mkdtempSync(join(tmpdir(), 'receipts-svg-'));
  try {
    const path = join(dir, 'demo.jsonl');
    const lines = build().records().map((record) => JSON.stringify(record));
    writeFileSync(path, `${lines.join('\n')}\n`);
    return body(path, { ...process.env, TZ: 'UTC', RECEIPTS_HOME: join(dir, 'home') });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// The picture is real program output, so a change in rendering shows up in the image.
function run(build, args) {
  return sandbox(build, (path, env) => {
    const out = execFileSync(process.execPath, [join(ROOT, 'bin', 'receipts.js'), ...args, path], {
      encoding: 'utf8',
      env,
    });
    return out.replace(/\n+$/, '').split('\n');
  });
}

// The block is the one line that reaches the model, and it arrives on stderr with exit 2.
function block(build) {
  return sandbox(build, (path, env) => {
    const proc = spawnSync(process.execPath, [join(ROOT, 'bin', 'receipts.js'), 'hook'], {
      encoding: 'utf8',
      input: JSON.stringify({ transcript_path: path, session_id: 'demo', cwd: dirname(path) }),
      env,
    });
    if (proc.status !== 2) throw new Error(`expected exit 2 from the hook, got ${proc.status}`);
    return proc.stderr.replace(/\n+$/, '').split('\n');
  });
}

function escape(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// SVG collapses runs of spaces and xml:space is not honoured consistently, so the columns are
// held apart by non-breaking spaces, which carry the same advance width in a monospace face.
function cells(text) {
  return escape(text).replace(/ /g, '\u00a0');
}

function colorOf(line, index) {
  if (index === 0) return COLOR.head;
  if (/^CLAIMED/.test(line)) return COLOR.dim;
  if (/all backed/.test(line)) return COLOR.good;
  if (/unbacked or short/.test(line)) return COLOR.bad;
  return COLOR.text;
}

// The verdict is followed by its own tags (`unbacked, weak`), so the tint runs to end of line.
function spans(line, index) {
  const base = colorOf(line, index);
  const verdict = base === COLOR.text ? line.match(/\s(ok|short|unbacked)(,.*)?$/) : null;
  if (!verdict) return `<tspan fill="${base}">${cells(line)}</tspan>`;
  const head = line.slice(0, verdict.index + 1);
  const tint = verdict[1] === 'ok' ? COLOR.good : verdict[1] === 'unbacked' ? COLOR.bad : COLOR.warn;
  return `<tspan fill="${base}">${cells(head)}</tspan><tspan fill="${tint}">${cells(line.slice(verdict.index + 1))}</tspan>`;
}

const MONO = 'ui-monospace,SFMono-Regular,Menlo,monospace';
const LOOP = 12;
const TYPED = 1.8;

function at(seconds) {
  return (Math.min(seconds, LOOP) / LOOP).toFixed(4);
}

function frame(width, height, title, extra = '') {
  const dots = ['#ff5f57', '#febc2e', '#28c840']
    .map((fill, i) => `<circle cx="${20 + i * 18}" cy="19" r="6" fill="${fill}"/>`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escape(title)}">
${extra}  <rect width="${width}" height="${height}" rx="10" fill="${COLOR.bg}" stroke="${COLOR.chrome}"/>
  <path d="M0 10a10 10 0 0 1 10-10h${width - 20}a10 10 0 0 1 10 10v28H0z" fill="${COLOR.bar}"/>
  ${dots}
  <text x="${PAD + 48}" y="23" font-family="${MONO}" font-size="12" fill="${COLOR.dim}">${escape(title)}</text>`;
}

function box(lines, title, extraRows = 0) {
  return {
    width: Math.round(Math.max(...lines.map((l) => l.length), title.length + 24) * CELL + PAD * 2),
    height: BAR + (lines.length + extraRows) * LINE + PAD,
  };
}

// Base values are the finished frame, so a renderer that ignores SMIL shows the whole terminal,
// and the animation plays once rather than moving forever under an <img> nobody can pause.
function animated(lines, command, title) {
  const typed = command.length + 2;
  const caret = PAD + typed * CELL;
  const step = Math.min(0.32, (LOOP - TYPED - 1.5) / Math.max(lines.length, 1));
  const { width, height } = box([`$ ${command}`, ...lines], title, 2);
  const typing = `  <defs>
    <clipPath id="typing">
      <rect x="${PAD}" y="${BAR}" width="${typed * CELL}" height="${LINE}">
        <animate attributeName="width" values="0;0;${typed * CELL};${typed * CELL}" keyTimes="0;${at(0.4)};${at(TYPED)};1" dur="${LOOP}s" repeatCount="1"/>
      </rect>
    </clipPath>
  </defs>
`;
  const body = lines
    .map((line, i) => {
      const show = at(TYPED + 0.4 + i * step);
      const y = BAR + 16 + (i + 2) * LINE;
      return `<text x="${PAD}" y="${y}">${spans(line, i)}<animate attributeName="opacity" values="0;0;1;1" keyTimes="0;${show};${(Number(show) + 0.008).toFixed(4)};1" dur="${LOOP}s" repeatCount="1"/></text>`;
    })
    .join('\n    ');
  return `${frame(width, height, title, typing)}
  <g font-family="${MONO}" font-size="14" font-weight="500">
    <g clip-path="url(#typing)"><text x="${PAD}" y="${BAR + 16}" fill="${COLOR.good}">$&#160;<tspan fill="${COLOR.head}">${cells(command)}</tspan></text></g>
    <rect x="${caret}" y="${BAR + 4}" width="8" height="16" fill="${COLOR.head}">
      <animate attributeName="x" values="${PAD};${PAD};${caret};${caret}" keyTimes="0;${at(0.4)};${at(TYPED)};1" dur="${LOOP}s" repeatCount="1"/>
      <animate attributeName="opacity" values="1;0;1;0;1" keyTimes="0;0.25;0.5;0.75;1" dur="1.1s" repeatCount="11"/>
    </rect>
    ${body}
  </g>
</svg>
`;
}

const FLOW = [
  ['AGENT', [['"Tests pass."', COLOR.text], ['"Pushed the branch."', COLOR.text]]],
  ['TRANSCRIPT', [['session.jsonl', COLOR.text], ['written as it happens', COLOR.dim]]],
  ['RECEIPTS', [['4 families compare', COLOR.text], ['claim vs tool calls', COLOR.dim]]],
  ['VERDICT', [['ok, stays silent', COLOR.good], ['unbacked, exit 2', COLOR.bad]]],
];

function flow() {
  const width = 880;
  const height = 200;
  const boxes = FLOW.map(([role, rows], i) => {
    const x = 20 + i * 220;
    const head = `<rect x="${x}" y="52" width="180" height="96" rx="8" fill="${COLOR.bar}" stroke="${COLOR.chrome}"/>
  <text x="${x + 16}" y="78" fill="${COLOR.dim}" font-size="11" letter-spacing="1">${role}</text>`;
    const text = rows
      .map(([line, fill], r) => `<text x="${x + 16}" y="${104 + r * 22}" fill="${fill}" font-size="13">${cells(line)}</text>`)
      .join('\n  ');
    const arrow = i === 3
      ? ''
      : `<path d="M${x + 186} 100h22" stroke="${COLOR.chrome}" stroke-width="2"/><path d="M${x + 208} 94l12 6-12 6z" fill="${COLOR.chrome}"/>`;
    return `${head}\n  ${text}\n  ${arrow}`;
  }).join('\n  ');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="An agent claims tests pass; Claude Code writes the session transcript to disk; receipts compares the claim against the recorded tool calls and either stays silent or exits 2">
  <rect width="${width}" height="${height}" rx="10" fill="${COLOR.bg}" stroke="${COLOR.chrome}"/>
  <g font-family="${MONO}">
  <text x="20" y="32" fill="${COLOR.head}" font-size="14" font-weight="600">how a receipt happens</text>
  ${boxes}
  <text x="20" y="180" fill="${COLOR.dim}" font-size="12">receipts reads the file on disk, never the conversation, so it costs 0 context tokens and cannot be argued with</text>
  </g>
</svg>
`;
}

function svg(lines, title) {
  const { width, height } = box(lines, title);
  const rows = lines
    .map((line, i) => `<text x="${PAD}" y="${BAR + 16 + i * LINE}">${spans(line, i)}</text>`)
    .join('\n    ');
  return `${frame(width, height, title)}
  <g font-family="${MONO}" font-size="14" font-weight="500">
    ${rows}
  </g>
</svg>
`;
}

mkdirSync(join(ROOT, 'assets'), { recursive: true });
// A rule change that stops the demo from being caught would otherwise write a blank picture
// while the README's alt text still promised three findings.
function must(lines, expected) {
  for (const want of expected) {
    if (!lines.some((line) => want.test(line))) {
      throw new Error(`${want} is missing from the captured output:\n${lines.join('\n')}`);
    }
  }
  return lines;
}

const caught = must(run(lie, ['show']), [/ short$/, /"Tests pass\." .* unbacked$/, /no git push .* unbacked$/, /^3 unbacked or short$/]);

const shots = [
  ['demo.svg', animated(caught, 'receipts show', 'receipts show')],
  ['flow.svg', flow()],
  ['clean.svg', svg(must(run(honest, ['show']), [/all backed\.$/]), 'receipts show')],
  ['block.svg', svg(must(block(lie), [/^receipts: you said "Tests pass\." but/]), 'Stop hook, exit 2')],
];
for (const [name, markup] of shots) {
  writeFileSync(join(ROOT, 'assets', name), markup);
  process.stdout.write(`wrote assets/${name}\n`);
}
