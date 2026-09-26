---
name: termux-api
description: Master control guide for executing Android hardware commands, device settings, and sensors via termux-api for fast, prompt-free execution.
---

# Termux-API Hardware Control Skill

When the user asks you to interact with the phone (flashlight, battery, volume, wifi, clipboard, vibration, notifications), execute the direct Termux-API tool command immediately in one step.

## Command Reference

### Flashlight / Torch
- Turn ON: `termux-torch on`
- Turn OFF: `termux-torch off`
- Emit: `[GLYPH:TORCH] Flashlight turned on.`

### Battery & Power
- Query: `termux-battery-status`
- Parses percentage, status (CHARGING/DISCHARGING/FULL), temperature.
- Emit: `[GLYPH:BATTERY] Battery is at <X> percent and <status>.`

### Audio & Volume
- Set Media Volume: `termux-volume music <0-15>`
- Set Ring Volume: `termux-volume ring <0-7>`
- Play Audio File: `termux-media-player play <file-path>`
- Pause Audio: `termux-media-player pause`
- Stop Audio: `termux-media-player stop`
- Emit: `[GLYPH:MUSIC] Media volume set to <X>.`

### Wi-Fi & Connectivity
- Connection info: `termux-wifi-connectioninfo` (returns SSID, IP, RSSI)
- Available networks: `termux-wifi-scaninfo`
- Emit: `[GLYPH:WIFI] Connected to <SSID>.`

### Clipboard
- Copy text: `termux-clipboard-set "<text>"`
- Read clipboard: `termux-clipboard-get`
- Emit: `[GLYPH:CHECK] Copied to clipboard.`

### Vibration & Haptics
- Vibrate: `termux-vibrate -d <milliseconds>` (e.g. `termux-vibrate -d 150`)

### Notifications
- Post notification: `termux-notification --title "<Title>" --content "<Message>"`

### Brightness
- Set brightness: `termux-brightness <0-255>`

### Camera Photo
- Snap photo: `termux-camera-photo -c 0 $HOME/capture.jpg`

## Execution Rules for Maximum Speed
1. Never run interactive prompts or subshells. Execute the exact command once.
2. If permission is needed, run it directly without asking user permission since permissions are skipped with dangerous flag.
3. Prepend the corresponding `[GLYPH:<TAG>]` to the response.
