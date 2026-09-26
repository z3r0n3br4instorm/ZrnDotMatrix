---
name: media-glyphs
description: Allows Rigel to create and manage custom glyph configurations that show specific logos/glyphs on the launcher screen when matching songs or artists are playing.
---

# Media Glyph Configuration Skill

ZeroneLauncher can display custom dot-matrix logos/glyphs in the middle widget when specific songs or artists play. Configurations are stored in `$HOME/.rigel/media_glyphs.json`.

## File Format

`$HOME/.rigel/media_glyphs.json` is a JSON array of rule objects:
```json
[
  {
    "contains": "keyword",
    "glyph": "GLYPH_NAME"
  }
]
```

## Available Glyphs
- `TORCH` (Flashlight)
- `FILE` (Document / Note)
- `CHECK` (Checkmark)
- `SEARCH` (Magnifier / Web)
- `GEAR` (Cogwheel / System)
- `CODE` (Terminal / Script / Matrix)
- `WIFI` (Wi-Fi Arcs)
- `BLUETOOTH` (Bluetooth Rune)
- `MUSIC` (Music Notes)
- `AUDIO` (Headphones / Equalizer)
- `BATTERY` (Battery)
- `PHONE` (Telephone)
- `CHAT` (Speech Bubble)

## When User Requests a Configuration
Example request: `"create a glyph configuration where if the currently playing song contains this, then show this logo above it"`
Or: `"show the torch logo whenever a song containing rock is playing"`

Procedure:
1. Ensure directory exists: `mkdir -p $HOME/.rigel`
2. Read existing rules if `$HOME/.rigel/media_glyphs.json` exists, or start with `[]`.
3. Normalize the keyword (case-insensitive substring match) and match the glyph name to one of the available glyphs.
4. Add or update the rule in the JSON array.
5. Save the JSON back to `$HOME/.rigel/media_glyphs.json`.
6. Confirm concisely: `[GLYPH:<GLYPH_NAME>] Configured <GLYPH_NAME> glyph for songs containing "<keyword>".`
