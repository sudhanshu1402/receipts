import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toEvents } from '../src/transcript.js';
import { windows } from '../src/window.js';
import { byName } from '../src/families/index.js';
import { claimable } from '../src/sanitize.js';
import { transcript, reset } from './helpers.js';

function evidence(build) {
  reset();
  const wins = windows(toEvents(build(transcript()).says('done').records()));
  return wins[wins.length - 1].evidence;
}

const counting = byName('counting');
const verified = byName('verified');
const outward = byName('outward');
const reading = byName('reading');

test('counting catches a claim bigger than the edits', () => {
  const ev = evidence((t) => t.edit('/tmp/a.ts'));
  const result = counting.check('Fixed all 3 files.', ev);
  assert.equal(result.verdict, 'short');
  assert.equal(result.short, 2);
  assert.equal(result.detail, 'claimed 3, edited 1');
});

test('counting passes when the edits match or exceed the claim', () => {
  const ev = evidence((t) => t.edit('/tmp/a.ts').edit('/tmp/b.ts'));
  assert.equal(counting.check('Fixed both files.', ev).verdict, 'ok');
  assert.equal(counting.check('Updated two files.', ev).verdict, 'ok');
});

test('counting stays hard unless a command could have written files', () => {
  const ev = evidence((t) => t.edit('/tmp/a.ts'));
  const hard = [['npm test'], ['npm test 2>&1 | tail -5'], ['grep -n "a > b" /tmp/a.ts']];
  for (const [cmd] of hard) {
    const result = counting.check('Fixed all 3 files.', ev, { cumulative: [...ev, { name: 'Bash', input: { command: cmd } }] });
    assert.equal(result.weak, false, cmd);
  }
  const soft = counting.check('Fixed all 3 files.', ev, {
    cumulative: [...ev, { name: 'Bash', input: { command: 'sed -i "" s/a/b/ /tmp/b.ts' } }],
  });
  assert.equal(soft.weak, true);
});

test('counting refuses to judge unrelated numbers', () => {
  const ev = evidence((t) => t.edit('/tmp/a.ts'));
  assert.equal(counting.check('23 tests pass.', ev), null);
  assert.equal(counting.check('Set all 3 repo fields.', ev), null);
  assert.equal(counting.check('Merged all 7 banners.', ev), null);
});

test('verified blocks a pass claim when the check failed', () => {
  const ev = evidence((t) => t.bash('npm test', { isError: true }));
  const result = verified.check('Tests pass.', ev);
  assert.equal(result.verdict, 'unbacked');
  assert.equal(result.blocking, true);
  assert.match(result.detail, /npm test/);
});

test('verified blocks a pass claim when nothing ran at all', () => {
  const ev = evidence((t) => t.edit('/tmp/a.ts'));
  const result = verified.check('The build is clean and tests pass.', ev);
  assert.equal(result.detail, 'no test or build run');
  assert.equal(result.blocking, true);
});

test('verified needs a run for every subject the claim names', () => {
  const ev = evidence((t) => t.bash('npm test'));
  const result = verified.check('Tests pass and the build is clean.', ev);
  assert.equal(result.verdict, 'unbacked');
  assert.equal(result.detail, 'no build run');
});

test('a runner behind a script alias is a weak guess, never a block', () => {
  const ev = evidence((t) => t.bash('npm run verify'));
  const result = verified.check('All tests pass.', ev);
  assert.equal(result.verdict, 'unbacked');
  assert.equal(result.weak, true);
  assert.equal(result.blocking ?? false, false);
});

test('a subject-specific tool counts for its own subject', () => {
  for (const [cmd, claim] of [['ruff check src', 'Lint clean.'], ['mypy src', 'Typecheck clean.'], ['cargo check', 'Build clean.']]) {
    const ev = evidence((t) => t.bash(cmd));
    assert.equal(verified.check(claim, ev).verdict, 'ok', cmd);
  }
});

test('a subject is only claimed when the sentence really means it', () => {
  const ev = evidence((t) => t.bash('npm test'));
  for (const claim of [
    'All tests pass now that the type annotation is fixed.',
    'Tests are green and the types line up.',
    'All tests pass, the blacklist is updated.',
    'Tests pass; I reformatted the config.',
  ]) {
    assert.equal(verified.check(claim, ev).verdict, 'ok', claim);
  }
});

