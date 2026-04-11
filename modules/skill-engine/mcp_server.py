#!/usr/bin/env python3
"""Skill Engine MCP Server — exposes skill search, learning, and usage tracking.

Zero-dependency JSON-RPC 2.0 over stdio, compatible with the MCP protocol.
Tools: skill_search, skill_show, skill_learn, skill_record, skill_list, skill_stats
"""

import json
import sys
import traceback
from pathlib import Path

# Add skill-engine directory to path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from config import DB_PATH, LEARNED_DIR
from engine import learn_from_session, use_skill
from index import get_connection, search_skills, get_skill, list_skills, get_stats


# --- MCP Protocol Helpers ---

def send_response(id, result):
    msg = {"jsonrpc": "2.0", "id": id, "result": result}
    out = json.dumps(msg)
    sys.stdout.write(f"Content-Length: {len(out.encode())}\r\n\r\n{out}")
    sys.stdout.flush()


def send_error(id, code, message):
    msg = {"jsonrpc": "2.0", "id": id, "error": {"code": code, "message": message}}
    out = json.dumps(msg)
    sys.stdout.write(f"Content-Length: {len(out.encode())}\r\n\r\n{out}")
    sys.stdout.flush()


def send_notification(method, params=None):
    msg = {"jsonrpc": "2.0", "method": method}
    if params:
        msg["params"] = params
    out = json.dumps(msg)
    sys.stdout.write(f"Content-Length: {len(out.encode())}\r\n\r\n{out}")
    sys.stdout.flush()


def read_message():
    """Read a JSON-RPC message from stdin (Content-Length framing)."""
    headers = {}
    while True:
        line = sys.stdin.readline()
        if not line:
            return None
        line = line.strip()
        if not line:
            break
        if ":" in line:
            key, _, val = line.partition(":")
            headers[key.strip().lower()] = val.strip()

    length = int(headers.get("content-length", 0))
    if length == 0:
        return None

    body = sys.stdin.read(length)
    return json.loads(body)


# --- Tool Definitions ---

TOOLS = [
    {
        "name": "skill_search",
        "description": "Full-text search across all learned skills. Returns matching skills ranked by relevance.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Search query — keywords or natural language"},
                "limit": {"type": "number", "description": "Max results (default 10)", "default": 10},
            },
            "required": ["query"],
        },
    },
    {
        "name": "skill_show",
        "description": "Show full details for a learned skill by ID, including its SKILL.md content.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "skill_id": {"type": "string", "description": "Skill ID to look up"},
            },
            "required": ["skill_id"],
        },
    },
    {
        "name": "skill_learn",
        "description": "Learn a new skill from a completed task. Provide the LLM-analyzed fields: name, description, trigger_conditions, procedure. The engine handles storage, indexing, and dedup.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "task": {"type": "string", "description": "What was asked"},
                "success": {"type": "boolean", "description": "Whether the task succeeded"},
                "name": {"type": "string", "description": "Suggested skill name"},
                "description": {"type": "string", "description": "One-line description"},
                "trigger_conditions": {"type": "string", "description": "When to use this skill"},
                "procedure": {"type": "string", "description": "Step-by-step approach that worked"},
                "references": {"type": "string", "description": "Files, tools, or patterns used"},
                "tags": {"type": "array", "items": {"type": "string"}, "description": "Relevant tags"},
                "confidence": {"type": "number", "description": "Initial confidence 0.0-1.0 (default 0.5)"},
            },
            "required": ["task", "success", "name", "description", "trigger_conditions", "procedure"],
        },
    },
    {
        "name": "skill_record",
        "description": "Record that a skill was used and whether it succeeded. Updates confidence score.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "skill_id": {"type": "string", "description": "Skill ID"},
                "success": {"type": "boolean", "description": "Whether the skill led to success (default true)"},
            },
            "required": ["skill_id"],
        },
    },
    {
        "name": "skill_list",
        "description": "List all learned skills, sorted by confidence, usage, or creation date.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "sort": {
                    "type": "string",
                    "description": "Sort order: confidence, used, created, name (default: confidence DESC)",
                    "enum": ["confidence", "used", "created", "name"],
                },
                "limit": {"type": "number", "description": "Max results (default 20)", "default": 20},
            },
        },
    },
    {
        "name": "skill_stats",
        "description": "Aggregate statistics about the learned skill library: totals, confidence distribution, usage.",
        "inputSchema": {"type": "object", "properties": {}},
    },
]

SORT_MAP = {
    "confidence": "confidence DESC",
    "used": "times_used DESC",
    "created": "created DESC",
    "name": "name ASC",
}


# --- Tool Handlers ---

def handle_skill_search(args):
    query = args["query"]
    limit = args.get("limit", 10)
    conn = get_connection()
    try:
        results = search_skills(conn, query, limit=limit)
        if not results:
            return f'No skills match "{query}".'
        lines = []
        for r in results:
            tags = json.loads(r.get("tags", "[]")) if isinstance(r.get("tags"), str) else r.get("tags", [])
            lines.append(
                f"- **{r['name']}** (id: {r['id']}, confidence: {r['confidence']:.2f}, used: {r['times_used']}x)\n"
                f"  {r['description']}\n"
                f"  Tags: {', '.join(tags) if tags else 'none'}"
            )
        return f'{len(results)} result(s) for "{query}":\n\n' + "\n\n".join(lines)
    finally:
        conn.close()


