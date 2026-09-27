---
name: ui-scenes
description: Lets Rigel invent new launcher behaviour — custom animations, physics, reactions to shakes, tracks, charging or unlocking — by writing small drawing programs (scenes) that ZeroneLauncher runs on its dot matrix.
---

# UI Scenes Skill

Glyphs cover "show an icon". Scenes cover everything else: **Rigel can add new visual behaviour to
the launcher itself.** If the user asks for something the launcher has no button for — "splash water
across the screen when I shake the phone", "flash the display when a track by that artist comes on",
"show a spinning cube in the widget while charging" — write a scene.

A scene is a tiny program that draws on the dot grid. It names **when** it runs (a trigger), **where**
it draws (a target) and **how long** it lasts. The launcher stores it in `$HOME/.rigel/ui_scenes.json`
so it survives restarts.

## 1. Installing a scene from a reply

Put the directive anywhere in the reply; the launcher strips it out before speaking.

```
[SCENE:<NAME>:<TRIGGER>:<TARGET>:<TTL_MS>]
<body>
[/SCENE]
```

- `NAME` — uppercase identifier. Re-using a name replaces that scene.
- `TRIGGER` — see the table below.
- `TARGET` — `mid` (the home screen's middle widget) or `full` (the whole panel).
- `TTL_MS` — how long one run lasts, in milliseconds. Ignored for `always`.

Remove one with `[SCENE_OFF:<NAME>]`.

### Triggers

| Trigger | Fires when |
|---|---|
| `shake` | the phone is shaken (the accelerometer only runs while a shake scene exists) |
| `track:<text>` | playback changes to a track whose title or artist contains `<text>` |
| `charge` | the charger is plugged in |
| `unplug` | the charger is removed |
| `unlock` | the screen comes on and the user gets through the lock screen |
| `boot` | the launcher starts |
| `always` | runs continuously while it owns its target |

## 2. Built-in effects

The fastest way to satisfy a request. Body is one line:

```
[SCENE:SPLASH:shake:full:7000]
builtin:water
[/SCENE]
```

- `builtin:water` — shallow-water height field: a real wave simulation, sloshed by tilt, splashed
  by shakes, throwing droplets off fast crests.
- `builtin:flash` — strobes the target area, fading out over the scene's lifetime.
- `builtin:sparks` — a burst of particles from the centre, with gravity.

Example for "flash the screen when Radiohead comes on":

```
[SCENE:RHFLASH:track:radiohead:full:2500]
builtin:flash
[/SCENE]
```

## 3. Writing your own

The body is JavaScript. It runs **once per frame** (~60fps) and receives `api`. Draw, return, and
the launcher composites it. Do not loop forever and do not allocate per frame if you can help it —
keep state in `api.state`, which persists for the run.

```
[SCENE:RAIN:always:mid:0]
if (!api.state.drops) {
  api.state.drops = [];
  for (var i = 0; i < 24; i++) api.state.drops.push({ c: api.c0 + api.rnd(i, 1) * api.w, r: api.r0 + api.rnd(i, 2) * api.h, v: 0.4 + api.rnd(i, 3) });
}
api.state.drops.forEach(function (d, i) {
  d.r += d.v;
  if (d.r > api.r1) { d.r = api.r0; d.c = api.c0 + api.rnd(i, api.t) * api.w; }
  api.set(d.c, d.r, 1);
  api.set(d.c, d.r - 1, 3);
});
[/SCENE]
```

### The api

**Geometry** — `c0, r0, c1, r1` (the bounds you may draw in), `w, h`, `cx, cy`.
Columns and rows are dot coordinates; the home grid is 68 columns wide.

**Time** — `A` (epoch ms), `t` (ms since this run started), `u` (0..1 through the ttl).

**Drawing** — `set(c, r, v)`, `line(c0, r0, c1, r1, v)`, `rect(c0, r0, c1, r1, v)`,
`disc(c, r, radius, v)`, `text(str, c, r, v)`, `textc(str, r, v)` (centred).
Brightness `v`: `1` normal, `2` accent, `3` dim, `5` amber, `9` red, `0` clears the dot.

**Sensors and state** — `tilt.x`, `tilt.y` (-1..1 gravity vector), `shake` (magnitude, non-zero for
a moment after a shake), `status` (battery, charging, track, artist, wifi, bt, cpu, ram),
`state` (yours, persists across frames).

**Effects** — `ripple(c, r)` fires the launcher's shockwave, `haptic()` a micro-tick,
`done()` ends the run early.

**Helpers** — `rnd(a, b)` is a deterministic 0..1 hash; use it instead of `Math.random()` so a
frame redrawn twice looks the same.

## 4. Rules

- Everything you draw is clipped to your target's box; you cannot overwrite the clock or the dock.
- A scene that throws is **disabled immediately** and named on screen. Test your arithmetic.
- The user can switch all scenes off in Settings, and can roll the launcher back to an earlier
  state — so before you install something dramatic, say so in your reply.
- Prefer a built-in when it fits. Prefer few, cheap dots: this is a dot matrix, not a canvas.
- Say what you armed, in one sentence: "Shake the phone and you'll get water."