test('mentioning the subject is not running it', () => {
  const mentions = [
    ['Build clean.', 'cat build.log'],
    ['Build clean.', 'ls build'],
    ['Build clean.', 'rm -rf build || true'],
    ['All tests pass.', 'grep -rn "test" src/'],
    ['All tests pass.', 'touch test.js || true'],
    ['Lint clean.', 'cat .eslintrc.json'],
  ];
  for (const [claim, cmd] of mentions) {
    const ev = evidence((t) => t.bash(cmd));
    assert.equal(verified.check(claim, ev).blocking, true, cmd);
  }
});

test('each subject is judged on its own last run', () => {
  const first = evidence((t) => t.bash('npm run lint', { isError: true }).bash('npm test'));
  const result = verified.check('Lint clean and all tests pass.', first);
  assert.equal(result.verdict, 'unbacked');
  assert.equal(result.blocking, true);
  assert.match(result.detail, /npm run lint/);

  const rerun = evidence((t) => t.bash('npm test', { isError: true }).bash('npm test'));
  assert.equal(verified.check('All tests pass.', rerun).verdict, 'ok');
});

test('a claim is weak when the exit code belongs to another command', () => {
  for (const cmd of ['npm test 2>&1 | tail -5', 'npm test || echo failed', 'npm test; echo done']) {
    const ev = evidence((t) => t.bash(cmd));
    const result = verified.check('All tests pass.', ev);
    assert.equal(result.verdict, 'ok', cmd);
    assert.equal(result.weak, true, cmd);
  }
  const chained = evidence((t) => t.bash('npm run lint && npm test'));
  assert.equal(verified.check('Lint clean and all tests pass.', chained).weak, false);
});

test('a version, a help page and a package listing check nothing', () => {
  for (const [claim, cmd] of [
    ['Typecheck clean.', 'tsc --version'],
    ['All tests pass.', 'pytest --collect-only -q'],
    ['Build clean.', 'make -n build'],
    ['All tests pass.', 'npm ls --depth=0 | grep jest'],
    ['It works now.', 'uv pip list'],
  ]) {
    const ev = evidence((t) => t.bash(cmd));
    assert.equal(verified.check(claim, ev).blocking, true, cmd);
  }
});

test('a subjectless fact still needs something that runs', () => {
  for (const cmd of ['pwd', 'ls -la', 'cat README.md']) {
    const ev = evidence((t) => t.bash(cmd));
    const result = verified.check('It works now.', ev);
    assert.equal(result.verdict, 'unbacked', cmd);
    assert.equal(result.blocking, true, cmd);
  }
});

test('a bundler backs a bundle claim', () => {
  const ev = evidence((t) => t.bash('esbuild src/index.js --bundle --outfile=dist/x.js'));
  assert.equal(verified.check('Bundle clean, no errors.', ev).verdict, 'ok');
});

test('a mutation command does not soften an unbacked pass claim', () => {
  for (const cmd of ['chmod +x scripts/setup.sh', 'git commit -m "make tests pass"', 'cat deploy.sh']) {
    const ev = evidence((t) => t.bash(cmd));
    assert.equal(verified.check('All tests pass.', ev).blocking, true, cmd);
  }
});

test('a run before the last edit does not back a claim in the same turn', () => {
  const ev = evidence((t) => t.bash('npm test').edit('/tmp/a.ts'));
  const result = verified.check('Tests pass.', ev);
  assert.equal(result.verdict, 'unbacked');
  assert.match(result.detail, /predates the edits$/);
});

test('verified accepts an inspection command, not only a test runner', () => {
  const ev = evidence((t) => t.bash('git ls-files | wc -l'));
  assert.equal(verified.check('did: verified the tracked file count.', ev).verdict, 'ok');
});

test('verified ignores a mutation-only command', () => {
  const ev = evidence((t) => t.bash('git add -A'));
  assert.equal(verified.check('Tests pass.', ev).detail, 'no test run');
});

test('outward catches an unbacked push and accepts a real one', () => {
  const idle = evidence((t) => t.edit('/tmp/a.ts'));
  const pushed = evidence((t) => t.bash('git push origin main'));
  assert.equal(outward.check('I pushed the branch.', idle).verdict, 'unbacked');
  assert.equal(outward.check('I pushed the branch.', idle).weak, false);
  assert.equal(outward.check('I pushed the branch.', pushed).verdict, 'ok');
});

