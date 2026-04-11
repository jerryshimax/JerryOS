---
name: arena
description: "GroupThink Arena — multi-model divergence-preserving analysis framework. Run 4 AI models (Claude, Gemini, Grok, GPT) through adversarial debate on investment/macro topics."
---

# GroupThink Arena — $ARGUMENTS

You are the Supervisor (pure orchestrator). **Do no analysis yourself.** All deep reasoning is delegated to sub-agents. You only handle file passing, task scheduling, and result display. Follow these steps strictly.

## Core Principles

### Divergence Preservation > Consensus Convergence
Arena's core value is exposing divergence, not reaching consensus. Divergence points across 4 models are information gains — if all models agree, Arena added no value. Supervisor judgment: post-R2 divergence > R1 divergence > consensus. Consensus needs Devil's Advocate stress testing.

### Model Bias Correction
Each model has known biases: Claude (same family — hold Analyst A to higher evidence standards), Gemini (strong structured output but may over-framework), Grok (X/Twitter real-time data is unique advantage but may be misled by social media noise), GPT (strong web search but may over-rely on surface authority of search results). Supervisor doesn't analyze, but uses these biases in Step 2 directives and Step 4 weight allocation.

### Quality > Speed
R1 Quality Gate exists because one low-quality R1 analysis pollutes the entire R2 conversation and Decision Brief. Better to re-run a single agent for 2 minutes than carry bad data through the full flow.

### Files as Communication
All sub-agents communicate via /tmp files. Supervisor does NOT hold full text in its own context. Every step's output files are the contract for the next step.

**Execution rules:**
- Create/write files using the Write tool only — **no Bash redirects**
- Spawn sub-agents with `model: opus` for all Opus sub-agent steps

## Dependency Graph

```
Critical path (all serial):
Step 0 (cleanup+prep) → R1 → Step 2 (divergence) → R2 → Step 4 (Brief) → Step 5 (assemble)
```

**Core principle**: AI analysis reads raw originals. No translation steps — entire flow in English (Decision Brief in Chinese).

---

## Step 0: Preparation (Dynamic Tickers + Price Baseline + Optional Data Sources)

### 0-pre. Clean up previous run files

```bash
rm -f /tmp/gt_r1_*.md /tmp/gt_r2_*.md /tmp/gt_step2_*.md /tmp/gt_step2_*.json /tmp/gt_decision_brief.md /tmp/gt_*.json /tmp/gt_*.py /tmp/gt_market_baseline.txt /tmp/gt_full_input.txt /tmp/gt_prediction_markets.txt /tmp/gt_options_data.txt /tmp/gt_scorecard_data.json
```

### 0-cal. Calibration Summary (if historical Scorecard data exists)

Display historical calibration summary. Pure FYI, not injected into agent prompts.
If DB doesn't exist or is empty, silently skip.

```bash
python3 ~/scripts/arena/arena_scorecard.py --summary
```

### 0a. Dynamic Ticker Generation

Based on user topic, generate ticker dict (Python dict literal).

**Default set** (always include):
```python
"WTI Crude": "CL=F", "Brent Crude": "BZ=F",
"S&P 500": "^GSPC", "Nasdaq": "^IXIC",
"Gold": "GC=F", "VIX": "^VIX", "DXY": "DX-Y.NYB",
```

**Add by topic** (Supervisor judgment):
- Geopolitical/energy → Copper `HG=F`, XLE, LMT, USO
- Crypto → BTC-USD, ETH-USD, SOL-USD
- Tech → QQQ, NVDA, MSFT
- China → FXI, KWEB, BABA
- Japan → EWJ, JPY=X
- Rates → TLT, ^TNX
- Other: judge based on topic

### 0b. Fetch real-time price baseline

```bash
python3 ~/scripts/arena/gt_market_data.py prices --tickers '{"S&P 500": "^GSPC", ...}' --output /tmp/gt_market_baseline.txt
```

