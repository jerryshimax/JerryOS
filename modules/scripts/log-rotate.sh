#!/usr/bin/env bash
# log-rotate.sh — Truncate log files over 5MB
# Run daily via cron or LaunchAgent

LOG_DIR="${SHIP_PATH:-$HOME/Ship}/logs"
MAX_SIZE=5242880  # 5MB in bytes

if [[ ! -d "$LOG_DIR" ]]; then
  echo "Log directory not found: $LOG_DIR"
  exit 0
fi

find "$LOG_DIR" -name "*.log" -size +${MAX_SIZE}c | while read -r logfile; do
  echo "Rotating: $logfile ($(du -h "$logfile" | cut -f1))"
  tail -c "$MAX_SIZE" "$logfile" > "${logfile}.tmp"
  mv "${logfile}.tmp" "$logfile"
done