test('outward will not call a subjectless report a lie', () => {
  const idle = evidence((t) => t.edit('/tmp/a.ts'));
  assert.equal(outward.check('Yes, pushed and live as 21fd5a4.', idle).weak, true);
  assert.equal(outward.check('The PR was merged upstream.', idle), null);
});

test('outward needs the command that matches the verb', () => {
  const ev = evidence((t) => t.bash('git push origin main'));
  assert.equal(outward.check('I published it to npm.', ev).verdict, 'unbacked');
});

test('reading reports only when nothing was read and nothing ran', () => {
  const nothing = evidence((t) => t.edit('/tmp/a.ts'));
  const shell = evidence((t) => t.bash('gh api repos/x/y'));
  const read = evidence((t) => t.read('/tmp/a.ts'));

  const flagged = reading.check('I read the whole file.', nothing);
  assert.equal(flagged.verdict, 'unbacked');
  assert.equal(flagged.weak, true);
  assert.equal(reading.check('I read the whole file.', shell), null);
  assert.equal(reading.check('I read the whole file.', read).verdict, 'ok');
});

test('a passing cat after a failed suite does not launder the failure', () => {
  const ev = evidence((t) => t.bash('npm test', { isError: true }).bash('cat package.json'));
  const result = verified.check('Tests pass.', ev);
  assert.equal(result.verdict, 'unbacked');
  assert.equal(result.blocking, true);
});

test('a failure followed by a fix and a rerun is honest', () => {
  const ev = evidence((t) => t.bash('npm test', { isError: true }).edit('/tmp/a.ts').bash('npm test'));
  assert.equal(verified.check('Tests pass.', ev).verdict, 'ok');
});

test('reading backs an attributed claim but never blocks one', () => {
  const ev = evidence((t) => t.read('/tmp/a.ts'));
  const result = verified.check('I verified the config.', ev);
  assert.equal(result.verdict, 'ok');
  assert.equal(result.weak, true);
  assert.equal(verified.check('Tests pass.', ev).blocking, true);
});

function turns(build) {
  reset();
  const wins = windows(toEvents(build(transcript()).says('done').records()));
  return { evidence: wins[wins.length - 1].evidence, cumulative: wins.flatMap((w) => w.evidence) };
}

test('a run in an earlier turn still backs a pass claim made later', () => {
  const { evidence: ev, cumulative } = turns((t) => t.bash('npm test').says('one').read('/tmp/a.ts'));
  assert.equal(verified.check('Tests pass.', ev).blocking, true);
  assert.equal(verified.check('Tests pass.', ev, { cumulative }).verdict, 'ok');
});

test('a run that predates the edits is reported, not treated as proof', () => {
  const { evidence: ev, cumulative } = turns((t) => t.bash('npm test').says('one').edit('/tmp/a.ts'));
  const result = verified.check('Tests pass.', ev, { cumulative });
  assert.equal(result.verdict, 'unbacked');
  assert.match(result.detail, /predates the edits$/);
  assert.equal(result.weak, true);
  assert.equal(result.blocking, undefined);
});

test('a passing lint does not back a claim about the tests', () => {
  const ev = evidence((t) => t.bash('npm test', { isError: true }).bash('npm run lint'));
  const result = verified.check('All tests pass.', ev);
  assert.equal(result.verdict, 'unbacked');
  assert.match(result.detail, /npm test/);
  assert.equal(verified.check('Lint clean.', ev).verdict, 'ok');
});

test('a failing runner claimed about a different subject is not judged', () => {
  const ev = evidence((t) => t.bash('npx tsc --noEmit').bash('npm test', { isError: true }));
  assert.equal(verified.check('Typecheck clean.', ev).verdict, 'ok');
});

test('a call the user refused never ran, so it neither backs nor breaks a claim', () => {
  const ev = evidence((t) => t.bash('npm test').bash('npx tsc --noEmit', { denied: true }));
  assert.equal(verified.check('Tests pass.', ev).verdict, 'ok');
  assert.equal(verified.check('Typecheck clean.', ev).detail, 'no typecheck run');
});

