# Arena

**Multi-model adversarial analysis framework for investment research.**

Arena runs 4 AI models (Claude, Gemini, Grok, GPT) through a structured adversarial debate on any investment or macro topic. Each model analyzes independently with real-time web/search access, then challenges each other's assumptions in a second round. The output preserves disagreement — where models converge is signal, where they diverge is where the edge lives.

## How It Works

```
Topic: "Impact of new tariffs on energy markets"
        │
        ▼
┌─── Step 0: Prep ──────────────────────────────┐
│  Fetch live prices, prediction markets, IV     │
└────────────────────────────────────────────────┘
        │
        ▼
┌─── Step 1: R1 (4 agents, parallel) ───────────┐
│  Claude (WebSearch) ──┐                        │
│  Gemini (Google Search) ──┤  Independent       │
│  Grok (X/Twitter + Web) ──┤  analysis          │
│  GPT (Web Search) ────┘                        │
└────────────────────────────────────────────────┘
        │
        ▼
┌─── Step 2: Divergence Map ────────────────────┐
│  Cross-verify data points                      │
│  Identify where models disagree and why        │
│  Write targeted R2 directives per agent        │
└────────────────────────────────────────────────┘
        │
        ▼
┌─── Step 3: R2 Steelman (4 agents, parallel) ──┐
│  Each agent responds to strongest counter-     │
│  argument with NEW evidence only               │
│  No recycling. No social pressure convergence. │
└────────────────────────────────────────────────┘
        │
        ▼
┌─── Step 4: Decision Brief ────────────────────┐
│  Supervisor scenario matrix                    │
│  Asset price targets per scenario              │
│  Position structure recommendation             │
│  Devil's advocate on consensus items           │
└────────────────────────────────────────────────┘
        │
        ▼
┌─── Step 5: Archive + Scorecard ───────────────┐
│  Structured predictions → SQLite               │
│  Auto-scoring via yfinance at check dates      │
│  Calibration tracking over time                │
└────────────────────────────────────────────────┘
```

## Core Principles

1. **Divergence > Consensus** — If all 4 models agree, Arena added no value. Divergence points are information gains.
2. **No social pressure** — R2 convergence toward the mean is flagged. Agents that strengthen their position against opposition get higher weight.
3. **Real-time data** — Each model has web/search access. Gemini uses Google Search, Grok uses X/Twitter + web, GPT uses web search, Claude uses web search.
4. **Backtestable** — Every run produces structured predictions with check dates. Auto-scored against actual prices via yfinance.

## Setup

### Prerequisites

- [Claude Code](https://claude.ai/code) (CLI or desktop app)
- Python 3.11+
- API keys for Gemini, Grok (xAI), and OpenAI

### Install

```bash
git clone https://github.com/your-username/JerryOS.git
cd JerryOS/modules/arena
cd arena
pip install -r requirements.txt
cp .env.example .env
# Edit .env with your API keys
```

### Configure Claude Code

Install the Arena skill:

```bash
# Symlink the skill into Claude Code
mkdir -p ~/.claude/skills/arena/references
ln -s $(pwd)/skill/SKILL.md ~/.claude/skills/arena/SKILL.md
ln -s $(pwd)/skill/references/arena-prompts.md ~/.claude/skills/arena/references/arena-prompts.md
```

Set the Arena directory so the skill can find the engine scripts:

```bash
# Add to your shell profile (.zshrc, .bashrc)
export ARENA_DIR="$(pwd)"
```

## Usage

In Claude Code, run:

```
/arena Impact of new tariffs on energy markets
```

Arena takes 5-10 minutes to complete a full run (4 models x 2 rounds + synthesis). Total API cost is typically $0.50-2.00 per run.

### Standalone Engine Commands

```bash
# Test a single agent
python3 engine/arena_engine.py test --agent gemini --topic "Fed rate path"

# Fetch market baseline
python3 engine/gt_market_data.py prices --tickers '{"S&P 500": "^GSPC", "Gold": "GC=F"}' --output /tmp/baseline.txt

# Query prediction markets
python3 engine/gt_market_data.py predictions --queries '["tariffs", "fed rate"]' --output /tmp/predictions.txt

# Scorecard operations
python3 engine/arena_scorecard.py --summary
python3 engine/arena_scorecard.py --pending
python3 engine/arena_scorecard.py --auto-score
python3 engine/arena_scorecard.py --report
```

## Output

Each Arena run produces:

1. **4 x R1 analyses** — Independent first-round reports with scenario matrices and price targets
2. **Divergence map** — Where models agree/disagree, data conflicts, reasoning quality assessment
3. **4 x R2 steelman responses** — Second-round responses to targeted counter-arguments
4. **Decision Brief** — Supervisor's synthesized scenario matrix with asset price tables, position recommendations, and falsification conditions
5. **Scorecard data** — Structured predictions stored in SQLite for backtesting

## File Structure

```
arena/
├── engine/
│   ├── arena_engine.py      # Parallel API calls to Gemini/Grok/GPT
│   ├── prompts.py           # System prompts for each model
│   ├── gt_market_data.py    # Real-time prices, prediction markets, options
│   └── arena_scorecard.py   # SQLite prediction tracker + auto-scoring
├── skill/
│   ├── SKILL.md             # Claude Code skill (orchestration logic)
│   └── references/
│       └── arena-prompts.md # Sub-agent prompts for each step
├── data/                    # Scorecard database (gitignored)
├── .env.example             # API key template
├── requirements.txt         # Python dependencies
└── README.md
```

## Models Used

| Agent | Model | Unique Capability |
|-------|-------|-------------------|
| Claude | Opus 4.6 | WebSearch, deep reasoning, file I/O |
| Gemini | 3.1 Pro | Google Search grounding |
| Grok | 4.1 Fast Reasoning | X/Twitter real-time data + web search |
| GPT | 4.1 | Web search, strong structured output |

## Cost Per Run

Typical full run (R1 + R2 for all 4 agents + synthesis):

| Component | Cost |
|-----------|------|
| Claude (2 rounds + synthesis) | ~$0.50-1.00 |
| Gemini (2 rounds) | ~$0.10-0.30 |
| Grok (2 rounds) | ~$0.02-0.05 |
| GPT (2 rounds) | ~$0.20-0.50 |
| **Total** | **~$0.80-1.85** |

## License

Private. Do not redistribute without permission.
