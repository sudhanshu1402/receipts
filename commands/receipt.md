---
description: Show the receipt for this session — claims made against evidence in the transcript
allowed-tools: Bash(node:*)
---

Run the receipt for the current session and show the user the raw output, unchanged:

!`node "${CLAUDE_PLUGIN_ROOT}/bin/receipts.js" show`

Then stop. Do not re-verify, re-run, or defend the flagged claims unless the user asks. If a row is wrong, say which row and why in one line.
