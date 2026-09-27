#!/data/data/com.termux/files/usr/bin/bash
# ======================================================================
# rigel-add-glyph — CLI helper for Rigel to register custom dot-matrix glyphs
#
# Usage:
#   rigel-add-glyph <NAME> <ROW1,ROW2,ROW3...>
#   rigel-add-glyph <NAME> "<ROW1> / <ROW2> / <ROW3>..."
#   rigel-add-glyph <NAME> '["..XX..", "XXXXXX", ...]'
#
# Dot matrix conventions:
#   Width:  7 to 13 dots wide (typically 9 to 13)
#   Height: 7 to 13 rows tall
#   Active dot: 'X', '#', '*', or '1'
#   Empty dot:  '.'
# ======================================================================

set -e

HOME="${HOME:-/data/data/com.termux/files/home}"
RIGEL_DIR="$HOME/.rigel"
GLYPH_FILE="$RIGEL_DIR/custom_glyphs.json"

mkdir -p "$RIGEL_DIR"

NAME="$1"
shift || true
ROWS_INPUT="$*"

if [ -z "$NAME" ]; then
  echo "Usage: rigel-add-glyph <NAME> <ROWS...>"
  exit 1
fi

NAME=$(echo "$NAME" | tr '[:lower:]' '[:upper:]' | tr -cd 'A-Z0-9_-')

# Use node if available, otherwise pure python/awk
node -e '
const fs = require("fs");
const path = require("path");

const glyphFile = process.argv[1];
const name = process.argv[2];
let rawRows = process.argv[3] || "";

if (!rawRows && !process.stdin.isTTY) {
  rawRows = fs.readFileSync(0, "utf8");
}

let rows = [];
try {
  const parsed = JSON.parse(rawRows);
  if (Array.isArray(parsed)) rows = parsed;
} catch (e) {}

if (!rows.length) {
  if (rawRows.includes("\n")) rows = rawRows.split("\n");
  else if (rawRows.includes("/")) rows = rawRows.split("/");
  else if (rawRows.includes("|")) rows = rawRows.split("|");
  else if (rawRows.includes(",")) rows = rawRows.split(",");
  else rows = [rawRows];
}

rows = rows.map(r => String(r || "").trim()).filter(r => r.length > 0);
if (!rows.length) {
  console.error("ERROR: No valid rows provided");
  process.exit(1);
}

// Normalize characters: active dots become X, empty dots become .
const normalized = rows.map(row => {
  let out = "";
  for (let i = 0; i < row.length; i++) {
    const c = row[i];
    out += (c === "X" || c === "x" || c === "#" || c === "*" || c === "1" || c === "@") ? "X" : ".";
  }
  return out;
});

let current = {};
try {
  if (fs.existsSync(glyphFile)) {
    current = JSON.parse(fs.readFileSync(glyphFile, "utf8") || "{}");
  }
} catch (e) {}

current[name] = normalized;
fs.writeFileSync(glyphFile, JSON.stringify(current, null, 2));

const w = normalized[0] ? normalized[0].length : 0;
const h = normalized.length;
console.log(`GLYPH_SAVED: ${name} (${w}x${h})`);
' "$GLYPH_FILE" "$NAME" "$ROWS_INPUT" 2>/dev/null || {
  # Fallback if node is not installed
  python3 -c "
import sys, json, os, re

glyph_file = sys.argv[1]
name = sys.argv[2]
raw = sys.argv[3] if len(sys.argv) > 3 else ''

if not raw:
  raw = sys.stdin.read()

try:
  rows = json.loads(raw)
except:
  if '\n' in raw: rows = raw.split('\n')
  elif '/' in raw: rows = raw.split('/')
  elif '|' in raw: rows = raw.split('|')
  elif ',' in raw: rows = raw.split(',')
  else: rows = [raw]

rows = [r.strip() for r in rows if r.strip()]
norm = [''.join(['X' if c in 'Xx#*1@' else '.' for c in r]) for r in rows]

data = {}
if os.path.exists(glyph_file):
  try:
    with open(glyph_file, 'r') as f:
      data = json.load(f)
  except: pass

data[name] = norm
with open(glyph_file, 'w') as f:
  json.dump(data, f, indent=2)

print(f'GLYPH_SAVED: {name} ({len(norm[0]) if norm else 0}x{len(norm)})')
" "$GLYPH_FILE" "$NAME" "$ROWS_INPUT"
}