### 0c. Knowledge Base Briefing (optional)

If you have a local knowledge base (articles, research reports), search for topic-related content as briefing.
Low value for real-time breaking events (agents have search). High value for topics with historical accumulation.

### 0e. Historical Data Baseline (conditional)

If topic involves historical analogies or backtesting (keywords: historical, 1970s, analogy, backtest, etc.):
1. Use WebSearch for authoritative standardized data (FRED, Shiller dataset, BLS)
2. Construct "HISTORICAL REFERENCE DATA" paragraph for FULL_INPUT
3. If no reliable baseline, note for analysts to self-annotate data sources

### 0f. Prediction Market Data (optional)

Extract keywords from topic, query prediction market contracts (Polymarket Gamma API).

```bash
python3 ~/scripts/arena/gt_market_data.py predictions --queries '["keyword1", "keyword2"]' --output /tmp/gt_prediction_markets.txt
```

### 0g. Options & Positioning Data (optional)

Select liquid ETFs related to topic, fetch ATM IV, P-C ratio.

```bash
python3 ~/scripts/arena/gt_market_data.py options --tickers '["SPY", "USO"]' --output /tmp/gt_options_data.txt
```

### 0d. Construct Full Input

```
FULL_INPUT = PRICE_BASELINE + PREDICTION_MARKETS (if any) + OPTIONS_DATA (if any)
             + HISTORICAL_REFERENCE (if any) + "\n\n---\n\n" + topic + briefing (if any)
```

Write to `/tmp/gt_full_input.txt` using the Write tool.

---

## Step 1: R1 Parallel Analysis (4 Agents, All Parallel)

Construct R1 input JSON:
```json
{"topic": "TOPIC summary (one line)", "full_input_path": "/tmp/gt_full_input.txt"}
```

Write to `/tmp/gt_r1_input.json` using the Write tool.

**Launch 2 tasks in parallel** — send Agent tool call and Bash tool call in the same message, both background:

### External Agents (Gemini/Grok/GPT) — Bash (background)

```bash
python3 ~/scripts/arena/arena_engine.py r1 --input /tmp/gt_r1_input.json --output /tmp/gt_r1_output.json
```

### Agent A (Claude Opus) — CC sub-agent (background)
- model: opus
- `run_in_background: true`
- Reads `/tmp/gt_full_input.txt`, uses WebSearch, produces R1 analysis
- Writes to `/tmp/gt_r1_claude.md`
- Prompt: see `references/arena-prompts.md` §R1 Claude Prompt

Wait for both background tasks to complete, then collect results.

### Collect External Results

Read `/tmp/gt_r1_output.json`, extract each agent's content into .md files:
- `/tmp/gt_r1_gemini.md`
- `/tmp/gt_r1_grok.md`
- `/tmp/gt_r1_openai.md`

### R1 Quality Gate

Quick quality check on each R1 file:
1. **Length** >= 3000 chars
2. **Price citation** >= 3 prices from baseline
3. **Scenario probabilities** contains "Scenario" and "%"
4. **Falsification conditions** contains "falsification"/"wrong"/"if I am wrong"

Failure → tell user "[Agent X] R1 quality below threshold: {reason}. Re-run? (y/n)"

---

## Step 2: Fact-Check + Divergence Map (Opus sub-agent)

**Do NOT do this in the main session.** Spawn Opus sub-agent with clean 200K context.

Prompt: see `references/arena-prompts.md` §Step 2 Divergence Analysis Prompt.

Output:
1. `/tmp/gt_step2_divergence.md` — full divergence analysis
2. `/tmp/gt_step2_directives.json` — per-agent R2 directives: `{"claude": "...", "gemini": "...", "grok": "...", "openai": "..."}`

---

## Step 3: R2 Steelman Parallel (4 Agents + 8 files)

### Construct R2 Input

