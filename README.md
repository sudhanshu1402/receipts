# receipts

**Your AI says it fixed all nine files. This tells you it touched three.**

[![CI](https://github.com/sudhanshu1402/receipts/actions/workflows/ci.yml/badge.svg)](https://github.com/sudhanshu1402/receipts/actions/workflows/ci.yml)
[![node](https://img.shields.io/badge/node-%E2%89%A520-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

An agent's summary of its own work is written by the same thing that did the work. `receipts` checks it against the session transcript on disk: every claim the agent made, every tool call it actually ran, and the places where those two disagree.

It reads the transcript file, never the conversation. Nothing it does enters the model's context, so it costs zero tokens and cannot be talked out of a finding.

## What it looks like

```
SESSION RECEIPT  14:39-15:02  23m  3 file(s)  41 tool calls

CLAIMED                                   EVIDENCE                VERDICT
"Fixed all 9 files."                      claimed 9, edited 3     short
"Tests pass."                             `npm test` failed       unbacked
"I pushed the branch."                    no git push             unbacked

3 unbacked or short
```

Clean session, one line:

```
SESSION RECEIPT  09:12-09:40  28m  6 file(s)  57 tool calls
14 claim(s) checked, all backed.
```

## Install

As a Claude Code plugin, which wires the end-of-session receipt and `/receipt`:

```bash
claude plugin marketplace add sudhanshu1402/receipts
claude plugin install receipts@receipts
```

The `@receipts` suffix is the marketplace, and it is not optional: the official marketplace ships a different plugin under the same name, so a bare `claude plugin install receipts` installs that one instead. `claude plugin list` should show `receipts@receipts`.

Or as a plain CLI, for any transcript on disk:

```bash
npm install -g @sudhanshu1402/receipts
receipts show                    # newest session for this folder
receipts show <session-id>       # a specific one
receipts digest 7                # trend across the last 7 days
```

## The four surfaces

| Surface | When | Cost |
|---|---|---|
| Turn receipt | the `Stop` hook, each time the agent finishes a turn, quiet when that turn made no claim | zero tokens, stdout goes to your terminal |
| `/receipt` | when you ask, mid-session | one short command output |
| Statusline counter | live, `receipts 2!` when something is off | zero tokens |
| `receipts digest` | across days, from stored receipts | zero tokens |

`Stop` fires at the end of every turn, not once per session, so the hook receipt covers only the claims made since the last one. It keeps a per-session cursor under `state/`, holding the timestamp of the last turn it judged, which is also what keeps the digest from counting the same claim twice. Only the leading run of already-judged turns is skipped, and a timestamp in the future never becomes the cursor, so one odd stamp cannot silence the rest of the session. `receipts show` ignores the cursor and reads the whole session.

The statusline is the one surface you wire yourself, because Claude Code allows a single `statusLine` command in `settings.json`. Either point it straight at receipts:

```json
{ "statusLine": { "type": "command", "command": "receipts statusline" } }
```

or, if that slot is taken, call `receipts statusline` from the script already there and append its output.

One case costs tokens on purpose. If the agent claims a check passed and the transcript shows that check failing, the hook exits 2 and sends a single line back to the model:

```
receipts: you said "Tests pass." but `npm test` failed. Prove it or retract it.
```

That fires at most once per session. A `Stop` hook that keeps exiting 2 would loop forever, so the block is guarded twice: by the `stop_hook_active` flag in the hook payload and by a per-session marker file on disk.

## What it checks

Four families. Each one only judges claims it can actually settle.

**Counting.** "Fixed all 9 files" against the number of distinct files edited in the session so far, because "all 3 files" usually summarises more than the last turn. Only file-shaped nouns, so "23 tests pass" is not counted against file edits. The number and the verb must sit in the same clause, so "merged all 7 banners; set all 3 repo fields" claims neither 7 nor 3 file edits. If a shell command that can write ran (`sed`, `jq`, a script, a redirect), the count is marked weak, because a `sed -i` edits files this tool cannot see.

**Verified but failed.** "Tests pass", "build clean", "exit 0", "I verified it". A command only counts when the executable at the start of a segment is a runner, so `cat build.log` and `rm -rf build || true` mention the build without running it. The judged command has to match the subject of the claim, so a passing lint cannot back a claim about the tests and a failing test run cannot condemn a claim about the typecheck. That match is against the runner and its flags, never against a path argument, so `npx eslint test/services/scim.test.ts` is a lint run rather than a test run and `node scripts/build-docs.js` is neither. A runner invoked by path keeps its own name, so `./node_modules/.bin/mocha`, `.venv/bin/pytest` and `./gradlew test` still count. A sentence that names two subjects needs a run for each, so "tests pass and the build is clean" is not settled by `npm test` alone. Within each subject the last run wins, because failing, fixing and rerunning in one turn is honest work, and a failure under any one subject sinks the sentence. A run only proves a pass if its own exit status reached the shell, so `npm test 2>&1 | tail -5` reports the exit code of `tail` and the claim is marked weak instead of proved. The named command is the last run the shell was guaranteed to reach, so `npm test || npm run retry` blames `npm test` and never the retry that only runs on failure. A newline counts as a `;` for that rule, because Bash reports the last line's status, while a `|` inside quotes is data, so `go test -run 'TestA|TestB'` stays one command. A heredoc body is a file being written, so `cat > ci.sh <<'EOF'` with `npm test` inside it is not a test run, while `grep "<<EOF" src/` and `foo <<< bar` open no heredoc at all. A runner asked for `--version`, `--help`, a dry run or a package listing has checked nothing, and neither has an install, so `npm i -D vitest` is not a test run. Runs from earlier turns count, because a recap of a gate two turns ago is honest, but only if no file was edited after them; otherwise the claim is reported as stale rather than proved, unless that earlier run failed, in which case the failure still stands. A subject noun is read as data unless a positive verdict sits near it with no other subject and no other counted item in between, so "seeded 570 company tests, build clean" is a claim about the build, and "build is clean, 2 tests are red" is judged on the build alone rather than accused of lying about the tests. When a sentence names a subject but the verdict cannot be pinned to it, only that subject's own runs are judged: a green run leaves the claim weak rather than proved, a red one still blocks, and an unrelated failure elsewhere in the turn is never blamed for it. A fact inside a conditional or a description of behaviour is not a claim at all, so "the output is emptied only when the build is clean", "the parser returns no errors for empty input" and "error-free by design" are left alone; a coordinator ends the description, so "I made the mock async and all tests pass" is still a claim, and a subordinate clause that closes before a `, and` or a `, which means` hands the sentence back, so "I fixed the assertion that was failing when the mock returned undefined, and all tests pass" is judged while "once the flag is set and the gate runs, the build is clean" is not. A red run kept from before the edits is reported as failing *before the edits*, since blaming a fresh failure would misdescribe it. Commands the user refused are not evidence either way, and a refusal is read from the result body only when the call is also marked as an error, so a test whose *output* quotes the refusal wording is still a real run. This is the only family that can block, and only on a flat statement of fact: either the subject was never run, or the matching run failed.

**Outward actions.** "I pushed", "I published", "I deployed" against the command that would have done it, anywhere in the session. A `git push` claim needs a `git push`. These verbs also need a git-shaped object, so "I merged the two helpers" is read as a refactor, not a merge.

**Reading and reviewing.** "I read the whole file" with no read of any kind since the agent last spoke. Always reported as weak, never blocking, for the reason in the next section.

## What it refuses to judge

Being wrong here is worse than being quiet, so each family has a stated ceiling.

- **Reading depth.** A `Read` with a line limit is indistinguishable from a full one, and a `Grep` looks like reading too. The family can tell "some reading happened" from "none happened" and nothing else. It never blocks.
- **Delegated work.** When the window contains an `Agent` call, the real evidence lives in a subagent transcript this tool does not read. Those claims are printed with `via subagent` and never counted as a lie.
- **Subjectless reports.** "Pushed and live as `21fd5a4`" may be reporting *your* push. Without a first-person subject, an outward claim is marked weak instead of unbacked.
- **Script aliases.** `npm run verify`, `make check` and `./scripts/ci.sh` may be the test run, the lint, or nothing. When the claim names a subject no visible command matches and an alias like that ran in the same turn, the claim is reported weak instead of unbacked. The alias has to be plausible: one that failed, or one whose own name is a chore (`npm run dev`, `make clean`, `./deploy.sh`), hides nothing and the claim stays unbacked. A flag value is not read as a subject either, so `node scripts/gen.mjs --mode build` is not a build, while `uv run --frozen pytest` is still a test run.
- **Prose that reads like a report.** "The runner skips the suite unless `RECEIPTS_FULL` is set, and all tests pass" has the same grammar as a real bugfix report, so it is judged as a claim. Position cannot separate the two, and the discriminators that can also move honest sentences. Measured: zero occurrences across 25,480 real assistant sentences. Same class of ceiling for a subject word used as a bare flag (`go run ./cmd/x --test`).
- **Quality.** Whether the fix is any good is not a receipt. This tool counts and compares; it does not review.
- **Anything the agent never said.** Silent work is not checked. The receipt is about the gap between claim and evidence, not about coverage.

Claims inside code fences, inline code, block quotes and quoted clauses of three words or more are stripped before checking, because those are not the agent speaking. Scare quotes round a word or two are kept. Instructions to you ("run `npm test` to make sure the tests pass") are dropped too, since telling you to check something is not claiming it was checked. Sentences about the future ("I'll run the suite") and negated sentences ("tests didn't pass") are dropped at sentence level, so a hedge in one sentence cannot silence a claim in the next.

## Why it costs nothing

Claude Code writes each session to `~/.claude/projects/<slug>/<session-id>.jsonl` as it happens, and a `Stop` hook reads that file instead of the conversation.

Measured, not assumed: across 150 stored transcripts, an existing `Stop` hook's stdout appears only in `attachment` records of type `hook_success`, never in a `user` or `assistant` content block. The message array sent to the model is built from those content blocks, so hook stdout with exit 0 lands in your terminal and in the transcript, not in the context window.

The one deliberate exception is the `exit 2` block above, which writes a single line to stderr specifically so the model reads it.

Reading the transcript instead of the conversation also means the check cannot be argued with. The evidence is the same file whether the agent's summary was honest or not.

## How it works

An evidence window is every tool call since the model last spoke. A claim in a `text` block is checked against the calls that preceded it. Bounding on the agent's own turns avoids having to tell a real user message apart from an injected one, which is guesswork.

Each transcript record holds exactly one content block, so a `tool_use` and its `tool_result` are separate records, paired by id. A rewind branches the file, so the live thread is found by walking `parentUuid` back from the newest leaf rather than trusting file order. A compaction writes a record with `parentUuid: null` and the previous thread hanging off `logicalParentUuid`; crossing that keeps the whole session in one receipt.

```
transcript.js   read, chain, normalize        window.js    evidence windows
sanitize.js     strip what is not speech      claim.js     agent's claim or a report?
families/       four checks, one file each    analyze.js   claims x evidence
render.js       receipt, statusline, digest   store.js     daily files, loop marker
```

Receipts are stored as markdown under `~/.claude/receipts/` (override with `RECEIPTS_HOME`), one file per day. Receipt files and the per-session state under `state/` are both pruned after 30 days. Each entry carries a machine-readable trailer so the digest never has to re-parse a transcript that may already be gone.

## Runnable check

No session needed:

```bash
npm test
node bin/receipts.js show ~/.claude/projects/<slug>/<session-id>.jsonl
```

The suite covers the transcript parser against real record shapes, every sanitizer stage with a negative probe, the agentive-versus-observational gate in both directions, each family's lie and its honest twin, and the hook end to end as a subprocess: exit 2 once, exit 0 on the retry, exit 0 on a missing transcript.

## License

MIT
