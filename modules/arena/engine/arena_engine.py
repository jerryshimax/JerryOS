#!/usr/bin/env python3
"""
GroupThink Arena Engine — parallel API calls to Gemini / Grok / GPT.

Usage:
    arena_engine.py r1 --input /tmp/gt_r1_input.json --output /tmp/gt_r1_output.json
    arena_engine.py r2 --input /tmp/gt_r2_input.json --output /tmp/gt_r2_output.json
    arena_engine.py assemble --input /tmp/gt_assemble_input.json --output output.md
    arena_engine.py test --agent gemini --topic "Fed rate path"
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone, timedelta

# ============ Load environment variables ============

def _load_env():
    """Load API keys from env file."""
    # Try .env in repo root first, then ~/env.sh as fallback
    repo_env = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.env')
    env_path = repo_env if os.path.exists(repo_env) else os.path.expanduser("~/env.sh")
    if not os.path.exists(env_path):
        return
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            if line.startswith('export '):
                line = line[7:]
            key, _, value = line.partition('=')
            key, value = key.strip(), value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"):
                value = value[1:-1]
            os.environ.setdefault(key, value)

_load_env()

# ============ Prompt imports ============

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from prompts import (
    CONTEXT_PREFIX,
    R1_SYSTEM_GEMINI,
    R1_SYSTEM_GROK,
    R1_SYSTEM_OPENAI,
    R2_SYSTEM,
    PRICING,
)

# ============ Thread-safe print ============

_print_lock = threading.Lock()

def safe_print(msg):
    with _print_lock:
        print(msg, flush=True)

# ============ Timestamp (UTC) ============

def now_ts():
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")

# ============ Gemini API (native SDK + Google Search grounding) ============

def call_gemini(system_prompt, user_content, max_retries=3):
    """Call Gemini Pro + Google Search grounding (native SDK)."""
    from google import genai
    from google.genai import types

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise EnvironmentError("Missing GEMINI_API_KEY")

    client = genai.Client(api_key=api_key)
    google_search_tool = types.Tool(google_search=types.GoogleSearch())

    last_error = None
    for attempt in range(1, max_retries + 1):
        try:
            safe_print(f"[Gemini] Attempt {attempt}...")
            t0 = time.time()
            response = client.models.generate_content(
                model="gemini-3.1-pro-preview",
                contents=user_content,
                config=types.GenerateContentConfig(
                    system_instruction=system_prompt,
                    tools=[google_search_tool],
                    temperature=1.0,
                    max_output_tokens=65536,
                ),
            )
            latency = time.time() - t0
            safe_print(f"[Gemini] Done in {latency:.1f}s")

            content = response.text or ""
            usage = {}
            cost = 0.0
            if response.usage_metadata:
                um = response.usage_metadata
                usage = {
                    'prompt_tokens': getattr(um, 'prompt_token_count', 0) or 0,
                    'completion_tokens': getattr(um, 'candidates_token_count', 0) or 0,
                    'total_tokens': getattr(um, 'total_token_count', 0) or 0,
                }
                p = PRICING.get("gemini-3.1-pro-preview", {"input": 2.0, "output": 12.0})
                cost = usage['prompt_tokens'] * p['input'] / 1_000_000 + usage['completion_tokens'] * p['output'] / 1_000_000

            return {
                "content": content, "reasoning": None,
                "model": "gemini-3.1-pro-preview",
                "usage": usage, "cost": round(cost, 4),
                "latency": round(latency, 1), "error": None,
            }
        except Exception as e:
            last_error = str(e)
            safe_print(f"[Gemini] Attempt {attempt} failed: {e}")
            if attempt < max_retries:
                time.sleep(2 ** attempt)

    return {"content": "", "reasoning": None, "model": "gemini-3.1-pro-preview",
            "usage": {}, "cost": 0, "latency": 0, "error": last_error}

# ============ Grok API (x_search + web_search via Responses API) ============

def call_grok(system_prompt, user_content, max_retries=3):
    """Call Grok + x_search + web_search (xAI Responses API)."""
    from openai import OpenAI

    api_key = os.environ.get("XAI_API_KEY")
    if not api_key:
        raise EnvironmentError("Missing XAI_API_KEY")

    client = OpenAI(api_key=api_key, base_url="https://api.x.ai/v1", timeout=300)

    input_messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_content},
    ]
    tools = [{"type": "x_search"}, {"type": "web_search"}]

    last_error = None
    for attempt in range(1, max_retries + 1):
        try:
            safe_print(f"[Grok] Attempt {attempt} (Responses API)...")
            t0 = time.time()
            response = client.responses.create(
                model="grok-4-1-fast-reasoning",
                input=input_messages,
                tools=tools,
            )
            latency = time.time() - t0
            safe_print(f"[Grok] Done in {latency:.1f}s")

            content = ""
            for item in response.output:
                if hasattr(item, 'content') and item.content:
                    for block in item.content:
                        if hasattr(block, 'text'):
                            content += block.text
                elif hasattr(item, 'text'):
                    content += item.text

            usage = {}
            cost = 0.0
            if hasattr(response, 'usage') and response.usage:
                u = response.usage
                usage = {
                    'prompt_tokens': getattr(u, 'input_tokens', 0) or 0,
                    'completion_tokens': getattr(u, 'output_tokens', 0) or 0,
                    'total_tokens': (getattr(u, 'input_tokens', 0) or 0) + (getattr(u, 'output_tokens', 0) or 0),
                }
                p = PRICING.get("grok-4-1-fast-reasoning", {"input": 0.2, "output": 0.5})
                cost = usage['prompt_tokens'] * p['input'] / 1_000_000 + usage['completion_tokens'] * p['output'] / 1_000_000

            return {
                "content": content, "reasoning": None,
                "model": "grok-4-1-fast-reasoning",
                "usage": usage, "cost": round(cost, 4),
                "latency": round(latency, 1), "error": None,
            }
        except Exception as e:
            last_error = str(e)
            safe_print(f"[Grok] Attempt {attempt} failed: {e}")
            if attempt < max_retries:
                time.sleep(2 ** attempt)

    return {"content": "", "reasoning": None, "model": "grok-4-1-fast-reasoning",
            "usage": {}, "cost": 0, "latency": 0, "error": last_error}

# ============ GPT via OpenAI Responses API (with web_search) ============

def call_openai(system_prompt, user_content, max_retries=3):
    """Call GPT via OpenAI Responses API with web_search tool."""
    from openai import OpenAI

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise EnvironmentError("Missing OPENAI_API_KEY")

    client = OpenAI(api_key=api_key, timeout=300)

    input_messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_content},
    ]
    tools = [{"type": "web_search"}]

    last_error = None
    for attempt in range(1, max_retries + 1):
        try:
            safe_print(f"[OpenAI] Attempt {attempt} (Responses API)...")
            t0 = time.time()
            response = client.responses.create(
                model="gpt-4.1",
                input=input_messages,
                tools=tools,
            )
            latency = time.time() - t0
            safe_print(f"[OpenAI] Done in {latency:.1f}s")

            content = ""
            for item in response.output:
                if hasattr(item, 'content') and item.content:
                    for block in item.content:
                        if hasattr(block, 'text'):
                            content += block.text
                elif hasattr(item, 'text'):
                    content += item.text

            usage = {}
            cost = 0.0
            if hasattr(response, 'usage') and response.usage:
                u = response.usage
                usage = {
                    'prompt_tokens': getattr(u, 'input_tokens', 0) or 0,
                    'completion_tokens': getattr(u, 'output_tokens', 0) or 0,
                    'total_tokens': (getattr(u, 'input_tokens', 0) or 0) + (getattr(u, 'output_tokens', 0) or 0),
                }
                p = PRICING.get("gpt-4.1", {"input": 2.0, "output": 8.0})
                cost = usage['prompt_tokens'] * p['input'] / 1_000_000 + usage['completion_tokens'] * p['output'] / 1_000_000

            return {
                "content": content, "reasoning": None,
                "model": "gpt-4.1",
                "usage": usage, "cost": round(cost, 4),
                "latency": round(latency, 1), "error": None,
            }
        except Exception as e:
            last_error = str(e)
            safe_print(f"[OpenAI] Attempt {attempt} failed: {e}")
            if attempt < max_retries:
                time.sleep(2 ** attempt)

    return {"content": "", "reasoning": None, "model": "gpt-4.1",
            "usage": {}, "cost": 0, "latency": 0, "error": last_error}

# ============ Parallel execution ============

AGENT_CALLERS = {
    "gemini": (call_gemini, R1_SYSTEM_GEMINI),
    "grok": (call_grok, R1_SYSTEM_GROK),
    "openai": (call_openai, R1_SYSTEM_OPENAI),
}

DEFAULT_AGENTS = ["gemini", "grok", "openai"]

def run_parallel(agents, user_content, r2_data=None):
    """Run specified agents in parallel."""
    results = {}

    def _call_agent(name):
        if r2_data:
            r1_analyses = r2_data["r1_analyses"]
            own_r1 = r1_analyses.get(name, "")
            others = "\n\n".join(
                f"Analyst {k.capitalize()}:\n{v}"
                for k, v in r1_analyses.items() if k != name
            )
            directive = r2_data["directives"].get(name, "")
            user_msg = (
                f"=== YOUR ROUND 1 ANALYSIS ===\n{own_r1}\n\n"
                f"=== OTHER ANALYSTS' ROUND 1 ANALYSES ===\n\n{others}\n\n"
                f"=== DIVERGENCE MAP (from Analytical Director) ===\n{r2_data['divergence_map']}\n\n"
                f"=== DIRECTOR'S SPECIFIC DIRECTIVE TO YOU ===\n{directive}"
            )
            caller_fn = AGENT_CALLERS[name][0]
            return caller_fn(R2_SYSTEM, user_msg)
        else:
            caller_fn, system_prompt = AGENT_CALLERS[name]
            return caller_fn(system_prompt, user_content)

    with ThreadPoolExecutor(max_workers=4) as executor:
        futures = {executor.submit(_call_agent, name): name for name in agents}
        for future in as_completed(futures):
            name = futures[future]
            try:
                results[name] = future.result()
            except Exception as e:
                safe_print(f"[{name}] Fatal error: {e}")
                results[name] = {
                    "content": "", "reasoning": None, "model": name,
                    "usage": {}, "cost": 0, "latency": 0, "error": str(e),
                }

    total_cost = sum(r.get("cost", 0) for r in results.values())
    max_latency = max((r.get("latency", 0) for r in results.values()), default=0)
    results["metadata"] = {
        "total_cost": round(total_cost, 4),
        "max_latency": round(max_latency, 1),
        "timestamp": now_ts(),
    }
    return results

# ============ CLI ============

def cmd_r1(args):
    with open(args.input) as f:
        data = json.load(f)
    topic = data["topic"]

    full_input_path = data.get("full_input_path")
    if full_input_path and os.path.isfile(full_input_path):
        with open(full_input_path, encoding="utf-8") as fi:
            full_input = fi.read().strip()
        safe_print(f"[R1] Injected full_input from {full_input_path} ({len(full_input)} chars)")
        user_content = CONTEXT_PREFIX + full_input
    else:
        if full_input_path:
            safe_print(f"[R1] WARNING: full_input_path not found: {full_input_path}, falling back to topic")
        user_content = CONTEXT_PREFIX + topic

    agents = DEFAULT_AGENTS
    safe_print(f"[R1] Starting parallel calls for {len(agents)} agents: {agents}")
    safe_print(f"[R1] Topic: {topic[:100]}...")
    results = run_parallel(agents, user_content)

    with open(args.output, 'w') as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    safe_print(f"[R1] Results saved to {args.output}")
    safe_print(f"[R1] Total cost: ${results['metadata']['total_cost']:.4f}")
    safe_print(f"[R1] Max latency: {results['metadata']['max_latency']}s")

    for name in agents:
        r = results[name]
        status = "OK" if r["content"] and not r["error"] else f"FAIL: {r['error']}"
        safe_print(f"  {name}: {status} | {len(r['content'])} chars | ${r['cost']:.4f}")

def cmd_r2(args):
    with open(args.input) as f:
        data = json.load(f)

    agents = [a for a in DEFAULT_AGENTS if a in data.get("directives", {})]
    safe_print(f"[R2] Starting parallel Steelman calls for {len(agents)} agents: {agents}")
    results = run_parallel(agents, None, r2_data=data)

    with open(args.output, 'w') as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    safe_print(f"[R2] Results saved to {args.output}")
    safe_print(f"[R2] Total cost: ${results['metadata']['total_cost']:.4f}")

    for name in agents:
        r = results[name]
        status = "OK" if r["content"] and not r["error"] else f"FAIL: {r['error']}"
        safe_print(f"  {name}: {status} | {len(r['content'])} chars | ${r['cost']:.4f}")

def cmd_test(args):
    name = args.agent
    topic = args.topic
    if name not in AGENT_CALLERS:
        print(f"Unknown agent: {name}. Available: {list(AGENT_CALLERS.keys())}")
        sys.exit(1)

    user_content = CONTEXT_PREFIX + topic
    caller_fn, system_prompt = AGENT_CALLERS[name]

    safe_print(f"[Test] Calling {name} with topic: {topic}")
    result = caller_fn(system_prompt, user_content)

    if result["error"]:
        safe_print(f"[Test] FAILED: {result['error']}")
        sys.exit(1)

    safe_print(f"[Test] SUCCESS | {len(result['content'])} chars | ${result['cost']:.4f} | {result['latency']}s")
    safe_print(f"\n--- Content Preview (first 500 chars) ---")
    safe_print(result["content"][:500])

def cmd_assemble(args):
    """Assemble markdown reading doc."""
    with open(args.input) as f:
        data = json.load(f)

    topic = data["topic"]
    market_baseline = data.get("market_baseline", "")
    r1_content = data.get("r1_translated", {})
    supervisor_factcheck = data.get("supervisor_factcheck", "")
    r2_content = data.get("r2_translated", {})
    decision_brief = data.get("decision_brief", "")

    ts = now_ts()

    sections = []
    sections.append(f"# GroupThink: {topic}")
    sections.append(f"> {ts} | Multi-Model Arena | 2 Rounds")
    sections.append("---")
    sections.append("## Market Baseline")
    sections.append(market_baseline)
    sections.append("---")

    agent_labels = [
        ("claude", "Analyst A (Claude)"),
        ("gemini", "Analyst B (Gemini)"),
        ("grok", "Analyst C (Grok)"),
        ("openai", "Analyst D (GPT)"),
    ]

    sections.append("## Round 1 — Independent Analysis")
    for agent_key, label in agent_labels:
        sections.append(f"### {label}")
        sections.append(r1_content.get(agent_key, "*No data*"))
    sections.append("---")

    sections.append("## Supervisor — Fact-Check & Divergence Map")
    sections.append(supervisor_factcheck)
    sections.append("---")

    sections.append("## Round 2 — Steelman Response")
    for agent_key, label in agent_labels:
        sections.append(f"### {label} — R2")
        sections.append(r2_content.get(agent_key, "*No data*"))
    sections.append("---")

    sections.append("## Decision Brief")
    sections.append(decision_brief)
    sections.append("---")

    sections.append("## Metadata")
    sections.append(f"- Generated: {ts}")

    md = "\n\n".join(sections)
    output_path = args.output
    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    with open(output_path, 'w') as f:
        f.write(md)
    safe_print(f"[Assemble] Written {len(md)} chars to {output_path}")

def main():
    parser = argparse.ArgumentParser(description="GroupThink Arena Engine")
    subparsers = parser.add_subparsers(dest="command")

    p_r1 = subparsers.add_parser("r1", help="Run Round 1 parallel analysis")
    p_r1.add_argument("--input", required=True)
    p_r1.add_argument("--output", required=True)

    p_r2 = subparsers.add_parser("r2", help="Run Round 2 steelman")
    p_r2.add_argument("--input", required=True)
    p_r2.add_argument("--output", required=True)

    p_test = subparsers.add_parser("test", help="Test single agent")
    p_test.add_argument("--agent", required=True, choices=["gemini", "grok", "openai"])
    p_test.add_argument("--topic", required=True)

    p_assemble = subparsers.add_parser("assemble", help="Assemble reading doc")
    p_assemble.add_argument("--input", required=True)
    p_assemble.add_argument("--output", required=True)

    args = parser.parse_args()
    if not args.command:
        parser.print_help()
        sys.exit(1)

    cmds = {
        "r1": cmd_r1, "r2": cmd_r2, "test": cmd_test,
        "assemble": cmd_assemble,
    }
    cmds[args.command](args)

if __name__ == "__main__":
    main()
