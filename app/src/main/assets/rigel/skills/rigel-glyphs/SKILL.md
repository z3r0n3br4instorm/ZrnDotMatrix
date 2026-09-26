---
name: rigel-glyphs
description: Emits compact visual glyph tags so ZeroneLauncher can display dynamic dot-matrix icons on the Rigel screen and the home screen middle widget.
---

# Rigel Glyphs Skill

ZeroneLauncher features a dot-matrix visual display. When Rigel acts or speaks, it prepends a single visual glyph tag `[GLYPH:<NAME>]` to the front of its response so the launcher can render the matching animated icon in the middle widget and Rigel screen.

## Standard Glyph Tags

Always select the most relevant tag from this list:

- `[GLYPH:TORCH]` — Flashlight or camera torch toggled or adjusted.
- `[GLYPH:FILE]` — Files created, edited, read, or listed; notes; text documents.
- `[GLYPH:WIFI]` — Wi-Fi network status, IP address, connections.
- `[GLYPH:BLUETOOTH]` — Bluetooth devices, pairing, audio output.
- `[GLYPH:MUSIC]` — Music playback, track controls, volume, media.
- `[GLYPH:SEARCH]` — Web browsing, search queries, general knowledge lookups.
- `[GLYPH:GEAR]` — System settings, launcher configurations, background tools.
- `[GLYPH:BATTERY]` — Battery percentage, charging state, power diagnostics.
- `[GLYPH:PHONE]` — Calls, phone dialer, contacts, messages.
- `[GLYPH:CODE]` — Scripts, Termux commands, terminal tools, programming.
- `[GLYPH:CHECK]` — Generic task completed successfully.
- `[GLYPH:WARN]` — Errors, blocked permissions, or unsupported requests.
- `[GLYPH:CHAT]` — General conversation, questions, greetings, jokes.

## Format Specification

Prepend the tag at the very start of the response, followed by the spoken natural language text:
`[GLYPH:TORCH] Flashlight turned on.`
`[GLYPH:FILE] I have created your notes file.`
`[GLYPH:SEARCH] The weather in Tokyo is sunny and twenty-two degrees.`
`[GLYPH:CHECK] Done.`