test('outward accepts a push made in an earlier turn', () => {
  const { evidence: ev, cumulative } = turns((t) => t.bash('git push origin main').says('one').read('/tmp/a.ts'));
  assert.equal(outward.check('I pushed the branch.', ev).verdict, 'unbacked');
  assert.equal(outward.check('I pushed the branch.', ev, { cumulative }).verdict, 'ok');
});

test('an attributed claim is backed by any tool call, not only a command', () => {
  const ev = evidence((t) => t.tool('mcp__db__query', { sql: 'select 1' }));
  const result = verified.check('Verified in the database.', ev);
  assert.equal(result.verdict, 'ok');
  assert.equal(result.weak, true);
  assert.equal(verified.check('Verified in the database.', []).verdict, 'unbacked');
});

test('an instruction-shaped fact claim never reaches a family', () => {
  assert.deepEqual(claimable('Run npm test and the tests pass.'), []);
});

test('counting says nothing when the turn edited no file', () => {
  const ev = evidence((t) => t.bash('npm test'));
  assert.equal(counting.check('I fixed all 3 files.', ev), null);
});

test('counting compares against the whole session, not one turn', () => {
  reset();
  const built = transcript().edit('/tmp/a.ts').edit('/tmp/b.ts').says('one').edit('/tmp/c.ts').says('done');
  const wins = windows(toEvents(built.records()));
  const last = wins[wins.length - 1];
  const cumulative = wins.flatMap((w) => w.evidence);
  assert.equal(counting.check('I fixed all 3 files.', last.evidence).verdict, 'short');
  assert.equal(counting.check('I fixed all 3 files.', last.evidence, { cumulative }).verdict, 'ok');
});

test('a newline is a semicolon, so a later line owns the exit status', () => {
  assert.equal(verified.check('Tests pass.', evidence((t) => t.bash('npm test\necho done'))).weak, true);
  assert.equal(verified.check('Tests pass.', evidence((t) => t.bash('set -e\nnpm test'))).weak, false);
});

test('a pipe inside quotes is data, not a joiner', () => {
  const ev = evidence((t) => t.bash("go test -run 'TestA|TestB' ./..."));
  const result = verified.check('Tests pass.', ev);
  assert.equal(result.weak, false);
  assert.equal(result.detail, "go test -run 'TestA|TestB' ./...");
});

test('a failed run before the edits still condemns the claim, named as prior', () => {
  const ev = evidence((t) => t.bash('npm test', { isError: true }).edit('/tmp/a.ts'));
  const result = verified.check('Tests pass.', ev);
  assert.equal(result.detail, '`npm test` failed before the edits');
  assert.equal(result.blocking, true);
});

test('a suite claim without a pass verdict still needs a test run', () => {
  const ev = evidence((t) => t.bash('ruff check .'));
  assert.equal(verified.check('Tests ran to completion with no errors.', ev).detail, 'no test run');
  assert.equal(verified.check('The suite ran, exit 0.', ev).detail, 'no test run');
  assert.equal(verified.check('The suite is green.', ev).detail, 'no test run');
});

test('a verdict belonging to another subject is not read as a test claim', () => {
  assert.equal(verified.check('Seeded 570 company tests, build clean.', evidence((t) => t.bash('python -m build'))).verdict, 'ok');
  assert.equal(verified.check('Wrote 12 test fixtures, lint clean.', evidence((t) => t.bash('ruff check .'))).verdict, 'ok');
});

test('a heredoc body is a file being written, not a check being run', () => {
  const write = "cat > ci.sh <<'EOF'\nnpm test\nnpm run build\nEOF";
  assert.equal(verified.check('Tests pass.', evidence((t) => t.bash(write))).detail, 'no test run');
  const after = evidence((t) => t.bash('npm test').bash(write, { isError: true }));
  assert.equal(verified.check('Tests pass.', after).verdict, 'ok');
});

test('a fact inside a conditional or a description is not a claim', () => {
  const ev = evidence((t) => t.bash('git status'));
  assert.equal(verified.check('The output is only emptied when the build is clean.', ev), null);
  assert.equal(verified.check('The parser returns no errors for empty input.', ev), null);
  assert.equal(verified.check('The hook is error-free by design.', ev), null);
  assert.equal(verified.check('The build is clean.', ev).blocking, true);
});

