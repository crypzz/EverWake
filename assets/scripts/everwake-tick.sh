#!/usr/bin/env bash
# GC exec wrapper — exits immediately, sim runs detached in background

CITY="${GC_CITY_PATH:-${GC_CITY:-/Users/kpkp/everwake}}"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

if [ -f "$CITY/.env" ]; then
  set -a; source "$CITY/.env"; set +a
fi

LOG="$CITY/logs/tick-$(date +%s).log"
mkdir -p "$CITY/logs"

# Run sim fully detached — controller sees exit 0 immediately
nohup bash "$CITY/assets/scripts/everwake-run.sh" > "$LOG" 2>&1 &

echo "=== everwake tick dispatched (pid $!) — log: $LOG ==="
