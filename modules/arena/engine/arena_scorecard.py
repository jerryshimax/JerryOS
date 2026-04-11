#!/usr/bin/env python3
"""
GroupThink Arena — Scorecard CLI.

SQLite-backed prediction tracker with auto-scoring via yfinance.
DB at ~/scripts/arena/arena_scorecard.db

Usage:
    arena_scorecard.py --add "prediction" --prob 0.7 --check-date 2026-04-15 ...
    arena_scorecard.py --add-agent RUN_ID AGENT SCENARIO --r1-prob 0.6 ...
    arena_scorecard.py --check
    arena_scorecard.py --auto-score
    arena_scorecard.py --score ID OUTCOME [--notes "..."]
    arena_scorecard.py --supersede ID [--notes "..."]
    arena_scorecard.py --pending
    arena_scorecard.py --summary
    arena_scorecard.py --report
    arena_scorecard.py --daily-brief
    arena_scorecard.py --write-active /path/to/output/
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
from datetime import datetime, date, timezone

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'arena_scorecard.db')

# ============ DB Setup ============

def get_db():
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("""
        CREATE TABLE IF NOT EXISTS predictions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id TEXT NOT NULL,
            prediction TEXT NOT NULL,
            probability REAL,
            confidence TEXT,
            falsification TEXT,
            check_date TEXT,
            asset TEXT,
            direction TEXT,
            target_price REAL,
            prediction_type TEXT DEFAULT 'event',
            outcome TEXT,
            scored_at TEXT,
            notes TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        )
    """)
    db.execute("""
        CREATE TABLE IF NOT EXISTS agent_scenarios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id TEXT NOT NULL,
            agent TEXT NOT NULL,
            scenario TEXT NOT NULL,
            r1_prob REAL,
            r2_prob REAL,
            sup_prob REAL
        )
    """)
    db.commit()
    return db


# ============ Add prediction ============

def cmd_add(args):
    db = get_db()
    db.execute("""
        INSERT INTO predictions (run_id, prediction, probability, confidence,
                                 falsification, check_date, asset, direction,
                                 target_price, prediction_type)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (args.run, args.add, args.prob, args.confidence,
          args.falsification, args.check_date, args.asset, args.direction,
          args.target, args.type))
    db.commit()
    pid = db.execute("SELECT last_insert_rowid()").fetchone()[0]
    print(f"Added prediction #{pid}: {args.add}")


def cmd_add_agent(args):
    db = get_db()
    db.execute("""
        INSERT INTO agent_scenarios (run_id, agent, scenario, r1_prob, r2_prob, sup_prob)
        VALUES (?, ?, ?, ?, ?, ?)
    """, (args.add_agent[0], args.add_agent[1], args.add_agent[2],
          args.r1_prob, args.r2_prob, args.sup_prob))
    db.commit()
    print(f"Added agent scenario: {args.add_agent[1]} / {args.add_agent[2]}")


# ============ Check & Auto-score ============

def cmd_check(args):
    db = get_db()
    today = date.today().isoformat()
    rows = db.execute("""
        SELECT id, run_id, prediction, probability, check_date, asset, prediction_type
        FROM predictions
        WHERE outcome IS NULL AND check_date <= ?
        ORDER BY check_date
    """, (today,)).fetchall()
    if not rows:
        print("No predictions due for checking.")
        return
    print(f"=== {len(rows)} prediction(s) due for check ===\n")
    for r in rows:
        ptype = r["prediction_type"] or "event"
        print(f"  #{r['id']} [{ptype}] {r['prediction']}")
        print(f"    Prob: {r['probability']}  Due: {r['check_date']}  Asset: {r['asset'] or 'N/A'}")


