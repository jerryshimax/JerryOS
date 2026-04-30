---
name: codex-review
description: "Cross-model code review — uses the official Codex plugin for independent review. Auto-fixes mechanical issues, escalates design issues."
user_invocable: true
---

# Codex Code Review — $ARGUMENTS

## What This Is

Cross-model code review gate. Claude collects context (diff, design intent, key files), then invokes the official Codex plugin for independent review. A different model family catches blind spots the builder misses.

## Instructions

### Step 1: Collect Context (3 layers)

**Layer 1 — The Diff:**
```bash
git diff HEAD~1          # or the range the user specifies
git diff --stat HEAD~1   # summary of what changed
```
If $ARGUMENTS specifies a commit range, branch, or path — use that instead.

**Layer 2 — Design Intent:**
- Read any Architecture/spec doc referenced in the diff or in Brain (`[Ship]` files for this project)
- Read the most recent plan if one exists
- Summarize in 3-5 sentences: what was this change supposed to accomplish?

**Layer 3 — Key File Summaries:**
- For each file with >50 lines changed, read the full file
- For each file with <50 lines changed, read enough surrounding context (±30 lines around each hunk)
- Extract: exports, types, function signatures, dependencies

### Step 2: Send to Codex via Plugin

**Standard review (default):**
Run `/codex:review --background` with the collected context. The plugin sends the diff + context to Codex for review.

**For high-stakes changes (migrations, auth, infra, refactors):**
Run `/codex:adversarial-review` instead — this tells Codex to actively challenge the implementation, not just inspect it.

Use `/codex:status` to check progress if running in background.
Use `/codex:result` to retrieve the review output when done.

### Step 3: Process Results

Parse Codex response and act:

| Codex Verdict | Action |
|---------------|--------|
| PASS | Tell the user "Codex review passed" with any INFO items listed |
| CHANGES_REQUIRED | Split issues into mechanical vs design: |
| | - **Mechanical** (typos, missing null checks, obvious bugs): fix them directly, show the user what you fixed |
| | - **Design** (architecture disagreements, approach questions): present to the user for decision |
| NEEDS_DISCUSSION | Present all judgment-call items to the user with both Claude's and Codex's perspectives |

### Step 4: Optional Re-Review

If you made fixes in Step 3, offer: "Want me to send the fixes back to Codex for a second pass?"

If the user says yes → collect the new diff and repeat Step 2-3. Max 3 rounds.

### Step 5: Audit Trail (Optional)

If the project warrants an audit log, run the shell script to save structured output:
```bash
~/Ship/tools/codex-review.sh git --save <project> <sprint>
```

## Output Format

```
## Codex Code Review

**Scope:** {files changed} | {lines added/removed}
**Method:** Codex Plugin (/codex:review or /codex:adversarial-review)
**Verdict:** PASS / CHANGES_REQUIRED / NEEDS_DISCUSSION

### Critical Issues
- [ ] **file.ts:42** — [issue]. Fix: [suggestion]

### Warnings
- [ ] **file.ts:88** — [issue]. Consider: [suggestion]

### Info
- **file.ts:12** — [observation]

### Auto-Fixed
- [x] **file.ts:42** — [what was fixed and why]

### Claude vs Codex Disagreements
| Issue | Claude's View | Codex's View | Recommendation |
|-------|--------------|--------------|----------------|
```

## When to Use

- After writing code, before committing: `/codex-review`
- After a big refactor: `/codex-review HEAD~5..HEAD`
- Review a specific file: `/codex-review src/app/api/route.ts`
- Review a branch: `/codex-review main..feature-branch`
- High-stakes changes: `/codex-review` (will auto-use adversarial-review)
