---
name: syndicate
description: "Syndicate — PE/VC multi-model deal analysis framework. Run 4 AI models (Claude, Gemini, Grok, GPT) through adversarial debate on private market deals across vc_early, growth_equity, buyout_pe, and infra_energy modes."
---

# Syndicate PE/VC Arena — $ARGUMENTS

You are the Supervisor (pure orchestrator). **Do no analysis yourself.** All deep reasoning is delegated to sub-agents. You only handle file passing, task scheduling, and result display. Follow these steps strictly.

## Core Principles

### Divergence Preservation > Consensus Convergence
Syndicate's core value is exposing divergence in deal analysis, not reaching consensus. Disagreements across 4 models are information gains — consensus means the multi-model debate added no value. Supervisor judgment: post-R2 divergence > R1 divergence > consensus.

### Model Bias Correction
Each model has known biases: Claude (same family — hold Analyst A to higher evidence standards), Gemini (strong structured output but may over-framework), Grok (X/Twitter real-time data is unique advantage but may be misled by social media noise), GPT (strong web search but may over-rely on surface authority). Supervisor uses these biases in Step 2 directives and Step 4 weight allocation.

### Deal Type Adaptation
The entire framework adapts to the deal mode selected in Step 0. Prompts, quality gates, scenario matrices, archive routing, and co-invest framing all change by mode.

### Files as Communication
All sub-agents communicate via /tmp files. Supervisor does NOT hold full text in its own context. Every step's output files are the contract for the next step.

**Execution rules:**
- Create/write files using the Write tool only — **no Bash redirects**
- Spawn sub-agents with `model: opus` for all Opus sub-agent steps
- Decision Brief and all output: **English throughout** (no Chinese)

## Dependency Graph

```
Critical path (all serial):
Step 0 (setup+context) → R1 → Step 2 (divergence) → R2 → Step 4 (Brief) → Step 5 (assemble)
```

---

## Step 0: Deal Setup

### 0-pre. Clean up previous run files

```bash
rm -f /tmp/pe_r1_*.md /tmp/pe_r2_*.md /tmp/pe_step2_*.md /tmp/pe_step2_*.json /tmp/pe_decision_brief.md /tmp/pe_*.json /tmp/pe_full_input.txt /tmp/pe_scorecard_data.json
```

### 0-cal. Prior Scorecard Summary (if data exists)

Display historical calibration. FYI only — not injected into agent prompts.

```bash
python3 ~/scripts/syndicate/pe_scorecard.py --summary
```

### 0a. Deal Type Selection

Ask user (or infer from context/arguments):

| Mode | When |
|------|------|
| `vc_early` | Seed / Series A (the VC fund) |
| `growth_equity` | Series B+ (the VC fund) |
| `buyout_pe` | Control buyout (the VC fund/the opco-style) |
| `infra_energy` | your infra PE fund deals |

Store `DEAL_MODE` for all subsequent steps.

### 0b. Deal Context Collection

If not provided in $ARGUMENTS, ask user for:
- Company name, sector, stage
- Revenue / EBITDA (last known), or contracted capacity for infra
- Entry valuation / EV / asking price
- Deal structure, known shareholders
- Any background materials (optional paste)

### 0c. Web Research (mode-adapted)

*All modes:*
- Sector news, competitive landscape
- Recent M&A comps in sector
- Founders/management reputation signals

*vc_early / growth_equity:*
- AI moat signals if AI-native: data assets, model quality, inference cost trends
- Comparable funding rounds and valuations
- China/Asia competitive dynamics if relevant (the VC fund edge)

*buyout_pe:*
- Public comps (EV/EBITDA, EV/Rev)
- AI/tech transformation case studies in same sector
- Tech readiness signals: engineering headcount, ML/AI job postings, tech stack

*infra_energy:*
- Hyperscaler demand signals (data center expansion announcements)
- Grid congestion / interconnect queue data in target geography
- PPA/offtake market rates
- Behind-the-meter project comps (capacity, yield, IRR)
- Permitting and regulatory signals

### 0d. Construct Full Input

```
FULL_INPUT = deal_context + deal_mode + comp_set + web_research
```

Write to `/tmp/pe_full_input.txt` using the Write tool.

---

## Step 1: R1 Parallel Analysis (4 Agents, All Parallel)

Construct R1 input JSON:
```json
{"deal": "COMPANY summary (one line)", "deal_mode": "DEAL_MODE", "full_input_path": "/tmp/pe_full_input.txt"}
```

Write to `/tmp/pe_r1_input.json` using the Write tool.

**Launch 2 tasks in parallel** — Agent tool call and Bash tool call in the same message, both background:

### External Agents (Gemini/Grok/GPT) — Bash (background)

```bash
python3 ~/scripts/syndicate/pe_engine.py r1 --input /tmp/pe_r1_input.json --output /tmp/pe_r1_output.json
```

### Agent A (Claude Opus) — CC sub-agent (background)
- model: opus
- `run_in_background: true`
- Reads `/tmp/pe_full_input.txt`, uses WebSearch, produces R1 analysis
- Writes to `/tmp/pe_r1_claude.md`
- Prompt: see `references/syndicate-prompts.md` §R1 Claude Prompt

Wait for both background tasks to complete, then collect results.

### Collect External Results

Read `/tmp/pe_r1_output.json`, extract each agent's content into .md files:
- `/tmp/pe_r1_gemini.md`
- `/tmp/pe_r1_grok.md`
- `/tmp/pe_r1_openai.md`

