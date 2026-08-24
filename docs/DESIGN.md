# How it works

## Evidence windows

An evidence window is every tool call since the model last spoke. A claim in a `text` block is checked against the calls that preceded it. Bounding on the agent's own turns avoids having to tell a real user message apart from an injected one, which is guesswork.

A subagent gets its own file next to the session, `<session-id>/subagents/agent-<id>.jsonl`, whose records are all `isSidechain: true`. Those tool calls are merged into the window that launched them, ordered by timestamp and clipped at the claim's own timestamp, so "I fixed all 5 files" is checked against the main thread's edits *and* the subagent's, but never against work that happened after the sentence. If the subagent delegated onward, that deeper file is followed too. A sidechain record sitting in a main transcript is still dropped — that is not the agent speaking to you.

Each transcript record holds exactly one content block, so a `tool_use` and its `tool_result` are separate records, paired by id. A rewind branches the file, so the live thread is found by walking `parentUuid` back from the newest leaf rather than trusting file order. A compaction writes a record with `parentUuid: null` and the previous thread hanging off `logicalParentUuid`; crossing that keeps the whole session in one receipt.

```
transcript.js   read, chain, normalize        window.js    evidence windows
sanitize.js     strip what is not speech      claim.js     agent's claim or a report?
families/       four checks, one file each    analyze.js   claims x evidence
render.js       receipt, statusline, digest   store.js     daily files, loop marker
```

## The turn cursor

`Stop` fires at the end of every turn, not once per session, so the hook receipt covers only the claims made since the last one. It keeps a per-session cursor under `state/`, holding the timestamp of the last turn it judged, which is also what keeps the digest from counting the same claim twice. Only the leading run of already-judged turns is skipped, and a timestamp in the future never becomes the cursor, so one odd stamp cannot silence the rest of the session. `receipts show` ignores the cursor and reads the whole session.

## The statusline

This is the one surface you wire yourself, because Claude Code allows a single `statusLine` command in `settings.json`. Either point it straight at receipts:

```json
{ "statusLine": { "type": "command", "command": "receipts statusline" } }
```

or, if that slot is taken, call `receipts statusline` from the script already there and append its output.

## The one line that costs tokens

If the agent claims a check passed and the transcript shows that check failing, the hook exits 2 and sends a single line back to the model. That fires at most once per session. A `Stop` hook that keeps exiting 2 would loop forever, so the block is guarded twice: by the `stop_hook_active` flag in the hook payload and by a per-session marker file on disk.

## Why the rest costs nothing

Claude Code writes each session to `~/.claude/projects/<slug>/<session-id>.jsonl` as it happens, and a `Stop` hook reads that file instead of the conversation.

Measured, not assumed: across 150 stored transcripts, an existing `Stop` hook's stdout appears only in `attachment` records of type `hook_success`, never in a `user` or `assistant` content block. The message array sent to the model is built from those content blocks, so hook stdout with exit 0 lands in your terminal and in the transcript, not in the context window.

Reading the transcript instead of the conversation also means the check cannot be argued with. The evidence is the same file whether the agent's summary was honest or not.

## Storage

Receipts are stored as markdown under `~/.claude/receipts/` (override with `RECEIPTS_HOME`), one file per day. Receipt files and the per-session state under `state/` are both pruned after 30 days. Each entry carries a machine-readable trailer so the digest never has to re-parse a transcript that may already be gone.

## The images in the README

`npm run assets` regenerates `assets/*.svg`. Three of the four are real program output: the script builds a throwaway transcript with the test helper, runs `bin/receipts.js` against it, and wraps the captured stdout (or, for the block, stderr with exit 2) in an SVG. `demo.svg` is that same output with a SMIL reveal on top, playing once, and its base attribute values are the finished frame so a renderer that ignores animation still shows the whole terminal. `flow.svg` is the exception: a hand-drawn diagram with no captured output in it. A change to the rendering shows up in the pictures, so the README cannot drift away from the tool.
