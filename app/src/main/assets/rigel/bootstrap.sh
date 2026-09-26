#!/data/data/com.termux/files/usr/bin/bash
# =====================================================================
# RIGEL bootstrap — key entry only.
#
# This is the ONE step that needs a visible Termux session, because pasting an
# API key needs a tty and a launcher cannot write into Termux's private home.
# It installs no packages: the backend install runs in the background through
# rigel-install so the user never sits watching a terminal.
#
# Idempotent — re-running repairs a half-finished setup.
# =====================================================================
set -u

BACKEND="${1:-agy}"               # agy | opencode
RIGEL_HOME="$HOME/.rigel"
CONF="$RIGEL_HOME/config.json"
BIN="$RIGEL_HOME/bin"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
dim()  { printf '\033[2m%s\033[0m\n' "$*"; }
ok()   { printf '\033[32m  ok\033[0m  %s\n' "$*"; }
err()  { printf '\033[31m  xx\033[0m  %s\n' "$*"; }

mkdir -p "$RIGEL_HOME" "$BIN" "$RIGEL_HOME/out" "$RIGEL_HOME/memory"

clear 2>/dev/null || true
bold "  ZERONE // RIGEL SETUP"
dim   "  ---------------------------------------"
echo
dim   "  backend: $BACKEND (installs in the background after this)"
echo

bold "  model provider"
echo "     1) anthropic     (claude)"
echo "     2) openai        (gpt)"
echo "     3) google        (gemini)"
echo "     4) openrouter    (many)"
echo "     5) ollama        (local, no key)"
echo
printf '  pick 1-5 [1]: '
read -r PICK </dev/tty
case "${PICK:-1}" in
  2) PROVIDER=openai;     ENVVAR=OPENAI_API_KEY;     MODEL=gpt-4o ;;
  3) PROVIDER=google;     ENVVAR=GEMINI_API_KEY;     MODEL=gemini-2.0-flash ;;
  4) PROVIDER=openrouter; ENVVAR=OPENROUTER_API_KEY; MODEL=anthropic/claude-sonnet-5 ;;
  5) PROVIDER=ollama;     ENVVAR=OLLAMA_HOST;        MODEL=llama3.2 ;;
  *) PROVIDER=anthropic;  ENVVAR=ANTHROPIC_API_KEY;  MODEL=claude-sonnet-5 ;;
esac
ok "provider: $PROVIDER"
echo

if [ "$PROVIDER" = "ollama" ]; then
  printf '  ollama host [http://127.0.0.1:11434]: '
  read -r KEY </dev/tty
  KEY="${KEY:-http://127.0.0.1:11434}"
else
  bold "  api key"
  dim  "     long-press the terminal to paste, then Enter"
  printf '  key: '
  # Not hidden on purpose: on a touch keyboard a masked field is how people get
  # locked out of their own setup.
  read -r KEY </dev/tty
fi
[ -n "${KEY:-}" ] || { err "nothing entered - run SETUP again"; printf '  Enter to close '; read -r _ </dev/tty; exit 1; }
echo

printf '  model [%s]: ' "$MODEL"
read -r M </dev/tty
MODEL="${M:-$MODEL}"

esc() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }
cat > "$CONF" <<EOF
{
  "provider": "$(esc "$PROVIDER")",
  "envVar":   "$(esc "$ENVVAR")",
  "key":      "$(esc "$KEY")",
  "model":    "$(esc "$MODEL")",
  "backend":  "$(esc "$BACKEND")",
  "created":  "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
chmod 600 "$CONF"
ok "config written"
dim "  helper scripts are pushed by the launcher"



PROFILE="$HOME/.profile"
grep -q 'rigel/bin' "$PROFILE" 2>/dev/null || echo 'export PATH="$HOME/.rigel/bin:$PATH"' >> "$PROFILE"

[ -f "$RIGEL_HOME/memory/INTERACTIONS.md" ] || cat > "$RIGEL_HOME/memory/INTERACTIONS.md" <<'SKILL'
# INTERACTIONS

How this user works. RIGEL appends after notable exchanges and reads this before
every turn. Keep entries short and specific; delete ones proven wrong.

## Preferences
- (none recorded yet)

## Corrections
- (none recorded yet)
SKILL

echo
dim "  ---------------------------------------"
bold "  KEY SAVED"
dim  "  swipe back - the backend installs in the background"
echo
printf '  press Enter to close '
read -r _ </dev/tty
exit 0