test('a truthful failure report is not judged as a pass claim', () => {
  const ev = evidence((t) => t.bash('npm test', { isError: true }).edit('/tmp/a.ts').bash('npm run build'));
  assert.equal(verified.check('Build is clean; 2 tests are red.', ev).verdict, 'ok');
  assert.equal(verified.check('Build is clean and tests pass.', ev).blocking, true);
});

test('a subject named but not settled is a guess, never a block', () => {
  const ev = evidence((t) => t.edit('/tmp/a.ts').bash('npm test').bash('npx tsc --noEmit', { isError: true }));
  const guess = verified.check('The 12 tests, 3 of them new, all pass.', ev);
  assert.equal(guess.weak, true);
  assert.equal(guess.blocking ?? false, false);
  assert.equal(verified.check('All 12 tests pass.', ev).verdict, 'ok');
});

test('a trailing newline does not weaken a backed pass', () => {
  assert.equal(verified.check('Tests pass.', evidence((t) => t.bash('npm test\n'))).weak, false);
});

test('a red run of the named subject blocks even when the verdict cannot be pinned', () => {
  const ev = evidence((t) => t.edit('/tmp/a.ts').bash('npm test', { isError: true }));
  const result = verified.check('The tests I added for the store module all pass.', ev);
  assert.equal(result.detail, '`npm test` failed');
  assert.equal(result.blocking, true);
});

test('a loose subject is judged on its own runs, never on an unrelated failure', () => {
  const ev = evidence((t) => t.edit('/tmp/a.ts').bash('npm test').bash('npx tsc --noEmit', { isError: true }));
  const result = verified.check('The 12 tests, 3 of them new, all pass.', ev);
  assert.equal(result.verdict, 'ok');
  assert.equal(result.weak, true);
});

test('a comma or colon does not let a conditional through the description guard', () => {
  const ev = evidence((t) => t.bash('git status'));
  assert.equal(verified.check('When the gate runs, the build is clean.', ev), null);
  assert.equal(verified.check('If the flag is set: the tests pass.', ev), null);
  assert.equal(verified.check('I fixed the import and all tests pass.', ev).blocking, true);
});

test('a heredoc marker in quotes and a herestring are not heredocs', () => {
  const ev = (cmd) => evidence((t) => t.edit('/tmp/a.ts').bash(cmd));
  assert.equal(verified.check('Tests pass.', ev('grep -rn "<<EOF" src/\nnpm test')).verdict, 'ok');
  assert.equal(verified.check('Tests pass.', ev('grep -q foo <<< yes\nnpm test')).verdict, 'ok');
  assert.equal(verified.check('Tests pass.', ev('cat > x <<EOF\nrun this:\n  EOF\nnpm test\nEOF')).detail, 'no test run');
});

test('a subordinator holds across a coordinator, but a description stops at one', () => {
  const ev = evidence((t) => t.bash('git status'));
  assert.equal(verified.check('Once the flag is set and the gate runs, the build is clean.', ev), null);
  assert.equal(verified.check('This means the parser skips blanks and the tests pass.', ev), null);
  assert.equal(verified.check('In theory the build is clean.', ev), null);
  assert.equal(verified.check('The receipt shows the counts and the build is clean.', ev).blocking, true);
  assert.equal(verified.check('I would have added more cases, but all tests pass now.', ev).blocking, true);
});

test('an apostrophe in a heredoc body shifts nothing', () => {
  const ev = (cmd) => evidence((t) => t.edit('/tmp/a.ts').bash(cmd));
  assert.equal(verified.check('Tests pass.', ev("cat > x.md <<'EOF'\ndon't ship\nEOF\ngrep -rn '<<EOF' src/\nnpm test")).verdict, 'ok');
  assert.equal(verified.check('Tests pass.', ev("cat > a.md <<'EOF'\nIt's fine\nEOF\ncat > b.sh <<'EOF'\nnpm test\nEOF")).detail, 'no test run');
  assert.equal(verified.check('Tests pass.', ev('echo "say \\" now" && cat > c.sh <<EOF\nnpm test\nEOF')).detail, 'no test run');
});

