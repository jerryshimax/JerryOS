---
name: codex-plan-review
description: "Cross-model plan review — sends architecture/implementation plan to Codex via official plugin as an adversarial attacker to find failure modes before building."
user_invocable: true
---

# Codex Plan Review — $ARGUMENTS

## What This Is

Adversarial plan review gate. Before building, Claude structures the plan and sends it to Codex via `/codex:adversarial-review` with an attacker mindset: "find every way this plan will FAIL." Catches bad assumptions, missing edge cases, and architectural mistakes before a single line of code is written.

## Instructions

### Step 1: Structure the Plan

If a plan already exists (Architecture doc, spec in Brain, or in the current conversation), use it. Otherwise, write a structured plan first:

```markdown
## Objective
What we're building and why

## Approach
How we're building it — tech choices, data model, key patterns

## Scope
What's in v1, what's explicitly NOT in v1

## Data Model
Tables, relationships, key fields

## API Surface
Endpoints/Server Actions, inputs, outputs

## UI Flow
Key screens, user journey, state management

## Security Model
Auth, authorization, RLS, input validation

## Risks & Open Questions
What I'm not sure about
```

Present this plan to Jerry for quick alignment before sending to Codex.

### Step 2: Collect Supporting Context (3 layers)

**Layer 1 — The Plan:** The structured plan from Step 1

**Layer 2 — Conversation Context:**
- Extract the original request/requirements from the conversation
- Any constraints Jerry mentioned (timeline, tech, integration points)
- Decisions already made and why

**Layer 3 — Key Files:**
- Existing code that this plan builds on or modifies (read relevant files)
- Related Brain docs (existing Architecture specs, prior versions)
- Config files that constrain the implementation (package.json, tsconfig, etc.)

### Step 3: Send to Codex (Adversarial)

Use `/codex:adversarial-review` with the full plan context. Frame the review as:

> You are a hostile technical reviewer. Your ONLY job is to find ways this plan will FAIL.
> Do NOT praise what's good. Do NOT suggest alternatives unless the current approach is broken.
>
> Attack Vectors:
> 1. Missing Edge Cases — What inputs, states, or user behaviors will break this?
> 2. Ambiguous Specs — Where will an implementer get stuck or interpret this wrong?
> 3. Security Gaps — What's exploitable in this data model / API / auth design?
> 4. Scaling Failures — What breaks at 10x, 100x, 1000x load?
> 5. Integration Failures — What external dependencies could fail? What happens when they do?
> 6. Data Integrity — What happens during partial failures, race conditions, concurrent writes?
> 7. Scope Creep Traps — What looks simple but will balloon in implementation?
> 8. Wrong Abstraction — Where is this over-engineered or under-engineered for v1?

Use `/codex:status` to check progress. Use `/codex:result` to retrieve findings.

### Step 4: Process Results

| Codex Verdict | Action |
|---------------|--------|
| PROCEED | Tell Jerry "Plan passed adversarial review" with any MEDIUM items noted |
| REVISE | Present each CRITICAL/HIGH issue to Jerry: |
| | - Issues Claude agrees with: propose the fix, apply if Jerry approves |
| | - Issues Claude disagrees with: present both perspectives, let Jerry decide |
| RETHINK | Full stop. Present Codex's argument for why the approach is fundamentally wrong. Claude adds its own assessment. Jerry decides: revise or proceed anyway. |

### Step 5: Iterate (Max 3 Rounds)

If the plan was revised:
1. Update the structured plan with fixes
2. Send the revised plan back to Codex: "Here is the revised plan addressing your previous flags. Find new failure modes."
3. Repeat until PROCEED or 3 rounds reached
4. If still REVISE after 3 rounds: present remaining issues to Jerry, proceed with acknowledged risks

### Step 6: Audit Trail (Optional)

For projects that warrant it:
```bash
~/Ship/tools/codex-review.sh plan <spec_file> --save <project> <sprint>
```

## Output Format

```
## Codex Plan Review

**Plan:** {what's being reviewed}
**Method:** Codex Plugin (/codex:adversarial-review)
**Verdict:** PROCEED / REVISE / RETHINK
**Round:** {1/2/3}

### Critical Failures
- [ ] **[Area]** — {failure scenario}. Severity: CRITICAL. Fix: {minimum change}

### High-Risk Issues
- [ ] **[Area]** — {failure scenario}. Severity: HIGH. Fix: {minimum change}

### Medium-Risk Issues
- **[Area]** — {failure scenario}. Note: {context}

### Claude vs Codex Disagreements
| Issue | Claude's View | Codex's View | Jerry's Call Needed |
|-------|--------------|--------------|---------------------|

### Plan Revisions Applied
- [x] {what was changed and why}

### Acknowledged Risks (proceeding anyway)
- {risk} — Reason to accept: {justification}
```

## When to Use

- Before starting a new project: `/codex-plan-review`
- After writing an architecture spec: `/codex-plan-review`
- Before a major refactor: `/codex-plan-review the migration plan`
- When unsure about an approach: `/codex-plan-review should we use X or Y`