def cmd_auto_score(args):
    import yfinance as yf

    db = get_db()
    today = date.today().isoformat()
    rows = db.execute("""
        SELECT id, prediction, asset, direction, target_price, prediction_type,
               check_date, run_id
        FROM predictions
        WHERE outcome IS NULL AND check_date <= ?
          AND prediction_type LIKE 'price%' AND asset IS NOT NULL
        ORDER BY check_date
    """, (today,)).fetchall()

    if not rows:
        print("No price-type predictions ready for auto-scoring.")
        return

    scored = 0
    for r in rows:
        try:
            tk = yf.Ticker(r["asset"])
            ptype = r["prediction_type"]
            target = r["target_price"]
            direction = r["direction"]

            # Fetch history from run date through check date
            run_date = r["run_id"].split("_")[0] if "_" in r["run_id"] else r["check_date"]
            hist = tk.history(start=run_date, end=r["check_date"])
            if hist.empty:
                print(f"  #{r['id']}: No price data for {r['asset']}")
                continue

            outcome = _score_prediction(ptype, direction, target, hist)
            if outcome:
                db.execute("UPDATE predictions SET outcome=?, scored_at=?, notes=? WHERE id=?",
                           (outcome, datetime.now(timezone.utc).isoformat(),
                            f"Auto-scored. Last close: {hist['Close'].iloc[-1]:.2f}", r["id"]))
                scored += 1
                print(f"  #{r['id']}: {outcome} ({r['asset']} last={hist['Close'].iloc[-1]:.2f} vs target={target})")
        except Exception as e:
            print(f"  #{r['id']}: Error — {e}")

    db.commit()
    print(f"\nAuto-scored {scored}/{len(rows)} predictions.")


def _score_prediction(ptype, direction, target, hist):
    """Score a price prediction against historical data."""
    if ptype == "price":
        last = hist["Close"].iloc[-1]
        if direction == "above":
            return "correct" if last >= target else "wrong"
        else:
            return "correct" if last <= target else "wrong"
    elif ptype == "price_range":
        # target_price encodes midpoint; need custom handling
        return None
    elif ptype == "price_floor":
        low = hist["Low"].min()
        return "correct" if low >= target else "wrong"
    elif ptype == "price_ceiling":
        high = hist["High"].max()
        return "correct" if high <= target else "wrong"
    elif ptype == "price_avg":
        avg = hist["Close"].mean()
        if direction == "above":
            return "correct" if avg >= target else "wrong"
        else:
            return "correct" if avg <= target else "wrong"
    elif ptype == "price_change":
        first = hist["Close"].iloc[0]
        last = hist["Close"].iloc[-1]
        pct_chg = ((last - first) / first) * 100
        if direction == "above":
            return "correct" if pct_chg >= target else "wrong"
        else:
            return "correct" if pct_chg <= target else "wrong"
    return None


# ============ Manual score & supersede ============

def cmd_score(args):
    db = get_db()
    pid = args.score[0]
    outcome = args.score[1]
    if outcome not in ("correct", "wrong", "partial", "invalidated"):
        print(f"Invalid outcome: {outcome}. Use: correct/wrong/partial/invalidated")
        sys.exit(1)
    db.execute("UPDATE predictions SET outcome=?, scored_at=?, notes=? WHERE id=?",
               (outcome, datetime.now(timezone.utc).isoformat(), args.notes, int(pid)))
    db.commit()
    print(f"Scored #{pid} as {outcome}")


def cmd_supersede(args):
    db = get_db()
    db.execute("UPDATE predictions SET outcome='superseded', scored_at=?, notes=? WHERE id=?",
               (datetime.now(timezone.utc).isoformat(), args.notes, args.supersede))
    db.commit()
    print(f"Marked #{args.supersede} as superseded")


# ============ Queries ============

def cmd_pending(args):
    db = get_db()
    rows = db.execute("""
        SELECT id, run_id, prediction, probability, confidence, check_date,
               asset, prediction_type
        FROM predictions WHERE outcome IS NULL ORDER BY check_date
    """).fetchall()
    if not rows:
        print("No pending predictions.")
        return
    print(f"=== {len(rows)} Pending Prediction(s) ===\n")
    for r in rows:
        print(f"  #{r['id']} [{r['prediction_type'] or 'event'}] {r['prediction']}")
        print(f"    Run: {r['run_id']}  Prob: {r['probability']}  Due: {r['check_date']}  Asset: {r['asset'] or 'N/A'}")


