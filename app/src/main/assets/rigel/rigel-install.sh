#!/data/data/com.termux/files/usr/bin/bash
# rigel-install <backend>
set -u
RIGEL_HOME="$HOME/.rigel"
BACKEND="${1:-agy}"
STATUS="$RIGEL_HOME/status"
LOG="$RIGEL_HOME/install.log"
mkdir -p "$RIGEL_HOME"
: > "$LOG"
RESULT=""
say() { printf '%s\n' "$1" > "$STATUS"; }
# The launcher branches on this, so it must survive the final "DONE".
result() { RESULT="$1"; say "$1"; }
have() { command -v "$1" >/dev/null 2>&1; }

say "STARTING"
say "DEPS 1/4 CURL"
have curl || pkg install -y curl >>"$LOG" 2>&1
say "DEPS 2/4 JQ"
have jq   || pkg install -y jq   >>"$LOG" 2>&1

say "DEPS 3/4 NODE"
node_major() { node -v 2>/dev/null | sed 's/^v//; s/\..*//'; }
if ! have node || [ "$(node_major)" -lt 18 ] 2>/dev/null; then
  pkg install -y nodejs-lts >>"$LOG" 2>&1 || pkg install -y nodejs >>"$LOG" 2>&1
fi

say "DEPS 4/4 TERMUX-API"
have termux-torch || pkg install -y termux-api >>"$LOG" 2>&1 || true

case "$BACKEND" in
  opencode)
    if have opencode && opencode --version >/dev/null 2>&1; then
      result "OPENCODE READY"
    else
      say "INSTALLING OPENCODE"
      have npm && npm install -g opencode-ai >>"$LOG" 2>&1
      have opencode || curl -fsSL https://opencode.ai/install 2>>"$LOG" | bash >>"$LOG" 2>&1
      # opencode ships glibc-only prebuilt binaries and Termux is Bionic, so even a
      # "successful" install usually leaves something that cannot exec. Check, do not assume.
      if have opencode && opencode --version >/dev/null 2>&1; then
        result "OPENCODE READY"
      else
        result "OPENCODE WONT RUN ON TERMUX"
      fi
    fi
    ;;
  agy|antigravity)
    if have agy || have antigravity; then
      result "AGY READY"
    else
      # Google's own installer cannot produce a working binary here: it picks the glibc
      # build on Termux (its musl probe looks for /lib/libc.musl-*.so.1, absent on Android)
      # and even the musl build needs VA39 page-alignment patches to exec under Bionic.
      #
      # This uses a THIRD-PARTY community fork that does that packaging for Termux:
      #   https://github.com/wallentx/antigravity-cli-termux
      # Not maintained by Google or by this project. The UI says so before it runs.
      case "$(uname -m)" in
        aarch64|arm64) : ;;
        *) result "AGY NEEDS ARM64 ($(uname -m) UNSUPPORTED)"; BACKEND=skip ;;
      esac

      if [ "$BACKEND" != skip ]; then
        # RUN_COMMAND does not export TERMUX_VERSION/PREFIX, and the fork's installer
        # hard-exits without them ("only for native Termux"). That was the actual failure.
        export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
        export TERMUX_VERSION="${TERMUX_VERSION:-0.119.0}"

        say "AGY 1/3 GLIBC"
        pkg install -y glibc-repo >>"$LOG" 2>&1
        pkg install -y glibc >>"$LOG" 2>&1

        say "AGY 2/3 CLEAN"
        rm -rf "$PREFIX/tmp/.agy-extract" "$PREFIX/tmp/antigravity-termux-standalone.tar.gz" \
               "$PREFIX/bin/agy" "$RIGEL_HOME/bin/agy" >>"$LOG" 2>&1

        say "AGY 3/3 INSTALLING 50MB"
        if curl -fsSL https://raw.githubusercontent.com/wallentx/antigravity-cli-termux/dev/install.sh | bash >>"$LOG" 2>&1; then
          hash -r 2>/dev/null || true
          if have agy || have antigravity; then
            result "AGY READY - LOG IN NEXT"
            if [ ! -f "$RIGEL_HOME/config.json" ]; then
              echo '{"provider":"google","backend":"agy"}' > "$RIGEL_HOME/config.json"
              chmod 600 "$RIGEL_HOME/config.json"
            fi
          else
            result "AGY INSTALL PRODUCED NO BINARY"
          fi
        else
          result "AGY INSTALL FAILED - SEE ~/.rigel/install.log"
        fi
      fi
    fi
    ;;
  *) result "BACKEND UNKNOWN" ;;
esac

say "DONE"
# Echo the final state so the launcher can tell success from fallback.
printf '%s\n' "${RESULT:-DONE}"
