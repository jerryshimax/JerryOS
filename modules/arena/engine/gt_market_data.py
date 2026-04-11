#!/usr/bin/env python3
"""
GroupThink Arena — Market data fetcher.

Subcommands:
    prices      — Fetch current prices via yfinance
    predictions — Query Polymarket Gamma API for prediction market contracts
    options     — Fetch ATM IV, put-call ratio via yfinance
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone


def cmd_prices(args):
    """Fetch current prices for a dict of {label: ticker}."""
    import yfinance as yf

    tickers: dict[str, str] = json.loads(args.tickers)
    lines = [f"=== MARKET BASELINE ({datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}) ===\n"]

    for label, symbol in tickers.items():
        try:
            tk = yf.Ticker(symbol)
            hist = tk.history(period="2d")
            if hist.empty:
                lines.append(f"- {label} ({symbol}): NO DATA")
                continue
            close_series = hist["Close"].dropna()
            price = float(close_series.iloc[-1])
            prev = float(close_series.iloc[-2]) if len(close_series) >= 2 else price
            chg = ((price - prev) / prev) * 100
            sign = "+" if chg >= 0 else ""
            lines.append(f"- {label} ({symbol}): {price:.2f} ({sign}{chg:.2f}%)")
        except Exception as e:
            lines.append(f"- {label} ({symbol}): ERROR — {e}")

    output = "\n".join(lines)
    with open(args.output, "w") as f:
        f.write(output)
    print(output)


def cmd_predictions(args):
    """Query Polymarket Gamma API for prediction market contracts."""
    import urllib.request
    import urllib.parse

    queries: list[str] = json.loads(args.queries)
    lines = [f"=== PREDICTION MARKET DATA ({datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}) ===\n"]

    for query in queries:
        lines.append(f"### Query: {query}\n")
        try:
            params = urllib.parse.urlencode({
                "limit": 5,
                "active": "true",
                "closed": "false",
                "query": query,
            })
            url = f"https://gamma-api.polymarket.com/events?{params}"
            req = urllib.request.Request(url, headers={"Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=15) as resp:
                events = json.loads(resp.read().decode())

            if not events:
                lines.append("No matching contracts found.\n")
                continue

            for event in events[:3]:
                title = event.get("title", "Unknown")
                lines.append(f"**{title}**")
                for market in event.get("markets", [])[:5]:
                    q = market.get("question", market.get("groupItemTitle", "?"))
                    price = market.get("outcomePrices")
                    if price:
                        try:
                            prices = json.loads(price)
                            yes_pct = float(prices[0]) * 100
                            lines.append(f"  - {q}: YES {yes_pct:.1f}%")
                        except (json.JSONDecodeError, IndexError, ValueError):
                            lines.append(f"  - {q}: {price}")
                    else:
                        lines.append(f"  - {q}: no price data")
                lines.append("")
        except Exception as e:
            lines.append(f"Error querying '{query}': {e}\n")

    output = "\n".join(lines)
    with open(args.output, "w") as f:
        f.write(output)
    print(output)


def cmd_options(args):
    """Fetch ATM implied volatility and put-call ratio via yfinance."""
    import yfinance as yf

    symbols: list[str] = json.loads(args.tickers)
    lines = [f"=== OPTIONS & POSITIONING DATA ({datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}) ===\n"]

    for symbol in symbols:
        lines.append(f"### {symbol}\n")
        try:
            tk = yf.Ticker(symbol)
            price = tk.fast_info.get("lastPrice") or tk.fast_info.get("previousClose", 0)
            expirations = tk.options
            if not expirations:
                lines.append("No options data available.\n")
                continue

            # Use nearest expiration
            exp = expirations[0]
            chain = tk.option_chain(exp)
            calls = chain.calls
            puts = chain.puts

            # ATM strike (closest to current price)
            if len(calls) > 0:
                atm_idx = (calls["strike"] - price).abs().idxmin()
                atm_call = calls.loc[atm_idx]
                atm_iv_call = atm_call.get("impliedVolatility", 0) * 100

                atm_idx_p = (puts["strike"] - price).abs().idxmin()
                atm_put = puts.loc[atm_idx_p]
                atm_iv_put = atm_put.get("impliedVolatility", 0) * 100

                lines.append(f"- Current Price: {price:.2f}")
                lines.append(f"- Nearest Expiry: {exp}")
                lines.append(f"- ATM Call IV: {atm_iv_call:.1f}%")
                lines.append(f"- ATM Put IV: {atm_iv_put:.1f}%")
                lines.append(f"- IV Skew (Put-Call): {atm_iv_put - atm_iv_call:+.1f}%")

                # Put-call volume ratio
                total_call_vol = calls["volume"].sum()
                total_put_vol = puts["volume"].sum()
                if total_call_vol and total_call_vol > 0:
                    pc_ratio = total_put_vol / total_call_vol
                    lines.append(f"- Put/Call Volume Ratio: {pc_ratio:.2f}")
                    lines.append(f"  - Total Call Volume: {int(total_call_vol):,}")
                    lines.append(f"  - Total Put Volume: {int(total_put_vol):,}")

                # Put-call OI ratio
                total_call_oi = calls["openInterest"].sum()
                total_put_oi = puts["openInterest"].sum()
                if total_call_oi and total_call_oi > 0:
                    pc_oi = total_put_oi / total_call_oi
                    lines.append(f"- Put/Call OI Ratio: {pc_oi:.2f}")
            else:
                lines.append("No call data available.\n")
        except Exception as e:
            lines.append(f"Error: {e}\n")
        lines.append("")

    output = "\n".join(lines)
    with open(args.output, "w") as f:
        f.write(output)
    print(output)


def main():
    parser = argparse.ArgumentParser(description="GroupThink Market Data")
    subparsers = parser.add_subparsers(dest="command")

    p_prices = subparsers.add_parser("prices", help="Fetch current prices")
    p_prices.add_argument("--tickers", required=True, help='JSON dict: {"label": "TICKER"}')
    p_prices.add_argument("--output", required=True)

    p_pred = subparsers.add_parser("predictions", help="Query prediction markets")
    p_pred.add_argument("--queries", required=True, help='JSON list: ["keyword1", ...]')
    p_pred.add_argument("--output", required=True)

    p_opts = subparsers.add_parser("options", help="Fetch options data")
    p_opts.add_argument("--tickers", required=True, help='JSON list: ["SPY", ...]')
    p_opts.add_argument("--output", required=True)

    args = parser.parse_args()
    if not args.command:
        parser.print_help()
        sys.exit(1)

    {"prices": cmd_prices, "predictions": cmd_predictions, "options": cmd_options}[args.command](args)


if __name__ == "__main__":
    main()
