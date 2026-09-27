// RIGEL's interface layer: scenes.
//
// A scene is a small drawing program RIGEL writes because the user asked for something the
// launcher has no button for — "splash water across the screen when I shake the phone",
// "flash the panel when that track comes on". Each one names a trigger, a target area and a
// body, and the body gets the same dot-grid the built-in widgets draw on.
//
// They live in ~/.rigel/ui_scenes.json so they survive a restart, and every one of them runs
// inside a try/catch: a scene that throws is disabled on the spot and named in the UI rather
// than taking the launcher down with it. Settings has a master switch, and the state timeline
// can roll the whole set back.
(function () {
  const P = Launcher.prototype;

  const SCENE_TTL = 6000;            // how long a triggered scene holds the screen by default
  const SCENE_MAX = 24;

  // ---- storage ------------------------------------------------------------------------

  P.sceneState = function () {
    if (!this.scenes) {
      this.scenes = [];              // compiled scene records
      this.sceneActiveList = [];     // currently running: { sc, start, ttl }
      this.sceneShake = 0;           // magnitude of the last shake
      this.sceneShakeAt = 0;
      this.sceneWanted = false;      // is the accelerometer needed
    }
    return this.scenes;
  };

  P.refreshScenes = function () {
    if (this.bridge && this.bridge.uiScenes) this.bridge.uiScenes('uiscenes' + Date.now());
  };

  /** Native push (or a fresh read) of the stored scene list. */
  P.onScenes = function (json) {
    this.sceneState();
    try {
      const list = typeof json === 'string' ? JSON.parse(json) : json;
      if (!Array.isArray(list)) return;
      this.scenes = [];
      list.slice(0, SCENE_MAX).forEach((def) => this.addScene(def, false));
      this.syncShakeSensor();
      this.lastKey = null;
    } catch (e) {}
  };

  /**
   * Compiles one scene definition. `persist` writes it back through the daemon, which is what
   * makes a scene RIGEL invented mid-reply outlive the turn.
   */
  P.addScene = function (def, persist) {
    this.sceneState();
    if (!def || !def.name) return null;
    const rec = {
      name: String(def.name).toUpperCase().trim(),
      trigger: String(def.trigger || 'shake').toLowerCase().trim(),
      target: def.target === 'full' ? 'full' : 'mid',
      ttl: Math.max(400, Math.min(60000, def.ttl ? +def.ttl : SCENE_TTL)),
      body: String(def.body || ''),
      enabled: def.enabled !== false,
      fn: null,
      error: ''
    };
    const builtin = rec.body.trim().toLowerCase();
    if (builtin.indexOf('builtin:') === 0) {
      rec.builtin = builtin.slice(8).trim();
    } else {
      try {
        // Function, not eval: the body sees its api argument and the globals, nothing of the
        // surrounding scope, and a syntax error is caught here rather than at draw time.
        rec.fn = new Function('api', rec.body);
      } catch (e) {
        rec.error = 'SYNTAX';
        rec.enabled = false;
      }
    }
    const at = this.scenes.findIndex((s) => s.name === rec.name);
    if (at >= 0) this.scenes[at] = rec; else this.scenes.push(rec);
    if (persist && this.bridge && this.bridge.saveScene) {
      this.bridge.saveScene(JSON.stringify({
        name: rec.name, trigger: rec.trigger, target: rec.target,
        ttl: rec.ttl, body: rec.body, enabled: rec.enabled
      }));
    }
    this.syncShakeSensor();
    this.lastKey = null;
    return rec;
  };

  P.removeScene = function (name) {
    this.sceneState();
    const key = String(name).toUpperCase().trim();
    this.scenes = this.scenes.filter((s) => s.name !== key);
    this.sceneActiveList = this.sceneActiveList.filter((a) => a.sc.name !== key);
    if (this.bridge && this.bridge.saveScene) {
      this.bridge.saveScene(JSON.stringify({ name: key, remove: true }));
    }
    this.syncShakeSensor();
    this.lastKey = null;
  };

  /** The accelerometer only runs when some enabled scene actually waits on a shake. */
  P.syncShakeSensor = function () {
    const want = this.scenesOn() && this.scenes.some((s) => s.enabled && s.trigger === 'shake');
    if (want === this.sceneWanted) return;
    this.sceneWanted = want;
    if (this.bridge && this.bridge.setShakeWanted) this.bridge.setShakeWanted(want);
  };

  P.scenesOn = function () { return this.config.scenes !== false; };

  // ---- triggers -----------------------------------------------------------------------

  /**
   * `kind` is the event ('shake', 'track', 'charge', 'unplug', 'unlock', 'boot', 'tap'),
   * `arg` is the text a trigger can match against — a track name, for instance.
   */
  P.fireTrigger = function (kind, arg) {
    this.sceneState();
    if (!this.scenesOn()) return;
    const hay = String(arg || '').toUpperCase();
    for (let i = 0; i < this.scenes.length; i++) {
      const sc = this.scenes[i];
      if (!sc.enabled) continue;
      const tr = sc.trigger;
      let hit = false;
      if (tr === kind) hit = true;
      else if (tr.indexOf(kind + ':') === 0) {
        const want = tr.slice(kind.length + 1).trim().toUpperCase();
        hit = want.length > 0 && hay.indexOf(want) >= 0;
      }
      if (hit) this.startScene(sc);
    }
  };

  P.startScene = function (sc) {
    this.sceneState();
    // One run per scene at a time; re-triggering restarts it rather than stacking.
    this.sceneActiveList = this.sceneActiveList.filter((a) => a.sc.name !== sc.name);
    this.sceneActiveList.push({ sc: sc, start: Date.now(), state: {} });
    this.lastKey = null;
  };

  P.stopScenes = function () {
    this.sceneState();
    if (!this.sceneActiveList.length) return;
    this.sceneActiveList = [];
    this.lastKey = null;
  };

  P.onShake = function (mag) {
    this.sceneState();
    this.sceneShake = +mag || 0;
    this.sceneShakeAt = Date.now();
    this.fireTrigger('shake', '');
  };

  /** True while any scene is drawing, so the frame loop knows not to idle. */
  P.sceneBusy = function (A) {
    if (!this.scenes || !this.sceneActiveList.length || !this.scenesOn()) return false;
    const now = A || Date.now();
    this.sceneActiveList = this.sceneActiveList.filter((a) => {
      const ttl = a.sc.trigger === 'always' ? Infinity : a.sc.ttl;
      return now - a.start < ttl;
    });
    return this.sceneActiveList.length > 0;
  };

  P.sceneAt = function (target) {
    if (!this.scenes || !this.sceneActiveList.length || !this.scenesOn()) return null;
    for (let i = this.sceneActiveList.length - 1; i >= 0; i--) {
      if (this.sceneActiveList[i].sc.target === target) return this.sceneActiveList[i];
    }
    return null;
  };

  // ---- the drawing api handed to a scene ------------------------------------------------

  function makeApi(L, g, run, A, box) {
    const sc = run.sc;
    const t = A - run.start;
    const ttl = sc.trigger === 'always' ? 0 : sc.ttl;
    const clamp = (c, r) => c >= box.c0 && c <= box.c1 && r >= box.r0 && r <= box.r1;
    const api = {
      g: g,
      A: A,
      t: t,
      u: ttl ? Math.max(0, Math.min(1, t / ttl)) : 0,
      c0: box.c0, r0: box.r0, c1: box.c1, r1: box.r1,
      w: box.c1 - box.c0 + 1,
      h: box.r1 - box.r0 + 1,
      cx: (box.c0 + box.c1) / 2,
      cy: (box.r0 + box.r1) / 2,
      state: run.state,
      status: L.status,
      tilt: L.tilt || { x: 0, y: 0 },
      shake: (A - L.sceneShakeAt < 400) ? L.sceneShake : 0,
      // Values: 1 = normal, 2 = accent, 3 = dim, 5 = amber, 9 = red, 0 = clear.
      set: (c, r, v) => { if (clamp(c, r)) g.set(c, r, v === undefined ? 1 : v); },
      line: (ca, ra, cb, rb, v) => {
        const steps = Math.max(1, Math.round(Math.max(Math.abs(cb - ca), Math.abs(rb - ra))));
        for (let i = 0; i <= steps; i++) {
          const u = i / steps;
          api.set(ca + (cb - ca) * u, ra + (rb - ra) * u, v);
        }
      },
      rect: (ca, ra, cb, rb, v) => { g.frame(Math.max(box.c0, ca), Math.max(box.r0, ra), Math.min(box.c1, cb), Math.min(box.r1, rb), v === undefined ? 1 : v); },
      disc: (c, r, rad, v) => {
        for (let rr = Math.floor(r - rad); rr <= Math.ceil(r + rad); rr++) {
          for (let cc = Math.floor(c - rad); cc <= Math.ceil(c + rad); cc++) {
            if ((cc - c) * (cc - c) + (rr - r) * (rr - r) <= rad * rad) api.set(cc, rr, v);
          }
        }
      },
      text: (str, c, r, v) => g.text3(String(str).toUpperCase(), c, r, v === undefined ? 1 : v, box.c1),
      textc: (str, r, v) => g.text3c(String(str).toUpperCase(), (box.c0 + box.c1) / 2, r, v === undefined ? 1 : v),
      rnd: (a, b) => hash(a || 0, b || 0, 17),
      ripple: (c, r) => {
        const s = L.sNormal;
        L.ripple((c + s.cOff) * s.pitch + s.ox, r * s.pitch + s.oy);
      },
      haptic: () => { if (L.config.haptics && L.bridge.hapticTick) L.bridge.hapticTick(0.3); },
      done: () => { run.finished = true; }
    };
    return api;
  }

  /**
   * Runs whichever scene owns `target` and draws it into `g`. A throwing scene is switched
   * off permanently (until RIGEL or the user re-enables it) so one bad program cannot wedge
   * every frame from here on.
   */
  P.drawScene = function (g, A, target, box) {
    const run = this.sceneAt(target);
    if (!run) return false;
    const sc = run.sc;
    const api = makeApi(this, g, run, A, box);
    try {
      if (sc.builtin) SCENE_BUILTINS[sc.builtin] ? SCENE_BUILTINS[sc.builtin](api) : null;
      else if (sc.fn) sc.fn(api);
    } catch (e) {
      sc.enabled = false;
      sc.error = String((e && e.message) || e).slice(0, 40).toUpperCase();
      this.sceneActiveList = this.sceneActiveList.filter((a) => a.sc.name !== sc.name);
      if (this.rigel) this.rigel.note = ('SCENE ' + sc.name + ' OFF: ' + sc.error).slice(0, 38);
      this.syncShakeSensor();
      return false;
    }
    if (run.finished) {
      this.sceneActiveList = this.sceneActiveList.filter((a) => a !== run);
    }
    return true;
  };

  // ---- builtins -------------------------------------------------------------------------
  // Shipped so the two things the user asked for by name work the moment RIGEL names them,
  // and so a scene body can be one line instead of a physics engine.

  const SCENE_BUILTINS = {
    /**
     * Shallow-water height field. One column per dot column, integrated with a damped wave
     * equation, sloshed by gravity from the accelerometer and splashed by a shake. Droplets
     * are thrown off crests that move fast enough.
     */
    water: function (api) {
      const st = api.state;
      const n = api.w;
      if (!st.h) {
        st.h = new Float32Array(n);
        st.v = new Float32Array(n);
        st.drops = [];
        // Start it already disturbed, otherwise the first half second is a flat line.
        for (let i = 0; i < n; i++) st.h[i] = Math.sin(i * 0.33) * 3.0 + Math.sin(i * 0.11) * 2.0;
      }
      const h = st.h, v = st.v;
      const rest = api.r0 + api.h * 0.42;
      const tiltX = api.tilt.x || 0;

      // Two integration steps per frame keeps the surface lively at 60fps without the wave
      // speed depending on the frame rate.
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < n; i++) {
          const l = h[i > 0 ? i - 1 : 0];
          const r = h[i < n - 1 ? i + 1 : n - 1];
          // Wave term, a weak restoring force so it settles rather than drifts, gravity from
          // the accelerometer, and a slow travelling swell so the surface never goes glassy.
          v[i] += (l + r - 2 * h[i]) * 0.26
            - h[i] * 0.0012
            + tiltX * 0.16 * ((i / n) - 0.5) * 2
            + Math.sin(api.A / 640 + i * 0.22) * 0.03;
          v[i] *= 0.997;
        }
        const cap = api.h * 0.24;
        for (let i = 0; i < n; i++) {
          h[i] += v[i] * 0.5;
          if (h[i] > cap) { h[i] = cap; v[i] *= -0.4; }
          if (h[i] < -cap) { h[i] = -cap; v[i] *= -0.4; }
        }
      }

      // A shake dumps energy in at a couple of points.
      if (api.shake > 0) {
        const k = Math.floor(api.rnd(Math.floor(api.A / 100), 3) * n);
        for (let d = -3; d <= 3; d++) {
          const i = k + d;
          if (i >= 0 && i < n) v[i] -= (4 - Math.abs(d)) * 1.5;
        }
        for (let q = 0; q < 6; q++) {
          st.drops.push({
            c: api.c0 + k + (api.rnd(q, Math.floor(api.A / 50)) - 0.5) * 8,
            r: rest + h[k] - 2,
            vc: (api.rnd(q, 7) - 0.5) * 1.2,
            vr: -1.4 - api.rnd(q, 11) * 1.2
          });
        }
      }

      // Body, surface, and a little sub-surface texture so it reads as volume not a line.
      for (let i = 0; i < n; i++) {
        const c = api.c0 + i;
        const surf = rest + h[i];
        api.set(c, surf, 1);
        api.set(c, surf - 1, 2);
        for (let r = Math.ceil(surf) + 1; r <= api.r1; r++) {
          const deep = r - surf;
          if (deep < 3 || ((r + i) % (deep < 9 ? 2 : 3) === 0)) api.set(c, r, 3);
        }
      }

      st.drops = st.drops.filter((d) => {
        d.vr += 0.18;
        d.c += d.vc;
        d.r += d.vr;
        const surf = rest + (h[Math.max(0, Math.min(n - 1, Math.round(d.c - api.c0)))] || 0);
        if (d.r >= surf) {
          const i = Math.max(0, Math.min(n - 1, Math.round(d.c - api.c0)));
          v[i] -= 1.2;                                   // splash back in
          return false;
        }
        api.set(d.c, d.r, 2);
        return d.c >= api.c0 && d.c <= api.c1;
      }).slice(-90);
    },

    /** Whole-area strobe, brightest at the start, gone by the end of the scene's ttl. */
    flash: function (api) {
      const k = 1 - api.u;
      const on = Math.floor(api.t / 110) % 2 === 0;
      for (let r = api.r0; r <= api.r1; r++) {
        for (let c = api.c0; c <= api.c1; c++) {
          if (api.rnd(c, r + Math.floor(api.t / 110)) > k) continue;
          api.set(c, r, on ? 1 : 2);
        }
      }
    },

    /** Sparks thrown from the centre — a cheap "something happened" burst. */
    sparks: function (api) {
      const st = api.state;
      if (!st.p) {
        st.p = [];
        for (let i = 0; i < 70; i++) {
          const a = api.rnd(i, 3) * 6.28318;
          const s = 0.4 + api.rnd(i, 9) * 1.6;
          st.p.push({ c: api.cx, r: api.cy, vc: Math.cos(a) * s, vr: Math.sin(a) * s * 0.7 });
        }
      }
      st.p.forEach((q) => {
        q.c += q.vc; q.r += q.vr; q.vr += 0.05; q.vc *= 0.99; q.vr *= 0.99;
        api.set(q.c, q.r, api.u > 0.7 ? 3 : api.u > 0.35 ? 2 : 1);
      });
    }
  };

  P.sceneBuiltins = function () { return Object.keys(SCENE_BUILTINS); };
})();