def cmd_summary(args):
    db = get_db()
    total = db.execute("SELECT COUNT(*) FROM predictions").fetchone()[0]
    scored = db.execute("SELECT COUNT(*) FROM predictions WHERE outcome IS NOT NULL").fetchone()[0]
    pending = total - scored
    correct = db.execute("SELECT COUNT(*) FROM predictions WHERE outcome='correct'").fetchone()[0]
    wrong = db.execute("SELECT COUNT(*) FROM predictions WHERE outcome='wrong'").fetchone()[0]

    print(f"=== Scorecard Summary ===")
    print(f"  Total: {total}  Scored: {scored}  Pending: {pending}")
    if correct + wrong > 0:
        print(f"  Correct: {correct}  Wrong: {wrong}  Accuracy: {correct/(correct+wrong)*100:.1f}%")

    runs = db.execute("SELECT DISTINCT run_id FROM predictions ORDER BY run_id DESC LIMIT 5").fetchall()
    if runs:
        print(f"\n  Recent runs: {', '.join(r['run_id'] for r in runs)}")


def cmd_report(args):
    db = get_db()
    rows = db.execute("""
        SELECT probability, outcome FROM predictions
        WHERE outcome IN ('correct', 'wrong')
    """).fetchall()
    if not rows:
        print("No scored predictions for report.")
        return

    # Bucket accuracy
    buckets = {f"{lo}-{lo+20}%": {"total": 0, "correct": 0}
               for lo in range(0, 100, 20)}
    brier_sum = 0.0
    n = 0
    for r in rows:
        prob = r["probability"] or 0.5
        actual = 1.0 if r["outcome"] == "correct" else 0.0
        brier_sum += (prob - actual) ** 2
        n += 1

        pct = int(prob * 100)
        for lo in range(0, 100, 20):
            if lo <= pct < lo + 20:
                key = f"{lo}-{lo+20}%"
                buckets[key]["total"] += 1
                if r["outcome"] == "correct":
                    buckets[key]["correct"] += 1
                break

    print("=== Calibration Report ===\n")
    print("Bucket Accuracy:")
    for bkt, vals in buckets.items():
        if vals["total"] > 0:
            acc = vals["correct"] / vals["total"] * 100
            print(f"  {bkt}: {vals['correct']}/{vals['total']} ({acc:.0f}%)")

    brier = brier_sum / n if n > 0 else 0
    print(f"\nBrier Score: {brier:.4f} (lower = better, 0.25 = random)")
    print(f"Total scored: {n}")

    # Per-agent analysis
    agent_rows = db.execute("""
        SELECT a.agent, a.r1_prob, a.r2_prob, a.sup_prob, a.scenario, a.run_id
        FROM agent_scenarios a
        ORDER BY a.run_id DESC
    """).fetchall()
    if agent_rows:
        print("\n=== Agent Scenario Tracking ===")
        for r in agent_rows:
            drift = (r["r2_prob"] or 0) - (r["r1_prob"] or 0)
            print(f"  {r['agent']}: {r['scenario']} R1={r['r1_prob']} R2={r['r2_prob']} "
                  f"Sup={r['sup_prob']} Drift={drift:+.2f}")


def cmd_daily_brief(args):
    db = get_db()
    today = date.today().isoformat()

    pending = db.execute("""
        SELECT id, prediction, probability, check_date, asset, prediction_type
        FROM predictions WHERE outcome IS NULL ORDER BY check_date
    """).fetchall()

    due = [dict(r) for r in pending if r["check_date"] and r["check_date"] <= today]
    upcoming = [dict(r) for r in pending if r["check_date"] and r["check_date"] > today][:5]

    brief = {
        "date": today,
        "due_for_scoring": due,
        "upcoming": upcoming,
        "total_pending": len(pending),
    }
    print(json.dumps(brief, indent=2, default=str))


