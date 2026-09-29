// Glue: native bridge, input, weather, frame loop.
(function () {
  'use strict';
  const N = window.ZLNative || null;                       // Android @JavascriptInterface (null in a desktop browser)
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} } };
  const bridge = {
    apps: () => { try { return N ? JSON.parse(N.apps()) : [{ label: 'Chrome', pkg: 'com.android.chrome' }, { label: 'Termux', pkg: 'com.termux' }]; } catch (e) { return []; } },
    appsReady: () => (N && N.appsReady ? N.appsReady() : true),
    refreshApps: () => { if (N && N.refreshApps) N.refreshApps(); },
    launch: (act) => { if (N) N.launch(act); else console.log('launch', act); },
    runTermux: (id, cmd) => { if (N) N.runTermux(id, cmd); else setTimeout(() => window.ZL.onTermux(id, 'demo: ' + cmd, '', 0, ''), 400); },
    is24h: () => (N ? N.is24h() : true),
    savePalette: (n) => store.set('zlPalette', n),
    isPreciseHaptics: () => (N && N.isPreciseHaptics ? N.isPreciseHaptics() : false),
    hapticRipple: () => { if (N && N.hapticRipple) N.hapticRipple(); },
    hapticTransition: () => { if (N && N.hapticTransition) N.hapticTransition(); },
    hapticTick: (s) => { if (N && N.hapticTick) N.hapticTick(s); },
    hapticArrange: (ms) => { if (N && N.hapticArrange) N.hapticArrange(ms); },
    hapticSweep: (ms) => { if (N && N.hapticSweep) N.hapticSweep(ms); },
    mediaPlayPause: () => { if (N && N.mediaPlayPause) N.mediaPlayPause(); else L.toggleDemoPlay(); },
    mediaNext: () => { if (N && N.mediaNext) N.mediaNext(); },
    mediaPrev: () => { if (N && N.mediaPrev) N.mediaPrev(); },
    openNotificationAccess: () => { if (N && N.openNotificationAccess) N.openNotificationAccess(); },
    setHapticIntensity: (s) => { if (N && N.setHapticIntensity) N.setHapticIntensity(s); },
    uiSleep: () => tickStop(),
    uiWake: () => tickStart(),
    isForeground: () => (N && N.isForeground ? N.isForeground() : !document.hidden),
    audioLive: () => (N && N.audioLive ? N.audioLive() : false),
    radioCaps: () => { try { return N && N.radioCaps ? JSON.parse(N.radioCaps()) : {}; } catch (e) { return {}; } },
    toggleRadio: (w) => (N && N.toggleRadio ? N.toggleRadio(w) : false),
    tiltAvailable: () => (N && N.tiltAvailable ? N.tiltAvailable() : false),
    setTiltWanted: (v) => { if (N && N.setTiltWanted) N.setTiltWanted(v); },
    setShakeWanted: (v) => { if (N && N.setShakeWanted) N.setShakeWanted(v); },
    uiReady: () => { if (N && N.uiReady) N.uiReady(); },
    fingerprintSensor: () => { try { return N && N.fingerprintSensor ? JSON.parse(N.fingerprintSensor()) : null; } catch (e) { return null; } },
    version: () => (N && N.version ? N.version() : 'v0.2.1.dev.1'),
    rigelExec: (id, cmd) => { if (N && N.rigelExec) N.rigelExec(id, cmd); },
    rigelAsk: (id, b64) => { if (N && N.rigelAsk) N.rigelAsk(id, b64); },
    rigelReady: (id) => { if (N && N.rigelReady) N.rigelReady(id); },
    rigelReset: (id) => { if (N && N.rigelReset) N.rigelReset(id); },
    rigelModels: (id) => { if (N && N.rigelModels) N.rigelModels(id); },
    rigelSetModel: (id, m) => { if (N && N.rigelSetModel) N.rigelSetModel(id, m); },
    rigelAbort: () => { if (N && N.rigelAbort) N.rigelAbort(); },
    mediaGlyphs: (id) => { if (N && N.mediaGlyphs) N.mediaGlyphs(id); },
    customGlyphs: (id) => { if (N && N.customGlyphs) N.customGlyphs(id); },
    saveGlyph: (json) => { if (N && N.saveGlyph) N.saveGlyph(json); },
    uiScenes: (id) => { if (N && N.uiScenes) N.uiScenes(id); },
    saveScene: (json) => { if (N && N.saveScene) N.saveScene(json); },
    rigelSetup: (b) => (N && N.rigelSetup ? N.rigelSetup(b) : false),
    rigelInstall: (id, b) => { if (N && N.rigelInstall) N.rigelInstall(id, b); },
    rigelAgySetup: () => (N && N.rigelAgySetup ? N.rigelAgySetup() : false),
    rigelStatus: (id) => { if (N && N.rigelStatus) N.rigelStatus(id); },
    voiceCaps: () => { try { return N && N.voiceCaps ? JSON.parse(N.voiceCaps()) : {}; } catch (e) { return {}; } },
    voiceStart: () => (N && N.voiceStart ? N.voiceStart() : false),
    voiceStop: () => { if (N && N.voiceStop) N.voiceStop(); },
    voiceSpeak: (t) => { if (N && N.voiceSpeak) N.voiceSpeak(t); },
    voiceShutUp: () => { if (N && N.voiceShutUp) N.voiceShutUp(); },
    copyUnlockCommand: () => (N && N.copyUnlockCommand ? N.copyUnlockCommand() : false),
    openTermuxApp: () => (N && N.openTermuxApp ? N.openTermuxApp() : false),
    getConfig: () => {
      const defaults = {
        launchDelay: 800, termuxMode: 'app', sysStats: true, eventBanners: true,
        haptics: true, hapticLevel: 'med', agentic: 'agy', amoled: false, speak: false, streamRigel: true, musicApp: 'auto', chatApp: 'auto',
        bootSeed: 'random'          // where the boot dots come from: 'random' or 'fp'
      };
      try {
        return Object.assign(defaults, JSON.parse(store.get('zlConfig') || '{}'));
      } catch (e) {
        return defaults;
      }
    },
    saveConfig: (c) => store.set('zlConfig', JSON.stringify(c)),
    // Generic slot, used by the settings state timeline.
    loadState: (k) => store.get(k),
    saveState: (k, v) => store.set(k, v),
    clearState: (k) => { try { localStorage.removeItem(k); } catch (e) {} }
  };

  // The screens are drawn against a 68x152 design grid. Pick a pitch that fits BOTH, so a
  // 16:9 phone (which would otherwise only get ~120 rows and collapse the middle widget)
  // gets a finer, wider dot field instead; makeScreen centres the content band in it.
  const W = window.innerWidth, H = window.innerHeight;
  const pitch = Math.min(W / 68, H / 152);
  const scr = makeScreen({ w: W, h: H, pitch: pitch, design: 68, shape: 'rect', radius: 0 });
  const scrHi = makeScreen({ w: W, h: H, pitch: pitch / 2, design: 136, shape: 'rect', radius: 0 });
  const L = new Launcher(scr, bridge, scrHi);
  L.palName = store.get('zlPalette') || 'Mono';
  const canvas = document.getElementById('dm');
  const R = makeRenderer(canvas, scr);
  document.documentElement.setAttribute('data-renderer', R.kind);

  // ---- calls from Android ----
  window.ZL = {
    onStatus(json) { L.onStatus(json); },
    onApps(json) { L.onApps(json); },                       // app cache finished building
    uiShown() { L.uiShown = true; },                        // native: frame 0 composited, cover down
    onShake(mag) { if (L.onShake) L.onShake(mag); },         // accelerometer jolt, drives scenes
    onAudio(json) { L.onAudio(json); },                     // live FFT from AudioCapture
    onTilt(x, y) { L.onTilt(x, y); },                       // accelerometer, drives RIGEL parallax
    onVoice(text, final) { L.onVoice(text, final); },
    onVoiceLevel(l) { L.onVoiceLevel(l); },
    onVoiceState(st) { L.onVoiceState(st); },
    launchFailed() { L.launchFailed(); },                   // nothing handled the launch intent
    rigelSetupFailed(why) { L.rigelSetupFailed(why); },
    onTermux(id, out, err, code, e) { L.onTermux(id, out, err, code, e); },
    wake() { pipelineReset(); L.splash(); tickStart(); L.refreshPrediction(true); },    // screen turned on
    pause() { L.pausedAt = Date.now(); pipelineReset(); tickStop(); },
    resume(wakeOwed) { pipelineReset(); tickStart(); L.resumeHome(wakeOwed); if (L.refreshCustomGlyphs) L.refreshCustomGlyphs(); if (L.refreshMediaGlyphs) L.refreshMediaGlyphs(); if (L.refreshScenes) L.refreshScenes(); L.refreshPrediction(true); },   // back on top: replay the closing morph
    home() { L.home(); },                                   // home pressed while already home
    settings() { L.openSettings(); },                       // open hidden settings
    back() { return L.back(); },
    location(lat, lon) { weather(lat, lon); },
    renderer() { return R.kind; }
  };

  // ---- weather (Open-Meteo, no key), cached 30 min ----
  function weather(lat, lon) {
    const c = JSON.parse(store.get('zlWx') || 'null');
    const apply = (x) => { L.weather = { temp: x.temp, kind: x.code <= 1 ? 'Sun' : x.code <= 48 ? 'Cloud' : 'Rain' }; L.lastKey = null; };
    if (c) apply(c);
    if (c && Date.now() - c.t < 30 * 60 * 1000) return;
    fetch('https://api.open-meteo.com/v1/forecast?latitude=' + (+lat).toFixed(3) + '&longitude=' + (+lon).toFixed(3) + '&current_weather=true')
      .then((r) => r.json()).then((j) => { const x = { t: Date.now(), temp: j.current_weather.temperature, code: j.current_weather.weathercode }; store.set('zlWx', JSON.stringify(x)); apply(x); })
      .catch(() => {});
  }

  // ---- input: tap / hold (600 ms) / drag / 3-finger swipe up ----
  let down = null, holdT = null;
  let threeY0 = null;
  const pos = (e) => { const t = e.changedTouches ? e.changedTouches[0] : e; return [t.clientX, t.clientY]; };

  window.addEventListener('touchstart', (e) => {
    if (e.touches && e.touches.length === 3) {
      threeY0 = (e.touches[0].clientY + e.touches[1].clientY + e.touches[2].clientY) / 3;
    } else {
      threeY0 = null;
    }
  }, { passive: true });

  window.addEventListener('touchmove', (e) => {
    if (threeY0 !== null && e.touches && e.touches.length === 3) {
      const curY = (e.touches[0].clientY + e.touches[1].clientY + e.touches[2].clientY) / 3;
      if (threeY0 - curY > 50) {
        threeY0 = null;
        if (down) { clearTimeout(holdT); down = null; }
        L.openSettings();
      }
    }
  }, { passive: true });

  window.addEventListener('touchend', () => { threeY0 = null; }, { passive: true });
  window.addEventListener('touchcancel', () => { threeY0 = null; }, { passive: true });

  // Desktop keyboard shortcut for testing: S key
  window.addEventListener('keydown', (e) => {
    if (e.key === 's' || e.key === 'S') L.openSettings();
  });

  canvas.addEventListener('pointerdown', (e) => {
    const p = pos(e); down = { x: p[0], y: p[1], x0: p[0], y0: p[1], moved: false, held: false, swiped: false };
    clearTimeout(holdT);
    holdT = setTimeout(() => { if (down && !down.moved) { down.held = L.hold(down.x, down.y); if (down.held && N && N.haptic) N.haptic(); } kick(); }, 600);
  });
  const SWIPE_X = 55;                                        // px before a drag counts as a swipe
  canvas.addEventListener('pointermove', (e) => {
    if (!down) return;
    const p = pos(e);
    const dx = p[0] - down.x0, dy = p[1] - down.y0;
    // Horizontal wins only when it clearly dominates, so drawer scrolling still feels free.
    if (!down.swiped && Math.abs(dx) > SWIPE_X && Math.abs(dx) > Math.abs(dy) * 1.6) {
      down.swiped = true; down.moved = true; clearTimeout(holdT);
      L.swipe(dx > 0 ? 1 : -1, down.y0);
      return;
    }
    if (down.swiped) return;
    if (Math.abs(dy) > 10) { down.moved = true; clearTimeout(holdT); }
    if (down.moved) { L.drag(p[1] - down.y); down.y = p[1]; }
  });
  const up = (e) => {
    clearTimeout(holdT);
    if (!down) return;
    const p = pos(e), d = down; down = null;
    if (!d.moved && !d.held) L.tap(p[0], p[1]);
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', () => { clearTimeout(holdT); down = null; });

  // ---- frame loop: GPU draw only when something changed, and only while we are on top ----
  let last = 0, emaGpu = 16, rafId = 0, ticking = false;
  let lastGpuPush = 0;
  // Frames that arrived on time, back to back. After a deep sleep the first few rAF callbacks
  // fire long before the compositor is presenting, so the launcher waits for this to prove the
  // pipeline is live before it starts an animation the user would otherwise never see.
  let goodFrames = 0, pipelineSince = 0;
  const PIPELINE_FRAMES = 3;
  const PIPELINE_GIVEUP = 1200;      // never hold an animation longer than this, whatever rAF says
  function pipelineReset() { goodFrames = 0; pipelineSince = 0; L.pipelineReady = false; }
  // Idempotent on purpose: ZL.pause() is delivered through evaluateJavascript and may not
  // land before the WebView suspends, so resume must always re-arm a live frame request
  // rather than trusting the flag.
  // ---- demand-driven frame loop ----
  // The loop used to request an animation frame on every vsync forever and let L.frame()
  // decide there was nothing to draw. An outstanding rAF keeps Chromium's whole frame
  // pipeline (renderer main thread, Viz, the GPU thread) waking 60 times a second, which
  // measured ~50% of a CPU core on an idle home screen. Now it runs every vsync only while
  // something is actually moving, and otherwise sleeps until the next change is due:
  // the next blink edge from L.nextWakeMs(), or any event, input or state change, which
  // wakes it straight away through kick().
  let wakeT = 0;
  function kick() {                                         // something changed: draw next vsync
    if (!ticking) return;
    if (wakeT) { clearTimeout(wakeT); wakeT = 0; }
    if (!rafId) rafId = requestAnimationFrame(loop);
  }
  function sleepFor(ms) {
    if (!ticking || rafId) return;                          // a frame is already on its way
    if (wakeT) clearTimeout(wakeT);
    wakeT = setTimeout(() => { wakeT = 0; kick(); }, ms);
  }
  function tickStart() {
    ticking = true; last = 0;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    kick();
  }
  function tickStop() {
    ticking = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    if (wakeT) { clearTimeout(wakeT); wakeT = 0; }
  }
  function loop(ts) {
    rafId = 0;
    if (!ticking || document.hidden) return;                // visibilitychange kicks us back
    // Frame-rate cap. It was 15ms, meant as "about 60fps" — but on a 90Hz panel vsyncs are
    // 11ms apart, so skipping anything under 15ms dropped every other frame and animations
    // ran at 45fps. 10ms lets a 90Hz panel run every vsync (90fps) and still halves 120Hz to
    // 60. Idle cost is unaffected: an unchanged screen doesn't request frames at all.
    if (ts - last < 10) { rafId = requestAnimationFrame(loop); return; }
    const dt = ts - last;
    // A settling pipeline shows up as huge or wildly irregular gaps; a live one is ~16ms.
    if (!pipelineSince) pipelineSince = ts;
    if (last > 0 && dt < 60) goodFrames++; else goodFrames = 0;
    L.pipelineReady = goodFrames >= PIPELINE_FRAMES || (ts - pipelineSince) > PIPELINE_GIVEUP;
    last = ts;
    const now = Date.now();
    const t0 = performance.now();
    const f = L.frame(now);
    if (f) {
      R.draw(f, L.palName);
      const dt = performance.now() - t0;
      const load = Math.min(100, Math.max(5, Math.round((dt / 16.6) * 100)));
      emaGpu = emaGpu * 0.85 + load * 0.15;
      // Publish this only a couple of times a second, quantised. It feeds the GPU meter,
      // which is part of the redraw key — updating it every frame made the readout
      // re-trigger its own redraw, pinning an idle home screen at ~40fps forever.
      if (ts - lastGpuPush > 500) {
        lastGpuPush = ts;
        const g = (L.status && L.status.gpu !== undefined) ? L.status.gpu : emaGpu;
        L.gpuLoad = Math.round(g / 4) * 4;
      }
    }
    // Busy frames (key null: morphs, ripples, the visualiser, the boot) run every vsync; an
    // unchanged picture sleeps until it next changes by itself.
    // (A boot or resume still settling is busy by construction — splash or a held morph — so
    // the pipeline check needs no special case here.)
    if (L.lastKey === null) kick();
    else sleepFor(L.nextWakeMs(now));
  }

  // Any assignment of lastKey = null anywhere in the launcher means "redraw", so make it wake
  // the loop. That covers every internal timer and state change without hunting them down.
  let lastKeyV = L.lastKey;
  Object.defineProperty(L, 'lastKey', {
    configurable: true,
    get() { return lastKeyV; },
    set(v) { lastKeyV = v; if (v === null) kick(); }
  });
  // Every call from Android is an event that may change the picture.
  Object.keys(window.ZL).forEach((k) => {
    const fn = window.ZL[k];
    window.ZL[k] = function () { const r = fn.apply(this, arguments); kick(); return r; };
  });
  // And so is every touch or key, before its own handler even runs.
  ['pointerdown', 'pointermove', 'pointerup', 'touchstart', 'touchmove', 'keydown'].forEach((e) =>
    window.addEventListener(e, kick, { passive: true, capture: true }));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) kick(); });

  tickStart();
  // Startup marker: logcat -s ZrnWeb answers "which build's JS is actually live" in one line.
  console.log('ZrnDotMatrix ' + bridge.version() + ' ui up, renderer=' + R.kind +
    ', haptics=' + (N && N.hapticArrange ? 'arrange+sweep' : 'legacy'));
  if (N) {
    const loc = N.location(); if (loc) { const p = loc.split(','); weather(p[0], p[1]); }
    N.ready();
    L.refreshCustomGlyphs(); L.refreshMediaGlyphs(); L.refreshScenes();
    // The model needs the app list to resolve a package to a name, and that build is async —
    // a first pass now would find labels empty and give up, so let it land first.
    setTimeout(() => L.refreshPrediction(true), 1500);
    // The guess drifts with the hour, so re-ask periodically rather than only on resume.
    setInterval(() => L.refreshPrediction(false), 5 * 60 * 1000);
  }
  else L.onApps(bridge.apps());                             // desktop: no native push to wait for
})();