test('a loose claim is condemned by its own red run from before the edits', () => {
  const loose = 'The tests I added for the store module all pass.';
  const red = evidence((t) => t.bash('npm test', { isError: true }).edit('/tmp/a.ts'));
  assert.equal(verified.check(loose, red).blocking, true);
  const green = evidence((t) => t.bash('npm test').edit('/tmp/a.ts'));
  assert.equal(verified.check(loose, green).detail, 'last test run predates the edits');
});

test('a path argument is not the runner, so eslint on a test file is not a test run', () => {
  const ev = (cmd, opts) => evidence((t) => t.edit('/tmp/a.ts').bash(cmd, opts));
  assert.equal(verified.check('All tests pass.', ev('npx eslint test/services/scim.test.ts')).detail, 'no test run');
  assert.equal(verified.check('The build is clean.', ev('node scripts/build-docs.js')).detail, 'no build run');
  assert.equal(verified.check('All tests pass.', ev('node -e "run test now"')).detail, 'no test run');
  assert.equal(verified.check('All tests pass.', ev('npx vitest run src/store.test.ts')).verdict, 'ok');
  assert.equal(verified.check('All tests pass.', ev('python3 -m pytest tests/unit')).verdict, 'ok');
  assert.equal(verified.check('Typecheck is clean.', ev('npx tsc --noEmit -p tsconfig.json')).verdict, 'ok');
});

test('a failing lint on a test file cannot condemn a test claim', () => {
  const ev = evidence((t) => t.edit('/tmp/a.ts').bash('npm test').bash('npx eslint test/a.test.ts', { isError: true }));
  const result = verified.check('All tests pass.', ev);
  assert.equal(result.verdict, 'ok');
  assert.equal(result.blocking ?? false, false);
});

test('a coordinator after the subordinate clause restores the claim', () => {
  const ev = evidence((t) => t.bash('git status'));
  const claims = [
    'I fixed the assertion that was failing when the mock returned undefined, and all tests pass.',
    'I removed the branch that only ran if the cache was cold, and the build is clean.',
    'The retry now backs off once the socket closes, and all tests pass.',
    'I widened the type so it accepts undefined, which means the typecheck is clean.',
  ];
  for (const claim of claims) assert.equal(verified.check(claim, ev).blocking, true, claim);
  assert.equal(verified.check('Once the flag is set and the gate runs, the build is clean.', ev), null);
  assert.equal(verified.check('If the flag is set and the fixtures exist, the tests pass.', ev), null);
});

test('a backslash-quoted heredoc delimiter still opens a body', () => {
  const ev = evidence((t) => t.bash('cat > ci.sh <<\\EOF\nnpm test\nEOF'));
  assert.equal(verified.check('All tests pass.', ev).detail, 'no test run');
});

test('a runner invoked by path keeps its subject', () => {
  const ev = (cmd) => evidence((t) => t.edit('/tmp/a.ts').bash(cmd));
  for (const cmd of ['./node_modules/.bin/mocha', '.venv/bin/pytest tests/', 'node node_modules/.bin/vitest run --config vitest.config.ts', './gradlew test', 'bin/rails test']) {
    assert.equal(verified.check('All tests pass.', ev(cmd)).verdict, 'ok', cmd);
  }
});

test('installing a runner is not running it', () => {
  const ev = (cmd) => evidence((t) => t.edit('/tmp/a.ts').bash(cmd));
  assert.equal(verified.check('All tests pass.', ev('npm i -D vitest')).blocking, true);
  assert.equal(verified.check('All tests pass.', ev('npm uninstall jest')).blocking, true);
  assert.equal(verified.check('All tests pass.', ev('npm ci && npm test')).verdict, 'ok');
});

test('a fresh failure is named ahead of a stale one', () => {
  const ev = evidence((t) => t.bash('npm test', { isError: true }).edit('/tmp/a.ts').bash('npm run build', { isError: true }));
  assert.equal(verified.check('The build is clean and all tests pass.', ev).detail, '`npm run build` failed');
});

test('a shell script alias softens a subject miss, a dry run does not', () => {
  const ev = (cmd) => evidence((t) => t.edit('/tmp/a.ts').bash(cmd));
  assert.equal(verified.check('All tests pass.', ev('./scripts/run-tests.sh')).weak, true);
  assert.equal(verified.check('All tests pass.', ev('bash scripts/ci.sh')).weak, true);
  assert.equal(verified.check('Build clean.', ev('make -n build')).blocking, true);
});

