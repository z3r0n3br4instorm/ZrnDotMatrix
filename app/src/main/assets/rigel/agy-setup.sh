#!/data/data/com.termux/files/usr/bin/bash
# =====================================================================
# Antigravity sign-in — runs in a VISIBLE Termux session.
#
# The CLI has no `login` subcommand: launching `agy` bare starts a
# browser-based Google Sign-In and stores the token in the system keyring.
# So this script only sets the scene and hands the terminal over.
# =====================================================================
set -u

RIGEL_HOME="$HOME/.rigel"
CONF="$RIGEL_HOME/config.json"
mkdir -p "$RIGEL_HOME"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
dim()  { printf '\033[2m%s\033[0m\n' "$*"; }
ok()   { printf '\033[32m  ok\033[0m  %s\n' "$*"; }
warn() { printf '\033[33m  !!\033[0m  %s\n' "$*"; }

BIN=""
for c in agy antigravity; do
  command -v "$c" >/dev/null 2>&1 && { BIN="$c"; break; }
done

clear 2>/dev/null || true
bold "  ZERONE // ANTIGRAVITY SIGN-IN"
dim   "  ---------------------------------------"
echo

if [ -z "$BIN" ]; then
  warn "no agy binary found"
  dim  "  run SETUP again from the RIGEL screen"
  echo
  printf '  press Enter to close '
  read -r _ </dev/tty
  exit 1
fi

ok "found $BIN"
echo
bold "  WHAT HAPPENS NEXT"
echo
dim  "   1. $BIN starts and opens a Google sign-in"
dim  "      in your browser"
dim  "   2. finish the sign-in"
printf '\033[1m   3. type \033[33m/exit\033[0m\033[1m to leave the CLI\033[0m\n'
dim  "   4. swipe back to the launcher"
echo
dim  "  ---------------------------------------"
echo
printf '  press Enter to start %s ' "$BIN"
read -r _ </dev/tty
echo

# Hand the terminal over. No arguments: a bare launch is what triggers the
# sign-in flow, and the CLI is interactive from here.
"$BIN"

# Back from the CLI. Record the backend only now, and only if the binary is
# genuinely present — the UI reads this and must not claim a backend twice.
echo
if command -v "$BIN" >/dev/null 2>&1; then
  if [ -f "$CONF" ]; then
    sed -i 's/"backend":[[:space:]]*"[^"]*"/"backend": "agy"/' "$CONF" 2>/dev/null
  else
    cat > "$CONF" <<EOF
{
  "provider": "google",
  "backend": "agy",
  "created": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
    chmod 600 "$CONF"
  fi
  ok "RIGEL will route turns through $BIN"
fi

dim "  ---------------------------------------"
bold "  SIGN-IN STEP COMPLETE"
dim  "  swipe back to the launcher and hit RE-CHECK"
echo
printf '  press Enter to close '
read -r _ </dev/tty
exit 0
