---
name: rigel-glyphs
description: Emits compact visual glyph tags so ZeroneLauncher can display dynamic dot-matrix icons on the Rigel screen and the home screen middle widget.
---

# Rigel Glyphs Skill

ZeroneLauncher features a dot-matrix visual display. When Rigel acts or speaks, it prepends a visual glyph tag to the front of its response so the launcher can render the matching animated or custom icon in the middle widget and Rigel screen.

Rigel is NOT limited to preset icons — Rigel can design, invent, and create brand-new dot-matrix glyphs on the fly!

## 1. Creating Brand-New Custom Glyphs

Rigel can create custom dot-matrix glyphs anytime the user requests a new visual, a specific logo, or an evocative icon.

### Method A: Inline Definition (`[GLYPH_DEF]`)
Define and immediately display a new glyph in the same turn:
`[GLYPH_DEF:<NAME>:<ROW1>,<ROW2>,<ROW3>,...] <Your response text>`

- `<NAME>`: Uppercase identifier (e.g. `HEART`, `SKULL`, `COFFEE`, `GHOST`, `SWORD`, `CAR`, `FLAME`, `STAR`, `CROWN`, `ROCKET`).
- Rows: Comma-separated (or slash `/` separated) dot strings of equal width.
- Active pixel: `X`
- Inactive pixel: `.`
- Typical dimension: 7 to 13 dots wide, 7 to 13 rows tall.

Example:
`[GLYPH_DEF:HEART:..XX...XX..,XXXXX.XXXXX,XXXXXXXXXXX,.XXXXXXXXX.,..XXXXXXX.., ...XXXXX...,....XXX....,.....X.....] Here is a custom heart glyph for you.`

### Method B: Persistent Creation via CLI or JSON
Rigel can execute `rigel-add-glyph` in Termux or save directly to `$HOME/.rigel/custom_glyphs.json`:
```bash
rigel-add-glyph SKULL "..XXXXX.. / .XXXXXXX. / XX.XXX.XX / XXXXXXXXX / XX.X.X.XX / .XXXXXXX. / ..XX.XX.."
```
Or write directly to `$HOME/.rigel/custom_glyphs.json`:
```json
{
  "SKULL": [
    "..XXXXX..",
    ".XXXXXXX.",
    "XX.XXX.XX",
    "XXXXXXXXX",
    "XX.X.X.XX",
    ".XXXXXXX.",
    "..XX.XX.."
  ]
}
```
Once saved, simply use `[GLYPH:SKULL]` anytime.

## 2. Design Gallery & Reference Templates

Use these design principles when drawing dot-matrix icons (typically 9 to 13 columns wide):

### HEART (11x8)
```
..XX...XX..
XXXXX.XXXXX
XXXXXXXXXXX
.XXXXXXXXX.
..XXXXXXX..
...XXXXX...
....XXX....
.....X.....
```

### SKULL (9x7)
```
..XXXXX..
.XXXXXXX.
XX.XXX.XX
XXXXXXXXX
XX.X.X.XX
.XXXXXXX.
..XX.XX..
```

### COFFEE (11x9)
```
.XXXXXXXX..
.X......X.X
.X.XXXX.X.X
.X......XX.
.X.XXXX.X..
.X......X..
..XXXXXX...
.XXXXXXXX..
...........
```

### GHOST (11x10)
```
...XXXXX...
..XXXXXXX..
.XXXXXXXXX.
.XX.XXX.XX.
.XX.XXX.XX.
.XXXXXXXXX.
.XXXXXXXXX.
.XXXXXXXXX.
.X.X.X.X.X.
X...X...X..
```

### SWORD (9x11)
```
....X....
...XXX...
...XXX...
...XXX...
...XXX...
...XXX...
..XXXXX..
.XXXXXXX.
....X....
....X....
...XXX...
```

### STAR (11x10)
```
.....X.....
....XXX....
...XXXXX...
XXXXXXXXXXX
.XXXXXXXXX.
..XXXXXXX..
..XXXXXXX..
.XX..X..XX.
XX.......XX
X.........X
```

### FLAME (9x11)
```
....X....
...XX....
..XXXX...
.XXXXXX..
.XXXXXXX.
XXXXXXXXX
XXXXXXXXX
XXXXXXXXX
.XXXXXXX.
..XXXXX..
...XXX...
```

### ROCKET (9x12)
```
....X....
...XXX...
..XXXXX..
..XX.XX..
..XXXXX..
..XXXXX..
..XXXXX..
.XXXXXXX.
XXXXXXXXX
XX..X..XX
X...X...X
...X.X...
```

## 3. Built-In Preset Glyph Tags

For quick standard tasks, you can still use the built-in preset tags:
- `[GLYPH:TORCH]` — Flashlight or camera torch.
- `[GLYPH:FILE]` — Notes, files, text documents.
- `[GLYPH:WIFI]` — Wi-Fi network status.
- `[GLYPH:BLUETOOTH]` — Bluetooth devices, audio.
- `[GLYPH:MUSIC]` — Music playback, media.
- `[GLYPH:SEARCH]` — Web browsing, queries.
- `[GLYPH:GEAR]` — Settings, tools.
- `[GLYPH:BATTERY]` — Battery diagnostics.
- `[GLYPH:PHONE]` — Calls, dialer, contacts.
- `[GLYPH:CODE]` — Scripts, terminal commands.
- `[GLYPH:CHECK]` — Generic task success.
- `[GLYPH:WARN]` — Errors, warnings.
- `[GLYPH:CHAT]` — General conversation.

## 4. Response Format Rules
- Always put `[GLYPH:NAME]` or `[GLYPH_DEF:NAME:...]` at the start of your message.
- The UI renders the glyph in the middle widget / Rigel mark and cleans it from spoken audio.
- Keep the following text concise and natural.
