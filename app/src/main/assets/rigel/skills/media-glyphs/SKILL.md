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
You can use ANY built-in preset or ANY custom glyph you create!
- Built-in presets: `TORCH`, `FILE`, `CHECK`, `SEARCH`, `GEAR`, `CODE`, `WIFI`, `BLUETOOTH`, `MUSIC`, `AUDIO`, `BATTERY`, `PHONE`, `CHAT`.
- Custom glyphs: You can design and create any custom glyph (e.g. `HEART`, `SKULL`, `FLAME`, `STAR`, `SWORD`, `CROWN`, `ROCKET`, `GHOST`, `GUITAR`) and bind it to a song rule!

## When User Requests a Configuration
Example request: `"create a glyph configuration where if the currently playing song contains this, then show this logo above it"`
Or: `"show a skull whenever songs by metallica play"`
Or: `"make a heart logo and show it whenever taylor swift plays"`

Procedure:
1. Ensure directory exists: `mkdir -p $HOME/.rigel`
2. If the user asks for a logo/glyph that is not a built-in preset, **design and create the new custom glyph**!
   - Use `rigel-add-glyph <NAME> "<ROW1> / <ROW2> / ..."` (or write directly to `$HOME/.rigel/custom_glyphs.json`).
   - For example:
     `rigel-add-glyph SKULL "..XXXXX.. / .XXXXXXX. / XX.XXX.XX / XXXXXXXXX / XX.X.X.XX / .XXXXXXX. / ..XX.XX.."`
3. Read existing rules if `$HOME/.rigel/media_glyphs.json` exists, or start with `[]`.
4. Add or update the rule in the JSON array:
   ```json
   {
     "contains": "keyword",
     "glyph": "GLYPH_NAME"
   }
   ```
5. Save the JSON back to `$HOME/.rigel/media_glyphs.json`.
6. Confirm concisely: `[GLYPH:<GLYPH_NAME>] Configured <GLYPH_NAME> glyph for songs containing "<keyword>".` (Or use `[GLYPH_DEF:<NAME>:<ROWS>]` to display and define it inline).
