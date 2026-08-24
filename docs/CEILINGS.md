# What it refuses to judge

Being wrong here is worse than being quiet, so each family has a stated ceiling.

**Reading depth.** A `Read` with a line limit is indistinguishable from a full one, and a `Grep` looks like reading too. The family can tell "some reading happened" from "none happened" and nothing else. It never blocks.

**What a subagent said.** When the window contains an `Agent` call, the subagent's own tool calls *are* read — Claude Code writes each one to `<session-id>/subagents/agent-<id>.jsonl`, and the `Agent` result in the main transcript carries the `agentId` that names the file. A command the subagent ran is a real run and a file it edited is a real edit, so a synchronous subagent no longer launders a claim.

Three things still are not judged. What the subagent *said* to the orchestrator, which is a different question. Work the subagent did *after* the sentence was written, because a background agent that runs on for another four minutes cannot be evidence for a claim made before it started. And a `SendMessage` to a resumed agent, whose result carries no `agentId` at all.

The file is also not always there: measured across every transcript on one machine, 118 of 126 `agentId`s had one, the misses all being older sessions. Whenever a delegated call in a window has no readable file, or had done no work yet when the claim was made, the whole window is marked `via subagent` and never counted as a lie, because partial evidence is worse than none.

**Subjectless reports.** "Pushed and live as `21fd5a4`" may be reporting *your* push. Without a first-person subject, an outward claim is marked weak instead of unbacked.

**Script aliases.** `npm run verify`, `make check` and `./scripts/ci.sh` may be the test run, the lint, or nothing. When the claim names a subject no visible command matches and an alias like that ran in the same turn, the claim is reported weak instead of unbacked. The alias has to be plausible: one that failed, or one whose own name is a chore (`npm run dev`, `make clean`, `./deploy.sh`), hides nothing and the claim stays unbacked. A flag value is not read as a subject either, so `node scripts/gen.mjs --mode build` is not a build, while `uv run --frozen pytest` is still a test run.

**Prose that reads like a report.** "The runner skips the suite unless `RECEIPTS_FULL` is set, and all tests pass" has the same grammar as a real bugfix report, so it is judged as a claim. Position cannot separate the two, and the discriminators that can also move honest sentences. Measured: zero occurrences across 25,480 real assistant sentences. Same class of ceiling for a subject word used as a bare flag (`go run ./cmd/x --test`).

**Quality.** Whether the fix is any good is not a receipt. This tool counts and compares; it does not review.

**Anything the agent never said.** Silent work is not checked. The receipt is about the gap between claim and evidence, not about coverage.
