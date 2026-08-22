# Changelog

## 0.2.0

Delegated work is now judged instead of excused. A subagent's tool calls are read from `<session-id>/subagents/agent-<id>.jsonl` and merged, in timestamp order, into the window that launched them, so a command the subagent ran counts as a run and a file it edited counts as an edit. A subagent that delegated onward is followed to the deeper file.

The merge is clipped at the claim's own timestamp. A background agent keeps working after the sentence is written, and 1,420 of the subagent calls on one machine postdate the claim in whose window they sit; using them would have let a later unrelated failure contradict a claim that was true when made. A window whose delegate has no readable file, or had done nothing yet when the claim was made, is still marked `via subagent` and never counted as a lie.

The plugin is renamed to `claimcheck`. The official marketplace ships an unrelated plugin called `receipts`, so `claude plugin install receipts` was installing the wrong thing. The repo, the npm package and the `/receipt` command are unchanged.

Measured: 140 tests pass; across the 18 transcripts on one machine that delegate, 84 windows gained subagent evidence and 40 stayed shielded, 118 of 126 `agentId`s had a file on disk, and no transcript produced a blocking finding.

## 0.1.1

Documented that the plugin install has to name its marketplace. No code change.

## 0.1.0

First release. Four claim families (counting, verified-but-failed, outward actions, reading), four surfaces (`Stop` hook receipt, `/receipt`, statusline counter, `receipts digest`), and a single `exit 2` block, at most once per session, when a claimed check is contradicted by the transcript.