def cmd_write_active(args):
    db = get_db()
    rows = db.execute("""
        SELECT id, run_id, prediction, probability, confidence, check_date,
               asset, direction, target_price, prediction_type
        FROM predictions WHERE outcome IS NULL ORDER BY check_date
    """).fetchall()

    lines = [f"# Active Arena Predictions ({date.today().isoformat()})\n"]
    for r in rows:
        lines.append(f"- **#{r['id']}** [{r['prediction_type']}] {r['prediction']}")
        lines.append(f"  - Prob: {r['probability']}  Confidence: {r['confidence']}  Due: {r['check_date']}")
        if r['asset']:
            lines.append(f"  - Asset: {r['asset']} {r['direction']} {r['target_price']}")
    lines.append("")

    outdir = args.write_active
    os.makedirs(outdir, exist_ok=True)
    outpath = os.path.join(outdir, "arena_active_predictions.md")
    with open(outpath, "w") as f:
        f.write("\n".join(lines))
    print(f"Written {len(rows)} predictions to {outpath}")


# ============ Batch import from JSON ============

def cmd_import_json(json_path):
    """Import predictions from /tmp/gt_scorecard_data.json."""
    with open(json_path) as f:
        data = json.load(f)

    db = get_db()
    run_id = data["run_id"]
    added = 0

    for p in data.get("predictions", []):
        db.execute("""
            INSERT INTO predictions (run_id, prediction, probability, confidence,
                                     falsification, check_date, asset, direction,
                                     target_price, prediction_type)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (run_id, p["text"], p.get("probability"), p.get("confidence"),
              p.get("falsification"), p.get("check_date"),
              p.get("asset"), p.get("direction"), p.get("target_price"),
              p.get("type", "event")))
        added += 1

    for a in data.get("agent_scenarios", []):
        db.execute("""
            INSERT INTO agent_scenarios (run_id, agent, scenario, r1_prob, r2_prob, sup_prob)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (run_id, a["agent"], a["scenario"],
              a.get("r1_prob"), a.get("r2_prob"), a.get("sup_prob")))

    db.commit()
    print(f"Imported {added} predictions + {len(data.get('agent_scenarios', []))} agent scenarios for {run_id}")


# ============ Main ============

def main():
    parser = argparse.ArgumentParser(description="GroupThink Arena Scorecard")

    parser.add_argument("--add", help="Add prediction text")
    parser.add_argument("--prob", type=float)
    parser.add_argument("--confidence", default="medium")
    parser.add_argument("--falsification")
    parser.add_argument("--check-date")
    parser.add_argument("--asset")
    parser.add_argument("--direction")
    parser.add_argument("--target", type=float)
    parser.add_argument("--type", default="event")
    parser.add_argument("--run", default="manual")

    parser.add_argument("--add-agent", nargs=3, metavar=("RUN_ID", "AGENT", "SCENARIO"))
    parser.add_argument("--r1-prob", type=float)
    parser.add_argument("--r2-prob", type=float)
    parser.add_argument("--sup-prob", type=float)

    parser.add_argument("--check", action="store_true")
    parser.add_argument("--auto-score", action="store_true")

    parser.add_argument("--score", nargs=2, metavar=("ID", "OUTCOME"))
    parser.add_argument("--supersede", type=int)
    parser.add_argument("--notes")

    parser.add_argument("--pending", action="store_true")
    parser.add_argument("--summary", action="store_true")
    parser.add_argument("--report", action="store_true")
    parser.add_argument("--daily-brief", action="store_true")
    parser.add_argument("--write-active", metavar="DIR")
    parser.add_argument("--import-json", metavar="PATH")

    args = parser.parse_args()

    if args.add:
        cmd_add(args)
    elif args.add_agent:
        cmd_add_agent(args)
    elif args.check:
        cmd_check(args)
    elif args.auto_score:
        cmd_auto_score(args)
    elif args.score:
        cmd_score(args)
    elif args.supersede is not None:
        cmd_supersede(args)
    elif args.pending:
        cmd_pending(args)
    elif args.summary:
        cmd_summary(args)
    elif args.report:
        cmd_report(args)
    elif args.daily_brief:
        cmd_daily_brief(args)
    elif args.write_active:
        cmd_write_active(args)
    elif args.import_json:
        cmd_import_json(args.import_json)
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