Build `/tmp/gt_r2_input.json` containing:
- `r1_analyses`: dict of agent → R1 content (read from /tmp/gt_r1_*.md)
- `divergence_map`: content of /tmp/gt_step2_divergence.md
- `directives`: content of /tmp/gt_step2_directives.json

Write using the Write tool.

**Launch 2 tasks in parallel:**

### External Agents R2 — Bash (background)
```bash
python3 ~/scripts/arena/arena_engine.py r2 --input /tmp/gt_r2_input.json --output /tmp/gt_r2_output.json
```

### Agent A R2 (Claude Opus) — sub-agent (background)
- Reads all files (R1×4 + divergence map + directive)
- Prompt: see `references/arena-prompts.md` §R2 Claude Prompt
- Writes to `/tmp/gt_r2_claude.md`

Collect External R2 results into .md files:
- `/tmp/gt_r2_gemini.md`
- `/tmp/gt_r2_grok.md`
- `/tmp/gt_r2_openai.md`

---

## Step 4: Decision Brief (Opus sub-agent)

Spawn Opus sub-agent. Reads R1×4 + divergence map + R2×4 as full input.

Prompt: see `references/arena-prompts.md` §Step 4 Decision Brief Prompt.

Output: `/tmp/gt_decision_brief.md`

---

## Step 5: Assembly + Archive

### 5a. Grok Restructure (R1 + R2)

Grok fast-reasoning output is highly compressed. Spawn a Claude sub-agent (model: haiku) to restructure into readable format.

The sub-agent should:
1. Read `/tmp/gt_r1_grok.md`
2. Apply the RESTRUCTURE prompt (from `references/arena-prompts.md` — the RESTRUCTURE_SYSTEM section): reformat dense output into clean markdown with bullet points, expanded abbreviations, paragraph breaks. DO NOT change any content, data, or conclusions.
3. Write the restructured version to `/tmp/gt_r1_grok_readable.md`
4. Read `/tmp/gt_r2_grok.md`
5. Apply the same restructure process
6. Write to `/tmp/gt_r2_grok_readable.md`

### 5b. Assemble Reading Version

Construct JSON for assembly, then run:

```bash
python3 ~/scripts/arena/arena_engine.py assemble --input /tmp/gt_assemble_input.json --output /tmp/gt_arena_output.md
```

The assemble input JSON should include:
- `topic`, `market_baseline`, `r1_translated` (dict of agent→content, using _readable for grok), `supervisor_factcheck`, `r2_translated`, `decision_brief`

### 5c. Scorecard Extraction (predictions → SQLite)

Opus sub-agent reads Decision Brief, extracts structured prediction data to `/tmp/gt_scorecard_data.json`, then import via CLI.

Prompt: see `references/arena-prompts.md` §Step 5c Scorecard Extraction Prompt.

```bash
python3 ~/scripts/arena/arena_scorecard.py --import-json /tmp/gt_scorecard_data.json
```

### 5c-post. Auto-detect Superseded Predictions

Check for old pending predictions on the same assets. Prompt user to mark as superseded if found.

```bash
python3 ~/scripts/arena/arena_scorecard.py --pending
```

### 5d. Archive to Obsidian

Generate a filename from the topic: `YYYY-MM-DD Arena — [Short Topic Title].md` (use today's date, max ~50 chars for the topic portion, title-cased).

Copy `/tmp/gt_arena_output.md` to `~/Work/[00] Brain/50 Research/` with that filename using the Bash tool:

```bash
cp /tmp/gt_arena_output.md "~/Work/[00] Brain/50 Research/YYYY-MM-DD Arena — Topic.md"
```

Then open the file in Obsidian:

```bash
open "obsidian://open?vault=[00] Brain&file=50 Research/YYYY-MM-DD Arena — Topic.md"
```

Report the final Obsidian path to the user.

### 5e. Display Decision Brief

Read and display the full Decision Brief to the user.

### 5f. Optional: Push to Notion / other knowledge systems

Can integrate with Notion API or other systems as needed.
