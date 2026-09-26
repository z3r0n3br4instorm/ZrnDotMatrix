#!/data/data/com.termux/files/usr/bin/bash
# rigel-run <id> <base64-prompt>
# Full output goes to ~/.rigel/out/<id>.txt; stdout is truncated because the
# Termux result bundle comes back through a size-limited PendingIntent.
set -u
RIGEL_HOME="$HOME/.rigel"
CONF="$RIGEL_HOME/config.json"
ID="${1:-adhoc}"
OUT="$RIGEL_HOME/out/$ID.txt"
mkdir -p "$RIGEL_HOME/out"
[ -f "$CONF" ] || { echo "NO CONFIG - RUN SETUP"; exit 1; }

cfg() {
  if command -v jq >/dev/null 2>&1; then jq -r ".$1 // empty" "$CONF"
  else sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" "$CONF" | head -1; fi
}
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$HOME/.rigel/bin:$PREFIX/bin:$PREFIX/glibc/bin:$PATH"

PROVIDER="$(cfg provider)"; ENVVAR="$(cfg envVar)"; KEY="$(cfg key)"
MODEL="$(cfg model)";       BACKEND="$(cfg backend)"
[ -n "$ENVVAR" ] && export "$ENVVAR=$KEY"
if [ -z "$BACKEND" ] || [ "$BACKEND" = "direct" ]; then
  BACKEND="agy"
fi

PROMPT="$(printf '%s' "${2:-}" | base64 -d 2>/dev/null)"
[ -n "$PROMPT" ] || { echo "EMPTY PROMPT"; exit 1; }

json() { jq -n --arg m "$MODEL" --arg p "$PROMPT" "$1"; }

backend_opencode() { opencode run --model "$PROVIDER/$MODEL" "$PROMPT" 2>&1; }

# Antigravity CLI: communicates with persistent background daemon on port 4096
# for instant responses, or falls back to direct execution.
backend_agy() {
  local bin=agy
  command -v agy >/dev/null 2>&1 || bin=antigravity

  # Try warm background daemon instance first
  if curl -s -m 1 http://127.0.0.1:4096/ping >/dev/null 2>&1; then
    printf '%s' "$PROMPT" | curl -s -X POST http://127.0.0.1:4096/ask --data-binary @-
    return $?
  fi

  # Start daemon in background if node is available so subsequent turns are instant
  if command -v node >/dev/null 2>&1 && [ -f "$RIGEL_HOME/bin/rigel-daemon.js" ]; then
    node "$RIGEL_HOME/bin/rigel-daemon.js" > "$RIGEL_HOME/daemon.log" 2>&1 &
  fi

  echo "THINKING" > "$RIGEL_HOME/status"
  local m_args=()
  [ -n "$MODEL" ] && m_args=(--model "$MODEL")
  "$bin" --dangerously-skip-permissions --effort low "${m_args[@]}" -p "$PROMPT" 2>&1 || \
  "$bin" --dangerously-skip-permissions "${m_args[@]}" -p "$PROMPT" 2>&1 || \
  "$bin" -p "$PROMPT" 2>&1
}

# Deprecated fallback for manual API calls without tools
backend_direct() {
  case "$PROVIDER" in
    anthropic)
      curl -sS https://api.anthropic.com/v1/messages \
        -H "x-api-key: $KEY" -H "anthropic-version: 2023-06-01" -H "content-type: application/json" \
        -d "$(json '{model:$m,max_tokens:2048,messages:[{role:"user",content:$p}]}')" \
        | jq -r '.content[0].text // .error.message // "no response"' ;;
    openai|openrouter)
      base=https://api.openai.com/v1
      [ "$PROVIDER" = openrouter ] && base=https://openrouter.ai/api/v1
      curl -sS "$base/chat/completions" \
        -H "Authorization: Bearer $KEY" -H "content-type: application/json" \
        -d "$(json '{model:$m,messages:[{role:"user",content:$p}]}')" \
        | jq -r '.choices[0].message.content // .error.message // "no response"' ;;
    google)
      curl -sS "https://generativelanguage.googleapis.com/v1beta/models/$MODEL:generateContent" \
        -H "x-goog-api-key: $KEY" -H "content-type: application/json" \
        -d "$(jq -n --arg p "$PROMPT" '{contents:[{parts:[{text:$p}]}]}')" \
        | jq -r '.candidates[0].content.parts[0].text // .error.message // "no response"' ;;
    ollama)
      curl -sS "$KEY/api/generate" -H "content-type: application/json" \
        -d "$(json '{model:$m,prompt:$p,stream:false}')" \
        | jq -r '.response // "no response"' ;;
    *) echo "direct calls not wired for $PROVIDER" ;;
  esac
}

{
  case "$BACKEND" in
    agy|antigravity)
      if command -v agy >/dev/null 2>&1 || command -v antigravity >/dev/null 2>&1; then
        backend_agy
      else
        echo "ANTIGRAVITY CLI NOT FOUND - RUN SETUP TO INSTALL"
        exit 1
      fi
      ;;
    opencode)
      if command -v opencode >/dev/null 2>&1; then
        backend_opencode
      else
        echo "OPENCODE NOT FOUND - RUN SETUP TO INSTALL"
        exit 1
      fi
      ;;
    direct)
      backend_direct
      ;;
    *)
      if command -v agy >/dev/null 2>&1 || command -v antigravity >/dev/null 2>&1; then
        backend_agy
      else
        echo "ANTIGRAVITY CLI NOT CONFIGURED - RUN SETUP"
        exit 1
      fi
      ;;
  esac
} > "$OUT" 2>&1

sed -i 's/\x1b\[[0-9;?]*[a-zA-Z]//g; s/\r//g' "$OUT" 2>/dev/null || true
tail -c 3000 "$OUT"
