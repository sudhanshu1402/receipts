import { tally } from './analyze.js';

const MARK = { ok: 'ok', short: 'short', unbacked: 'unbacked' };

const two = (n) => String(n).padStart(2, '0');

// A session that crosses midnight carries its date, so 02:24-02:23 cannot read backwards.
function clock(iso, dated = false) {
  if (!iso) return '--:--';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--:--';
  const time = `${two(d.getHours())}:${two(d.getMinutes())}`;
  return dated ? `${two(d.getMonth() + 1)}-${two(d.getDate())} ${time}` : time;
}

function crossesDay(from, to) {
  const a = new Date(from);
  const b = new Date(to);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return false;
  return a.toDateString() !== b.toDateString();
}

function span(from, to) {
  if (!from || !to) return null;
  const ms = new Date(to) - new Date(from);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h${two(mins % 60)}m`;
  return `${Math.floor(hours / 24)}d${hours % 24}h`;
}

function pad(text, width) {
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

export function receipt({ findings, summary }) {
  const counts = tally(findings);
  const head = [
    'SESSION RECEIPT',
    `${clock(summary.from, dated)}-${clock(summary.to, dated)}`,
    span(summary.from, summary.to) ?? '',
    `${summary.files.length} file(s)`,
    `${summary.toolCalls} tool calls`,
  ].filter(Boolean).join('  ');

  if (findings.length === 0) {
    return `${head}\nno checkable claims this session.`;
  }
  if (counts.problems === 0) {
    return `${head}\n${findings.length} claim(s) checked, all backed.`;
  }

  const width = Math.min(
    72,
    Math.max(24, ...findings.map((f) => f.claim.length + 2))
  );
  const rows = findings.map((f) => {
    const tags = [MARK[f.verdict] ?? f.verdict];
    if (f.weak) tags.push('weak');
    if (f.viaAgent) tags.push('via subagent');
    return `${pad(`"${f.claim}"`, width)} ${pad(f.detail ?? '', 30)} ${tags.join(', ')}`;
  });

  const foot = [`${counts.problems} unbacked or short`];
  if (counts.weak > 0) foot.push(`${counts.weak} weak signal`);
  if (counts.viaAgent > 0) foot.push(`${counts.viaAgent} delegated, not judged`);

  return [head, '', `${pad('CLAIMED', width)} ${pad('EVIDENCE', 30)} VERDICT`, ...rows, '', foot.join('  ')].join('\n');
}

export function blockLine(finding) {
  return `receipts: you said "${finding.claim}" but ${finding.detail}. Prove it or retract it.`;
}

export function statusline({ findings }) {
  const counts = tally(findings);
  if (counts.problems === 0) return '';
  return `receipts ${counts.problems}!`;
}

export function digest(days) {
  const rows = [...days].sort((a, b) => a.date.localeCompare(b.date));
  if (rows.length === 0) return 'no receipts stored yet.';

  const byFamily = new Map();
  let problems = 0;
  let checked = 0;
  for (const day of rows) {
    problems += day.problems ?? 0;
    checked += day.checked ?? 0;
    for (const [family, n] of Object.entries(day.families ?? {})) {
      byFamily.set(family, (byFamily.get(family) ?? 0) + n);
    }
  }

  const worst = [...byFamily.entries()].sort((a, b) => b[1] - a[1]);
  const half = Math.floor(rows.length / 2);
  const early = rows.slice(0, half).reduce((n, d) => n + (d.problems ?? 0), 0);
  const late = rows.slice(rows.length - half).reduce((n, d) => n + (d.problems ?? 0), 0);
  const trend = half === 0 ? 'not enough days to trend' : late < early ? 'improving' : late > early ? 'getting worse' : 'flat';

  return [
    `RECEIPTS DIGEST  ${rows[0].date} to ${rows[rows.length - 1].date}  ${rows.length} day(s)`,
    `${checked} claim(s) checked, ${problems} unbacked or short`,
    worst.length === 0 ? '' : `worst family: ${worst[0][0]} (${worst[0][1]})`,
    `trend: ${trend}`,
  ].filter(Boolean).join('\n');
}
