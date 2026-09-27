// Glue: native bridge, input, weather, frame loop.
(function () {
  'use strict';
  const N = window.ZLNative || null;                       // Android @JavascriptInterface (null in a desktop browser)
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} } };
  const bridge = {
    apps: () => { try { return N ? JSON.parse(N.apps()) : [{ label: 'Chrome', pkg: 'com.android.chrome' }, { label: 'Termux', pkg: 'com.termux' }]; } catch (e) { return []; } },
    launch: (act) => { if (N) N.launch(act); else console.log('launch', act); },
    runTermux: (id, cmd) => { if (N) N.runTermux(id, cmd); else setTimeout(() => window.ZL.onTermux(id, 'demo: ' + cmd, '', 0, ''), 400); },
    is24h: () => (N ? N.is24h() : true),
    savePalette: (n) => store.set('zlPalette', n),
    isPreciseHaptics: () => (N && N.isPreciseHaptics ? N.isPreciseHaptics() : false),
    hapticRipple: () => { if (N && N.hapticRipple) N.hapticRipple(); },
    hapticTransition: () => { if (N && N.hapticTransition) N.hapticTransition(); },
    hapticTick: (s) => { if (N && N.hapticTick) N.hapticTick(s); },
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
        haptics: true, hapticLevel: 'med', agentic: 'agy', amoled: false, speak: false, streamRigel: true, musicApp: 'auto', chatApp: 'auto'
      };
      try {
        return Object.assign(defaults, JSON.parse(store.get('zlConfig') || '{}'));
      } catch (e) {
        return defaults;
      }
    },
    saveConfig: (c) => store.set('zlConfig', JSON.stringify(c))
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
    onAudio(json) { L.onAudio(json); },                     // live FFT from AudioCapture
    onTilt(x, y) { L.onTilt(x, y); },                       // accelerometer, drives RIGEL parallax
    onVoice(text, final) { L.onVoice(text, final); },
    onVoiceLevel(l) { L.onVoiceLevel(l); },
    onVoiceState(st) { L.onVoiceState(st); },
    launchFailed() { L.launchFailed(); },                   // nothing handled the launch intent
    rigelSetupFailed(why) { L.rigelSetupFailed(why); },
    onTermux(id, out, err, code, e) { L.onTermux(id, out, err, code, e); },
    wake() { L.splash(); tickStart(); },                    // screen turned on
    pause() { tickStop(); },                                // activity backgrounded
    resume() { tickStart(); L.resumeHome(); if (L.refreshCustomGlyphs) L.refreshCustomGlyphs(); if (L.refreshMediaGlyphs) L.refreshMediaGlyphs(); },              // back on top: replay the closing morph
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
    holdT = setTimeout(() => { if (down && !down.moved) { down.held = L.hold(down.x, down.y); if (down.held && N && N.haptic) N.haptic(); } }, 600);
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
  // Idempotent on purpose: ZL.pause() is delivered through evaluateJavascript and may not
  // land before the WebView suspends, so resume must always re-arm a live frame request
  // rather than trusting the flag.
  function tickStart() {
    ticking = true; last = 0;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(loop);
  }
  function tickStop() {
    ticking = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }
  function loop(ts) {
    if (!ticking) return;                                   // stopped: do not queue another frame
    rafId = requestAnimationFrame(loop);
    if (document.hidden || ts - last < 16) return;
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
  }
  tickStart();
  if (N) { const loc = N.location(); if (loc) { const p = loc.split(','); weather(p[0], p[1]); } N.ready(); }
})();