### R1 Quality Gate

Quick quality check on each R1 file:
1. **Length** >= 3000 chars
2. **Scenario probabilities** contains "Scenario" and "%"
3. **Falsification conditions** contains "falsification"/"wrong"/"if I am wrong"
4. **Mode-specific terms:**
   - `vc_early`/`growth_equity`: contains "team" or "founder", "moat", "IRR" or "multiple"
   - `buyout_pe`: contains "EBITDA", "IRR", "AI transformation"
   - `infra_energy`: contains "PPA" or "offtake", "IRR", "DSCR" or "yield"

Failure → tell user "[Agent X] R1 quality below threshold: {reason}. Re-run? (y/n)"

---

## Step 2: Fact-Check + Divergence Map (Opus sub-agent)

**Do NOT do this in the main session.** Spawn Opus sub-agent with clean 200K context.

Prompt: see `references/syndicate-prompts.md` §Step 2 Divergence Analysis Prompt.

Output:
1. `/tmp/pe_step2_divergence.md` — full divergence analysis
2. `/tmp/pe_step2_directives.json` — per-agent R2 directives: `{"claude": "...", "gemini": "...", "grok": "...", "openai": "..."}`

---

## Step 3: R2 Steelman Parallel (4 Agents)

### Construct R2 Input

Build `/tmp/pe_r2_input.json` containing:
- `r1_analyses`: dict of agent → R1 content (read from /tmp/pe_r1_*.md)
- `divergence_map`: content of /tmp/pe_step2_divergence.md
- `directives`: content of /tmp/pe_step2_directives.json

Write using the Write tool.

**Launch 2 tasks in parallel:**

### External Agents R2 — Bash (background)
```bash
python3 ~/scripts/syndicate/pe_engine.py r2 --input /tmp/pe_r2_input.json --output /tmp/pe_r2_output.json
```

### Agent A R2 (Claude Opus) — sub-agent (background)
- Reads all files (R1×4 + divergence map + directive)
- Prompt: see `references/syndicate-prompts.md` §R2 Claude Prompt
- Writes to `/tmp/pe_r2_claude.md`

Collect External R2 results into .md files:
- `/tmp/pe_r2_gemini.md`
- `/tmp/pe_r2_grok.md`
- `/tmp/pe_r2_openai.md`

---

## Step 4: Decision Brief — IC Memo (Opus sub-agent)

Spawn Opus sub-agent. Reads R1×4 + divergence map + R2×4 as full input.

The Decision Brief is an **IC Memo** — English throughout.

Prompt: see `references/syndicate-prompts.md` §Step 4 Decision Brief Prompt.

Output: `/tmp/pe_decision_brief.md`

---

## Step 5: Assembly + Archive

### 5a. Grok Restructure (R1 + R2)

Spawn a Claude sub-agent (model: haiku) to restructure Grok's compressed output into readable format.

The sub-agent should:
1. Read `/tmp/pe_r1_grok.md`
2. Apply the RESTRUCTURE prompt (from `references/syndicate-prompts.md` — RESTRUCTURE_SYSTEM section)
3. Write restructured version to `/tmp/pe_r1_grok_readable.md`
4. Read `/tmp/pe_r2_grok.md`
5. Apply same restructure
6. Write to `/tmp/pe_r2_grok_readable.md`

### 5b. Assemble Reading Version

Construct JSON for assembly, then run:

```bash
python3 ~/scripts/syndicate/pe_engine.py assemble --input /tmp/pe_assemble_input.json --output /tmp/pe_syndicate_output.md
```

The assemble input JSON should include:
- `deal`, `deal_mode`, `r1_content` (dict of agent→content, using _readable for grok), `supervisor_factcheck`, `r2_content`, `decision_brief`

### 5c. Scorecard Extraction (milestones → SQLite)

Opus sub-agent reads Decision Brief, extracts structured milestone/IRR data to `/tmp/pe_scorecard_data.json`, then import via CLI.

Prompt: see `references/syndicate-prompts.md` §Step 5c Scorecard Extraction Prompt.

```bash
python3 ~/scripts/syndicate/pe_scorecard.py --import-json /tmp/pe_scorecard_data.json
```

### 5c-post. Check for Prior Deal Entries

Check for existing pending milestones on the same company.

```bash
python3 ~/scripts/syndicate/pe_scorecard.py --pending
```

### 5d. Archive to Obsidian (mode-adapted routing)

Generate filename: `YYYY-MM-DD Syndicate — [Company Name].md`

**Archive routing by deal type:**
- `vc_early` / `growth_equity` → `~/Work/[00] Brain/10 your VC fund/Deal Notes/Company Name.md`
- `buyout_pe` → `~/Work/[00] Brain/10 your VC fund/Deal Notes/Company Name.md`
- `infra_energy` → `~/Work/[00] Brain/30 your infra PE fund/[subfolder if determinable]/YYYY-MM-DD Syndicate — Company Name.md`
- General/research → `~/Work/[00] Brain/50 Research/YYYY-MM-DD Syndicate — Topic.md`

```bash
cp /tmp/pe_syndicate_output.md "[destination path]"
open "obsidian://open?vault=[00] Brain&file=[encoded path]"
```

Report the final Obsidian path to user.

### 5e. Display Decision Brief

Read and display the full IC Memo (Decision Brief) to the user.
