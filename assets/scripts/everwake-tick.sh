#!/usr/bin/env bash
set -uo pipefail

CITY="${GC_CITY_PATH:-${GC_CITY:-/Users/kpkp/everwake}}"

# Ensure homebrew binaries are in PATH for controller-spawned processes
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

echo "=== everwake tick starting ==="

# Load secrets from project .env if not already in environment
if [ -f "$CITY/.env" ]; then
  set -a; source "$CITY/.env"; set +a
fi

# Run the simulation, capture output
if OUTPUT=$(cd "$CITY" && npm run dev 2>&1); then
  EXIT_CODE=0
else
  EXIT_CODE=$?
fi

echo "$OUTPUT"

if [ "$EXIT_CODE" -ne 0 ]; then
  gc event emit everwake.tick.failed \
    --actor "everwake" \
    --message "Simulation tick failed (exit $EXIT_CODE)" 2>/dev/null || true

  gc mail send mayor/ \
    --from "everwake" \
    -s "Everwake tick FAILED (exit $EXIT_CODE)" \
    -m "$(printf '%s' "$OUTPUT" | tail -30)" 2>/dev/null || true

  exit "$EXIT_CODE"
fi

# Extract state summary from the after-tick section
SUMMARY=$(printf '%s' "$OUTPUT" | awk '/AFTER TICK/,0' | head -60)

gc event emit everwake.tick \
  --actor "everwake" \
  --message "Simulation tick complete" \
  --payload "$(printf '%s' "$SUMMARY" | jq -Rs '{summary: .}' 2>/dev/null || echo '{}')" 2>/dev/null || true

gc mail send mayor/ \
  --from "everwake" \
  -s "Everwake tick complete" \
  -m "$SUMMARY" \
  --notify 2>/dev/null || true

# Auto-commit and push citizen state to GitHub
if [ -n "${GITHUB_TOKEN:-}" ]; then
  cd "$CITY"
  TICK=$(jq -r '.tick' world/tick.json 2>/dev/null || echo "?")
  git add citizens/ world/tick.json 2>/dev/null || true
  if ! git diff --cached --quiet 2>/dev/null; then
    git commit -m "tick $TICK — auto" \
      --author="everwake <everwake@gastown.local>" 2>/dev/null || true
    git push "https://${GITHUB_TOKEN}@github.com/crypzz/EverWake.git" main 2>/dev/null || true
    echo "=== pushed tick $TICK to github ==="
  fi
fi

echo "=== everwake tick done ==="