def handle_skill_show(args):
    skill_id = args["skill_id"]
    conn = get_connection()
    try:
        skill = get_skill(conn, skill_id)
        if not skill:
            return f"Skill not found: {skill_id}"

        lines = [
            f"**{skill['name']}** (id: {skill['id']})",
            f"Description: {skill['description']}",
            f"Confidence: {skill['confidence']:.2f}",
            f"Used: {skill['times_used']}x (succeeded: {skill['times_succeeded']}x)",
            f"Created: {skill['created']}",
            f"Last used: {skill['last_used'] or 'never'}",
            f"File: {skill['file_path']}",
        ]

        # Read the actual .md file if it exists
        fp = Path(skill["file_path"])
        if fp.exists():
            lines.append(f"\n---\n{fp.read_text(encoding='utf-8')}")

        return "\n".join(lines)
    finally:
        conn.close()


def handle_skill_learn(args):
    result = learn_from_session(args)
    action = result["action"]
    reason = result["reason"]
    skill_id = result.get("skill_id")
    if skill_id:
        return f"Action: {action}\nSkill ID: {skill_id}\n{reason}"
    return f"Action: {action}\n{reason}"


def handle_skill_record(args):
    skill_id = args["skill_id"]
    success = args.get("success", True)
    result = use_skill(skill_id, succeeded=success)
    if not result:
        return f"Skill not found: {skill_id}"
    return (
        f"Recorded {'success' if success else 'failure'} for {result['name']}\n"
        f"Confidence: {result['confidence']:.3f} | Used: {result['times_used']}x"
    )


def handle_skill_list(args):
    sort_key = SORT_MAP.get(args.get("sort", "confidence"), "confidence DESC")
    limit = args.get("limit", 20)
    conn = get_connection()
    try:
        skills = list_skills(conn, order_by=sort_key, limit=limit)
        if not skills:
            return "No learned skills yet."
        lines = []
        for s in skills:
            lines.append(
                f"- {s['name']} (id: {s['id']}, conf: {s['confidence']:.2f}, "
                f"used: {s['times_used']}x, created: {s['created']})"
            )
        return f"{len(skills)} skill(s):\n" + "\n".join(lines)
    finally:
        conn.close()


def handle_skill_stats(args):
    conn = get_connection()
    try:
        stats = get_stats(conn)
        lines = [
            "**Skill Engine Stats**",
            f"Total skills: {stats['total_skills']}",
            f"Avg confidence: {stats['avg_confidence'] or 0:.3f}",
            f"Total uses: {stats['total_uses'] or 0}",
            f"Avg success rate: {(stats['avg_success_rate'] or 0):.1%}",
            f"High confidence (>=0.7): {stats['high_confidence_count']}",
            f"Low confidence (<0.3): {stats['low_confidence_count']}",
        ]
        return "\n".join(lines)
    finally:
        conn.close()


HANDLERS = {
    "skill_search": handle_skill_search,
    "skill_show": handle_skill_show,
    "skill_learn": handle_skill_learn,
    "skill_record": handle_skill_record,
    "skill_list": handle_skill_list,
    "skill_stats": handle_skill_stats,
}


# --- MCP Protocol ---

def handle_initialize(id, params):
    send_response(id, {
        "protocolVersion": "2024-11-05",
        "capabilities": {"tools": {}},
        "serverInfo": {"name": "skill-engine", "version": "1.0.0"},
    })


def handle_tools_list(id, params):
    send_response(id, {"tools": TOOLS})


def handle_tools_call(id, params):
    name = params.get("name", "")
    args = params.get("arguments", {})

    handler = HANDLERS.get(name)
    if not handler:
        send_error(id, -32601, f"Unknown tool: {name}")
        return

    try:
        result_text = handler(args)
        send_response(id, {
            "content": [{"type": "text", "text": result_text}],
        })
    except Exception as e:
        send_response(id, {
            "content": [{"type": "text", "text": f"Error: {e}\n{traceback.format_exc()}"}],
            "isError": True,
        })


def main():
    sys.stderr.write("Skill Engine MCP server starting...\n")

    while True:
        msg = read_message()
        if msg is None:
            break

        method = msg.get("method", "")
        id = msg.get("id")
        params = msg.get("params", {})

        if method == "initialize":
            handle_initialize(id, params)
        elif method == "notifications/initialized":
            pass  # Client acknowledgment, no response needed
        elif method == "tools/list":
            handle_tools_list(id, params)
        elif method == "tools/call":
            handle_tools_call(id, params)
        elif method == "ping":
            send_response(id, {})
        else:
            if id is not None:
                send_error(id, -32601, f"Method not found: {method}")


if __name__ == "__main__":
    main()
