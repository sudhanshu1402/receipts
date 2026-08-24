# What it checks, in full

Four families. Each one only judges claims it can actually settle. The short version is the table in the [README](../README.md#what-it-catches); this is the whole rule set, because the rules are the product.

## Counting

"Fixed all 9 files" against the number of distinct files edited in the session so far, because "all 3 files" usually summarises more than the last turn. Only file-shaped nouns, so "23 tests pass" is not counted against file edits. The number and the verb must sit in the same clause, so "merged all 7 banners; set all 3 repo fields" claims neither 7 nor 3 file edits. If a shell command that can write ran (`sed`, `jq`, a script, a redirect), the count is marked weak, because a `sed -i` edits files this tool cannot see.

## Verified but failed

"Tests pass", "build clean", "exit 0", "I verified it". This is the only family that can block, and only on a flat statement of fact: either the subject was never run, or the matching run failed.

A command only counts when the executable at the start of a segment is a runner, so `cat build.log` and `rm -rf build || true` mention the build without running it. The judged command has to match the subject of the claim, so a passing lint cannot back a claim about the tests and a failing test run cannot condemn a claim about the typecheck. That match is against the runner and its flags, never against a path argument, so `npx eslint test/services/scim.test.ts` is a lint run rather than a test run and `node scripts/build-docs.js` is neither. A runner invoked by path keeps its own name, so `./node_modules/.bin/mocha`, `.venv/bin/pytest` and `./gradlew test` still count.

A sentence that names two subjects needs a run for each, so "tests pass and the build is clean" is not settled by `npm test` alone. Within each subject the last run wins, because failing, fixing and rerunning in one turn is honest work, and a failure under any one subject sinks the sentence.

A run only proves a pass if its own exit status reached the shell, so `npm test 2>&1 | tail -5` reports the exit code of `tail` and the claim is marked weak instead of proved. The named command is the last run the shell was guaranteed to reach, so `npm test || npm run retry` blames `npm test` and never the retry that only runs on failure. A newline counts as a `;` for that rule, because Bash reports the last line's status, while a `|` inside quotes is data, so `go test -run 'TestA|TestB'` stays one command. A heredoc body is a file being written, so `cat > ci.sh <<'EOF'` with `npm test` inside it is not a test run, while `grep "<<EOF" src/` and `foo <<< bar` open no heredoc at all. A runner asked for `--version`, `--help`, a dry run or a package listing has checked nothing, and neither has an install, so `npm i -D vitest` is not a test run.

Runs from earlier turns count, because a recap of a gate two turns ago is honest, but only if no file was edited after them; otherwise the claim is reported as stale rather than proved, unless that earlier run failed, in which case the failure still stands. A red run kept from before the edits is reported as failing *before the edits*, since blaming a fresh failure would misdescribe it.

A subject noun is read as data unless a positive verdict sits near it with no other subject and no other counted item in between, so "seeded 570 company tests, build clean" is a claim about the build, and "build is clean, 2 tests are red" is judged on the build alone rather than accused of lying about the tests. When a sentence names a subject but the verdict cannot be pinned to it, only that subject's own runs are judged: a green run leaves the claim weak rather than proved, a red one still blocks, and an unrelated failure elsewhere in the turn is never blamed for it.

A fact inside a conditional or a description of behaviour is not a claim at all, so "the output is emptied only when the build is clean", "the parser returns no errors for empty input" and "error-free by design" are left alone; a coordinator ends the description, so "I made the mock async and all tests pass" is still a claim, and a subordinate clause that closes before a `, and` or a `, which means` hands the sentence back, so "I fixed the assertion that was failing when the mock returned undefined, and all tests pass" is judged while "once the flag is set and the gate runs, the build is clean" is not.

Commands the user refused are not evidence either way, and a refusal is read from the result body only when the call is also marked as an error, so a test whose *output* quotes the refusal wording is still a real run.

## Outward actions

"I pushed", "I published", "I deployed" against the command that would have done it, anywhere in the session. A `git push` claim needs a `git push`. These verbs also need a git-shaped object, so "I merged the two helpers" is read as a refactor, not a merge.

## Reading and reviewing

"I read the whole file" with no read of any kind since the agent last spoke. Always reported as weak, never blocking, for the reason in [CEILINGS.md](CEILINGS.md).

## What is stripped before any of this runs

Claims inside code fences, inline code, block quotes and quoted clauses of three words or more, because those are not the agent speaking. Scare quotes round a word or two are kept. Instructions to you ("run `npm test` to make sure the tests pass") are dropped too, since telling you to check something is not claiming it was checked. Sentences about the future ("I'll run the suite") and negated sentences ("tests didn't pass") are dropped at sentence level, so a hedge in one sentence cannot silence a claim in the next.