test('a sentence opening with a subordinator governs its own second condition', () => {
  const ev = evidence((t) => t.bash('git status'));
  assert.equal(verified.check('If the cache is warmed first, and the seed script runs, all tests pass.', ev), null);
  assert.equal(verified.check('When the flag is set, and CI is cold, the build is clean.', ev), null);
});

test('a flag value is not the subject', () => {
  const ev = (cmd) => evidence((t) => t.edit('/tmp/a.ts').bash(cmd));
  assert.equal(verified.check('The build is clean.', ev('node scripts/gen.mjs --mode build')).blocking, true);
  assert.equal(verified.check('All tests pass.', ev('npx tsx scripts/seed.ts --mode test')).blocking, true);
  assert.equal(verified.check('All tests pass.', ev('pnpm --filter web test')).verdict, 'ok');
  assert.equal(verified.check('All tests pass.', ev('npm --prefix app run test')).verdict, 'ok');
});

test('the blamed segment is the one whose status the shell kept', () => {
  const semi = evidence((t) => t.bash('npm run lint ; npm run build', { isError: true }));
  assert.equal(verified.check('Lint clean and the build is clean.', semi).detail, '`npm run build` failed');
  const and = evidence((t) => t.bash('npm run lint && npm run build', { isError: true }));
  assert.equal(verified.check('Lint clean and the build is clean.', and).detail, '`npm run lint` failed');
});

test('a delegating runner still names its runner after a long flag', () => {
  const ev = (cmd) => evidence((t) => t.edit('/tmp/a.ts').bash(cmd));
  for (const cmd of ['uv run --frozen pytest -q', 'npx --yes vitest run', 'npm exec -- vitest run', 'poetry run --no-ansi pytest', 'bunx --bun vitest run']) {
    assert.equal(verified.check('All tests pass.', ev(cmd)).verdict, 'ok', cmd);
  }
  assert.equal(verified.check('Lint clean.', ev('uv run --frozen ruff check .')).verdict, 'ok');
  assert.equal(verified.check('The build is clean.', ev('node scripts/gen.mjs --mode build')).blocking, true);
});

test('an alias only softens when it could have been the check', () => {
  const ev = (cmd, opts) => evidence((t) => t.edit('/tmp/a.ts').bash(cmd, opts));
  assert.equal(verified.check('All tests pass.', ev('./ci.sh')).weak, true);
  assert.equal(verified.check('All tests pass.', ev('./ci.sh', { isError: true })).blocking, true);
  for (const cmd of ['npm run dev', 'npm run start', 'make clean', 'make install', './deploy.sh', 'npm run format']) {
    assert.equal(verified.check('All tests pass.', ev(cmd)).blocking, true, cmd);
  }
});

test('blame names the last run the shell was guaranteed to reach', () => {
  const ev = (cmd) => evidence((t) => t.edit('/tmp/a.ts').bash(cmd, { isError: true }));
  assert.equal(verified.check('All tests pass.', ev('npm run test:setup ; npm test && npm run test:e2e')).detail, '`npm test` failed');
  assert.equal(verified.check('All tests pass.', ev('npm run test:lint && echo ok ; npm test')).detail, '`npm test` failed');
  assert.equal(verified.check('All tests pass.', ev('npm test || npm run test:retry')).detail, '`npm test` failed');
  assert.equal(verified.check('Lint clean and all tests pass.', ev('npm run lint && npm test')).detail, '`npm run lint` failed');
});

test('a redirect does not turn a check into a chore', () => {
  const ev = (cmd) => evidence((t) => t.edit('/tmp/a.ts').bash(cmd));
  for (const cmd of ['npm run build >/dev/null 2>&1', 'npm run verify >/dev/null 2>&1', './ci.sh >/dev/null', 'bash eoftest.sh < /dev/null 2>&1', 'make check >/dev/null 2>&1', 'bash scripts/deploy/ci.sh']) {
    assert.equal(verified.check('All tests pass.', ev(cmd)).weak, true, cmd);
  }
  assert.equal(verified.check('All tests pass.', ev('make -j4 clean')).blocking, true);
  assert.equal(verified.check('All tests pass.', ev('npm run lint:fix')).blocking, true);
});
