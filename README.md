# ZrnDotMatrix (ZERONE Launcher)

Android home-screen app in the Zerone Laboratories DotMatrix language: ZERONE splash on screen-on, black & white dot grid with the red glitch ripple, clock/weather, status column, context glyph (charging / headphones / Wi-Fi / on the move / bedtime), circled phone, dock (Camera · Chrome · Termux · WhatsApp · Apple Music), app drawer, Termux screen, theme menu (hold).

## Hardware acceleration
- `android:hardwareAccelerated="true"` on the app and activity, the WebView on `LAYER_TYPE_HARDWARE`.
- The UI draws with **WebGL**: every dot is a GPU point sprite — one draw call for the dots, one for the glow, the ghost grid lives in a static GPU buffer. The page sets `data-renderer="webgl"` on `<html>` (falls back to 2D canvas only if WebGL is missing; check with `chrome://inspect`).
- Frames are only drawn when something visible changed (clock layout key); idle home ≈ 4–5 frames/s, animations run at display rate.

## Build
Open the folder in Android Studio (Koala or newer) and Run, or:
```
./gradlew assembleDebug          # app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/debug/app-debug.apk
```
Then press Home and pick **ZERONE** → Always. minSdk 26, targetSdk 34.

## Termux integration
Commands run through Termux's `RUN_COMMAND` service (`bash -lc <cmd>`, background) and the output is typed out in dots.
1. Install Termux (F-Droid/GitHub build).
2. In Termux: `mkdir -p ~/.termux && echo "allow-external-apps = true" >> ~/.termux/termux.properties && termux-reload-settings`
3. Allow ZERONE's "Run commands in Termux environment" permission when asked (or App info → Permissions → Additional permissions).
Edit the chips in `app/src/main/assets/web/launcher-core.js` → `TERM_CMDS`. Hold on the Termux screen to open the Termux app itself.

## Context glyph
Charging overrides everything. Otherwise: headphones → HEADPHONES; 22:00–06:00 with an alarm set → BEDTIME; Wi-Fi → ON WIFI (or AT HOME / AT WORK if the SSID is in `HOME_SSIDS` / `WORK_SSIDS` in `launcher-core.js`); else ON THE MOVE. Reading the Wi-Fi name needs the location permission.

## Weather
Open-Meteo (no key) from the last known coarse location, cached 30 min.

## Files
- `app/src/main/assets/web/` — engine.js (dot grid, fonts, morph, ripple), launcher-core.js (screens), renderer.js (WebGL + fallback), app.js (input, bridge, loop), icons.js.
- `MainActivity.kt` — HOME activity, full-bleed hardware-accelerated WebView, splash on screen-on, Back/Home handling.
- `Bridge.kt` — apps list, launching, Termux RUN_COMMAND, location, 24h setting.
- `StatusMonitor.kt` — battery/charging, Wi-Fi, Bluetooth, headphones, signal, next alarm.
- `TermuxResultReceiver.kt` — receives Termux's result bundle.
