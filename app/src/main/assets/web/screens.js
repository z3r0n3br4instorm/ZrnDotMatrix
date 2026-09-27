// ======================================================================
// ZERONE Launcher — the screens either side of home, plus the guide.
//
//   swipe right  ->  QUICK   (radio toggles)
//   home
//   swipe left   ->  RIGEL   (assistant)
//
// Mixed into Launcher.prototype at the bottom of this file so launcher-core.js
// stays the home/dock/drawer file.
// ======================================================================

// Quick-settings tiles. `cap` is filled in from Bridge.radioCaps(): a tile whose radio the
// OS will not let an app flip is marked so the user knows it opens system settings.
// Labels are kept short on purpose: anything wider than the tile would have to scroll,
// and a scrolling label on a settings tile reads as broken rather than deliberate.
const QUICK_TILES = [
  { id: 'wifi', label: 'WIFI' },
  { id: 'bt', label: 'BT' },
  { id: 'loc', label: 'GPS' },
  { id: 'data', label: 'DATA' }
];

// Guide pages — one screenful each, paged with taps at the bottom.
const GUIDE_PAGES = [
  {
    title: 'GESTURES',
    lines: [
      ['TAP', 'RIPPLE / ACTIVATE'],
      ['HOLD', 'THEME PICKER'],
      ['SWIPE UP', 'APP DRAWER'],
      ['SWIPE RIGHT', 'QUICK SETTINGS'],
      ['SWIPE LEFT', 'RIGEL ASSISTANT'],
      ['3-FINGER UP', 'SETTINGS'],
      ['BACK', 'RETURN HOME']
    ]
  },
  {
    title: 'HOME SCREEN',
    lines: [
      ['TOP LEFT', 'BATTERY SIGNAL'],
      ['', 'WIFI BLUETOOTH'],
      ['TOP RIGHT', 'CLOCK WEATHER'],
      ['MIDDLE', 'LIVE WIDGET'],
      ['DIALPAD', 'OPEN PHONE'],
      ['DOCK', '5 SHORTCUTS'],
      ['CHEVRON', 'APP DRAWER']
    ]
  },
  {
    title: 'MIDDLE WIDGET',
    lines: [
      ['SHOWS ONE OF', ''],
      ['EVENT', 'WIFI BT DATA'],
      ['LOW BATT', 'UNDER 25%'],
      ['FIRE', 'AUDIO SPECTRUM'],
      ['BLUETOOTH', 'BT AUDIO OUT'],
      ['CHARGING', 'PLUGGED IN'],
      ['SYS LOAD', 'CPU GPU RAM']
    ]
  },
  {
    title: 'SETTINGS',
    lines: [
      ['DOCK 1-5', 'PICK EACH APP'],
      ['LAUNCH DELAY', 'ANIMATION TIME'],
      ['TERMUX', 'APP OR MATRIX'],
      ['SYSTEM STATS', 'IDLE WIDGET'],
      ['EVENT BANNERS', 'CONNECT POPUPS'],
      ['HAPTICS', 'OFF LOW MED HIGH'],
      ['', 'REACH: 3-FINGER UP']
    ]
  }
];

// Backends RIGEL can run a turn through. Tapping one on the setup screen selects it and
// installs it — the settings row just mirrors the same choice.
// opencode is parked: it ships glibc-only prebuilt binaries and Termux is Bionic, so the
// binary cannot exec on Android at all. Left visible but disabled rather than removed, so
// the option is discoverable once ZrnMAgent replaces it.
const RIGEL_BACKENDS = [
  // Antigravity CLI on Termux: runs agent loop with tools (bash, files, termux-api)
  { id: 'agy', label: 'ANTIGRAVITY', needsLogin: true, thirdParty: true },
  { id: 'opencode', label: 'OPENCODE', disabled: true, note: 'UNDER DEVELOPMENT' }
];

const RIGEL_GLYPHS = {
  TORCH: [
    '....XXXXX....',
    '...XXXXXXX...',
    '...XXXXXXX...',
    '....XXXXX....',
    '....XXXXX....',
    '.....XXX.....',
    '.....XXX.....',
    '.....XXX.....',
    '.....XXX.....',
    '.....XXX.....',
    '.....XXX.....',
    '....XXXXX....',
    '....XXXXX....'
  ],
  FILE: [
    '..XXXXXXXX...',
    '..X......XX..',
    '..X....XXXX..',
    '..X......XX..',
    '..X.XXXX.XX..',
    '..X......XX..',
    '..X.XXXX.XX..',
    '..X......XX..',
    '..X.XXXX.XX..',
    '..X......XX..',
    '..XXXXXXXXX..'
  ],
  CHECK: [
    '.............',
    '..........XX.',
    '.........XXX.',
    '........XXX..',
    '..XX...XXX...',
    '..XXX.XXX....',
    '...XXXXX.....',
    '....XXX......',
    '.....X.......',
    '.............'
  ],
  SEARCH: [
    '..XXXXXX.....',
    '.XXXXXXXX....',
    'XX......XX...',
    'XX......XX...',
    'XX......XX...',
    '.XXXXXXXX....',
    '..XXXXXX.....',
    '......XXX....',
    '.......XXX...',
    '........XXX..',
    '.........XXX.'
  ],
  GEAR: [
    '....XXXXX....',
    '...XX.X.XX...',
    '.XXX..X..XXX.',
    'XX....X....XX',
    'XXXX.XXX.XXXX',
    '.XXX..X..XXX.',
    '...XX.X.XX...',
    '....XXXXX....'
  ],
  CODE: [
    '.XX.......XX.',
    'XXX.......XXX',
    '.XXX.....XXX.',
    '..XXX...XXX..',
    '...XXX.XXX...',
    '....XXXXX....',
    '...XXX.XXX...',
    '..XXX...XXX..',
    '.XXX.....XXX.',
    'XXX.......XXX',
    '.XX.......XX.'
  ]
};

const FALLBACK_MODELS = [
  { id: 'gemini-3.8-flash-low', name: 'Gemini 3.8 Flash (Low)' },
  { id: 'gemini-3.8-flash-medium', name: 'Gemini 3.8 Flash (Medium)' },
  { id: 'gemini-3.7-flash-low', name: 'Gemini 3.7 Flash (Low)' },
  { id: 'gemini-3.6-flash-low', name: 'Gemini 3.6 Flash (Low)' },
  { id: 'gemini-3.1-pro-high', name: 'Gemini 3.1 Pro (High)' },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6 (Thinking)' },
  { id: 'claude-opus-4-6-thinking', name: 'Claude Opus 4.6 (Thinking)' },
  { id: 'gpt-oss-120b-medium', name: 'GPT-OSS 120B (Medium)' }
];

// Dynamic custom glyphs created by Rigel or loaded from ~/.rigel/custom_glyphs.json
const CUSTOM_GLYPHS = {};

function normalizeGlyphRows(rows) {
  if (!rows) return null;
  let list = [];
  if (Array.isArray(rows)) {
    list = rows.map(r => String(r || ''));
  } else if (typeof rows === 'string') {
    // Can be delimited by newline, comma, slash, or pipe
    if (rows.indexOf('\n') >= 0) list = rows.split('\n');
    else if (rows.indexOf('/') >= 0) list = rows.split('/');
    else if (rows.indexOf('|') >= 0) list = rows.split('|');
    else if (rows.indexOf(',') >= 0) list = rows.split(',');
    else list = [rows];
  } else {
    return null;
  }
  list = list.map(r => r.trim()).filter(r => r.length > 0);
  if (!list.length) return null;
  // Convert each row: active pixels ('X', 'x', '#', '*', '1', '@') become 'X' and others become '.'
  return list.map(row => {
    let out = '';
    for (let i = 0; i < row.length; i++) {
      const c = row[i];
      out += (c === 'X' || c === 'x' || c === '#' || c === '*' || c === '1' || c === '@') ? 'X' : '.';
    }
    return out;
  });
}

function registerCustomGlyph(name, rows) {
  if (!name) return false;
  const k = String(name).toUpperCase().trim().replace(/[^A-Z0-9_\-]/g, '');
  if (!k) return false;
  const norm = normalizeGlyphRows(rows);
  if (!norm || !norm.length) return false;
  CUSTOM_GLYPHS[k] = norm;
  return true;
}

function getRigelGlyph(name) {
  if (!name) return null;
  const k = String(name).toUpperCase().trim();
  // 1. Check custom dynamically generated or loaded glyphs
  if (CUSTOM_GLYPHS[k]) return CUSTOM_GLYPHS[k];
  // 2. Built-in Rigel glyph presets
  if (k === 'FLASHLIGHT' || k === 'TORCH') return RIGEL_GLYPHS.TORCH;
  if (k === 'FILE' || k === 'DOC' || k === 'NOTE') return RIGEL_GLYPHS.FILE;
  if (k === 'CHECK' || k === 'DONE' || k === 'OK') return RIGEL_GLYPHS.CHECK;
  if (k === 'SEARCH' || k === 'WEB' || k === 'LOOKUP') return RIGEL_GLYPHS.SEARCH;
  if (k === 'GEAR' || k === 'TOOL' || k === 'SETTINGS') return RIGEL_GLYPHS.GEAR;
  if (k === 'CODE' || k === 'TERM' || k === 'SCRIPT') return RIGEL_GLYPHS.CODE;
  if (typeof ICONS !== 'undefined') {
    if (k === 'WIFI') return ICONS.wifiBig || ICONS.wifi;
    if (k === 'BT' || k === 'BLUETOOTH') return ICONS.btBig || ICONS.bt;
    if (k === 'MUSIC') return ICONS.music;
    if (k === 'AUDIO') return ICONS.audio;
    if (k === 'BATTERY') return ICONS.battV;
    if (k === 'PHONE' || k === 'CALL') return ICONS.phone;
    if (k === 'CHAT' || k === 'MSG') return ICONS.chat;
    if (ICONS[k.toLowerCase()]) return ICONS[k.toLowerCase()];
  }
  return RIGEL_GLYPHS[k] || null;
}

function parseRigelResponse(raw) {
  if (!raw) return { text: '', glyph: null, glyphDefs: [], scenes: [], sceneOff: [] };
  let str = String(raw).trim();

  // 1. Scenes first, because their bodies are code and must not be run through any of the
  // prose tidying below. [SCENE:name:trigger:target:ttl]<body>[/SCENE] installs one;
  // [SCENE_OFF:name] removes it. The body is either JS or "builtin:<name>".
  const scenes = [];
  const sceneOff = [];
  str = str.replace(/\[SCENE:([A-Za-z0-9_-]+):([A-Za-z0-9_:\- ]+?)(?::(mid|full))?(?::(\d+))?\]([\s\S]*?)\[\/SCENE\]/gi,
    (m, name, trigger, target, ttl, body) => {
      scenes.push({
        name: name, trigger: trigger.trim(), target: (target || 'mid').toLowerCase(),
        ttl: ttl ? +ttl : undefined, body: body.trim()
      });
      return ' ';
    });
  str = str.replace(/\[SCENE_OFF:([A-Za-z0-9_-]+)\]/gi, (m, name) => { sceneOff.push(name); return ' '; });

  // 2. Extract [GLYPH_DEF:<name>:<pattern>] for inline custom glyph creation
  // Example: [GLYPH_DEF:HEART:..XX...XX..,XXXXX.XXXXX,XXXXXXXXXXX,.XXXXXXXXX...,..XXXXXXX....,...XXXXX....,....XXX......,.....X......]
  let glyph = null;
  const glyphDefs = [];
  str = str.replace(/\[GLYPH_DEF:([A-Za-z0-9_-]+):([^\]]+)\]/gi, (m, name, pattern) => {
    const defName = name.toUpperCase();
    if (registerCustomGlyph(defName, pattern)) {
      glyph = defName;
      // Handed back so the caller can write it to ~/.rigel/custom_glyphs.json; a glyph RIGEL
      // invents mid-reply used to vanish on the next restart.
      glyphDefs.push({ name: defName, rows: CUSTOM_GLYPHS[defName] });
    }
    return ' ';
  });

  // 2. Extract [GLYPH:<name>]
  const glyphMatch = str.match(/\[GLYPH:([A-Za-z0-9_-]+)\]/i);
  if (glyphMatch) {
    glyph = glyphMatch[1].toUpperCase();
    str = str.replace(/\[GLYPH:[A-Za-z0-9_-]+\]/gi, '').trim();
  }

  // 3. Strip code fences
  str = str.replace(/```[\s\S]*?```/g, '');

  // 4. Remove inline code backticks
  str = str.replace(/`([^`]+)`/g, '$1');

  // 5. Remove Markdown headers: #, ##, ###
  str = str.replace(/^#{1,6}\s+/gm, '');

  // 6. Remove bold / italics
  str = str.replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, '$1');

  // 7. Remove bullet lists
  str = str.replace(/^[\s]*[-*+]\s+/gm, '');

  // 8. Humanize Linux / Termux file paths: extract basename
  str = str.replace(/\/data\/data\/[a-zA-Z0-9_.]+\/files\/(?:home\/)?([a-zA-Z0-9_.-]+)/g, '$1');
  str = str.replace(/\/home\/[a-zA-Z0-9_.-]+\/([a-zA-Z0-9_.-]+)/g, '$1');
  str = str.replace(/\/(?:sdcard|storage\/emulated\/0)\/([a-zA-Z0-9_.-]+)/g, '$1');
  str = str.replace(/\/[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)+\/?/g, (p) => {
    const parts = p.split('/').filter(Boolean);
    return parts.length ? parts[parts.length - 1] : p;
  });

  // 9. Collapse whitespace
  str = str.replace(/\s+/g, ' ').trim();

  return { text: str, glyph: glyph, glyphDefs: glyphDefs, scenes: scenes, sceneOff: sceneOff };
}


(function () {
  const P = Launcher.prototype;

  // ---------------- navigation ----------------
  // Home sits in the middle of a three-screen strip.
  P.swipe = function (dir) {
    if (this.screen === 'home') {
      this.go(dir > 0 ? 'quick' : 'rigel');
      return;
    }
    // Leave either side screen by swiping back toward home.
    if (this.screen === 'quick' && dir < 0) this.go('home');
    else if (this.screen === 'rigel' && dir > 0) this.go('home');
  };

  P.onTilt = function (x, y) {
    this.tilt = { x: x, y: y };
    if (this.screen === 'rigel') this.lastKey = null;
  };

  // ---------------- quick settings ----------------
  P.radioState = function (id) {
    const st = this.status;
    return id === 'wifi' ? !!st.wifi : id === 'bt' ? !!st.bt : id === 'loc' ? !!st.loc : !!st.data;
  };

  P.drawQuick = function (g, A) {
    if (!this.radioCaps) this.radioCaps = this.bridge.radioCaps ? this.bridge.radioCaps() : {};
    g.text3c('QUICK SETTINGS', 33.5, 12, 1);
    g.hline(5, 62, 20, 3, 2);

    const cols = [18, 49], rows = [46, 92];
    QUICK_TILES.forEach((t, i) => {
      const cx = cols[i % 2], cy = rows[i / 2 | 0];
      const on = this.radioState(t.id);
      const panelOnly = this.radioCaps[t.id] === 'panel';

      g.frame(cx - 14, cy - 17, cx + 14, cy + 17, on ? 1 : 3);
      this.drawRadioGlyph(g, A, t.id, cx, cy - 6, on);
      // label and state share a row: "WIFI ON" reads faster than two stacked lines
      const lab = t.label + '  ' + (on ? 'ON' : 'OFF');
      g.text3fit(lab, cx - 13, cx + 13, cy + 11, on ? 1 : 3, A);

      // A dot in the corner marks the tiles the OS only lets us deep-link to.
      if (panelOnly) { g.set(cx + 12, cy - 15, 3); g.set(cx + 11, cy - 15, 3); }

      this.hits.push([cx - 14, cy - 17, cx + 14, cy + 17, () => {
        if (this.bridge.hapticRipple) this.bridge.hapticRipple();
        const flipped = this.bridge.toggleRadio ? this.bridge.toggleRadio(t.id) : false;
        if (!flipped) this.launchedAway = true;     // a settings panel is taking the screen
        this.nudge(260);
      }]);
    });

  };

  /** Animated when on, static outline when off. */
  P.drawRadioGlyph = function (g, A, id, cx, cy, on) {
    const v = on ? 1 : 3;
    if (id === 'wifi') {
      const bmp = ICONS.wifiBig, w = bmp[0].length;
      // arcs reveal bottom-up so the signal reads as "reaching out"
      const stage = on ? [8, 4, 0, 0][Math.floor(A / 260) % 4] : 0;
      for (let r = stage; r < bmp.length; r++) g.bmp([bmp[r]], cx - (w >> 1), cy - 6 + r, v);
    } else if (id === 'bt') {
      const bmp = ICONS.btBig, w = bmp[0].length;
      g.bmp(bmp, cx - (w >> 1), cy - 7, v);
      if (on) {
        const ring = Math.floor(A / 260) % 3;
        for (let k = 0; k <= ring; k++) {
          const off = 7 + k * 2;
          g.vline(cx - off, cy - 3, cy + 3, 2);
          g.vline(cx + off, cy - 3, cy + 3, 2);
        }
      }
    } else if (id === 'loc') {
      const bmp = ICONS.loc, w = bmp[0].length;
      g.bmp(bmp, cx - (w >> 1), cy - 7, v);
      // the fix itself: centre pip blinks while location is live
      if (!on || A % 900 < 520) { g.set(cx, cy, on ? 2 : 3); g.set(cx, cy - 1, on ? 2 : 3); }
    } else {
      // up / down arrows; the shafts march to show traffic
      const up = on ? Math.floor(A / 160) % 3 : 0;
      const dn = on ? 2 - (Math.floor(A / 160) % 3) : 0;
      g.bmp(['..X..', '.XXX.', 'XXXXX'], cx - 7, cy - 7 + up, v);
      g.vline(cx - 5, cy - 4 + up, cy + 6, v);
      g.bmp(['XXXXX', '.XXX.', '..X..'], cx + 3, cy + 4 - dn, v);
      g.vline(cx + 5, cy - 7, cy + 3 - dn, v);
    }
  };

  // ---------------- guide ----------------
  P.drawGuide = function (g, A) {
    const page = GUIDE_PAGES[this.guidePage % GUIDE_PAGES.length];
    g.text3c('HOW TO USE', 33.5, 11, 3);
    g.text3c(page.title, 33.5, 19, 1);
    g.hline(5, 62, 27, 3, 2);

    page.lines.forEach((ln, i) => {
      const y = 36 + i * 12;
      if (ln[0]) g.text3(ln[0], 5, y, 2, 30);
      if (ln[1]) g.text3(ln[1], 32, y, 1, 62);
    });

    const n = GUIDE_PAGES.length;
    for (let k = 0; k < n; k++) {
      const c = 33 - (n - 1) * 3 + k * 6;
      g.set(c, 128, k === this.guidePage % n ? 1 : 3);
      g.set(c + 1, 128, k === this.guidePage % n ? 1 : 3);
    }
    g.frame(5, 136, 30, 146, 3);
    g.text3c('< BACK', 17.5, 139, 3);
    this.hits.push([5, 136, 30, 146, () => this.go('settings')]);

    g.frame(37, 136, 62, 146, 1);
    g.text3c('NEXT >', 49.5, 139, 1);
    this.hits.push([37, 136, 62, 146, () => { this.guidePage = (this.guidePage + 1) % n; this.nudge(260); }]);
  };

  // ---------------- RIGEL ----------------
  P.rigelTap = function () {
    const now = Date.now();
    // Inside a 1.4s window: 3 taps kill the current run, 4 reopen setup.
    this.rigelTaps = (this.rigelTaps || []).filter((t) => now - t < 1400).concat([now]);
    if (this.rigelTaps.length >= 4) {
      this.rigelTaps = [];
      this.go('rigelsetup');
      return;
    }
    if (this.rigelTaps.length === 3) {
      this.rigelStop();
      return;
    }
    if (this.rigel.state === 'idle') {
      const caps = this.voiceCaps();
      if (!caps.recognition) {
        // Nothing on this device can transcribe — say so rather than pretending to listen.
        this.rigel.note = 'NO SPEECH ENGINE';
      } else if (this.bridge.voiceStart && this.bridge.voiceStart()) {
        this.rigel.state = 'listening';
        this.rigel.heard = '';
        this.rigel.note = '';
      } else {
        this.rigel.note = 'MIC BLOCKED';
      }
    } else if (this.rigel.state === 'listening') {
      if (this.bridge.voiceStop) this.bridge.voiceStop();
      this.rigel.state = 'idle';
    }
    this.rigel.since = now;
    if (this.bridge.hapticRipple) this.bridge.hapticRipple();
    this.lastKey = null;
  };

  // ---------------- voice ----------------
  P.voiceCaps = function () {
    if (!this._vc) this._vc = this.bridge.voiceCaps ? this.bridge.voiceCaps() : {};
    return this._vc;
  };

  P.onVoiceState = function (st) {
    if (st === 'listening') { this.rigel.state = 'listening'; this.rigel.note = ''; }
    else if (st && st.indexOf('error:') === 0) {
      this.rigel.state = 'idle';
      this.rigel.note = st.slice(6);
      this.audioLevel = 0;
    } else if (this.rigel.state === 'listening') {
      this.rigel.state = 'idle';
    }
    this.lastKey = null;
  };

  /** RMS from the recogniser drives the same fire the music widget uses. */
  P.onVoiceLevel = function (l) {
    this.audioLevel = Math.max(0, Math.min(1, l));
    this.lastKey = null;
  };

  P.onVoice = function (text, final) {
    this.rigel.heard = text;
    if (final) {
      this.rigel.state = 'idle';
      this.audioLevel = 0;
      if (text && text.trim()) this.rigelAsk(text.trim());
    }
    this.lastKey = null;
  };

  P.rigelStop = function () {
    this.rigel.state = 'idle';
    this.rigel.busy = false;
    this.rigel.thinking = false;
    this.rigel.callingTool = false;
    this.rigel.spokenIndex = 0;
    this.rigel.note = 'STOPPED';
    this.rigel.since = Date.now();
    if (this.bridge.rigelAbort) this.bridge.rigelAbort();
    if (this.bridge.voiceStop) this.bridge.voiceStop();
    if (this.bridge.voiceShutUp) this.bridge.voiceShutUp();
    if (this.bridge.hapticTransition) this.bridge.hapticTransition();
    this.lastKey = null;
  };

  P.drawRigel = function (g, A) {
    const r = this.rigel;
    // Same clock, date and status column as home — RIGEL is a screen of the launcher, not
    // a separate app, and the old RIGEL/OPENING TERMUX banner just repeated the mark.
    this.drawStatusBar(g, A);

    this.drawRigelMark(g, A, 33.5, 68, 30);

    // Not configured yet: the mark still shows, but the controls become a setup prompt.
    if (r.probe !== 'ready') {
      g.text3fit(this.rigelProbeStale(A) ? 'TERMUX BLOCKED' : r.probe === 'checking' ? 'CHECKING TERMUX...' : 'NOT SET UP YET', 5, 62, 104, 2, A);
      g.frame(14, 112, 53, 126, 1);
      g.text3c('SETUP', 33.5, 116, 1);
      this.hits.push([14, 112, 53, 126, () => this.go('rigelsetup')]);
      return;
    }

    // A reply scrolls above the controls once one has come back.
    if (r.state === 'listening') {
      // Two caption rows so a longer phrase still reads while it is being spoken.
      const said = (r.heard || '').toUpperCase().replace(/\s+/g, ' ');
      if (said) {
        const shown = g.text3tail(said, 5, 62, 96, 1);
        const rest = said.slice(0, said.length - shown.length).trim();
        if (rest) g.text3tail(rest, 5, 62, 89, 3);
      }
    } else if (r.reply) {
      g.marquee3(r.reply.replace(/\s+/g, ' ').toUpperCase(), 5, 62, 96, 1, A, 70);
    }

    // control row: mic -> fire while listening -> knight-rider sweep while working
    const cy = 112;
    if (r.state === 'busy' || r.busy) this.drawSweep(g, A, cy);
    else if (r.state === 'listening') this.drawMicFire(g, A, cy);
    else this.drawMic(g, cy);
    this.hits.push([14, cy - 16, 53, cy + 12, () => this.rigelTap()]);

    // The banner above the mark is gone, so anything RIGEL needs to say (a speech-engine
    // failure, a blocked mic) takes over this line instead of vanishing.
    const isTool = !!r.callingTool;
    const isBusy = r.busy || r.state === 'busy';
    const isThinking = (r.thinking || isBusy) && !isTool;

    const hint = r.note ? r.note
      : r.state === 'listening' ? (r.heard ? 'LISTENING \u00B7 TAP TO SEND' : 'LISTENING')
      : isTool ? 'CALLING TOOL'
      : isThinking ? 'THINKING'
      : 'TAP TO SPEAK';
    g.text3fit(hint, 5, 62, 134, (r.note || isTool) ? 2 : (isThinking ? 1 : 3), A);
  };

  // ---- thinking: a mesh you fly through -------------------------------------------------
  // The old version was one fixed ring of 13 nodes with uniform spokes, redrawn in place: it
  // read as a logo, not as thought. This is a tunnel of nodes at varied sizes, wired to
  // whichever neighbours they happen to land near (so connection lengths differ), projected
  // with perspective while the camera flies forward through it and the far end converges.
  const MESH_N = 110;
  const MESH_DEPTH = 34;            // model units before the tunnel wraps on itself
  const MESH_NODES = [];
  const MESH_EDGES = [];
  (function buildMesh() {
    for (let i = 0; i < MESH_N; i++) {
      // Polar placement: sqrt on the radius spreads nodes evenly over the disc instead of
      // bunching them at the centre, and keeps the tunnel visually centred.
      const ang = hash(i, 11, 3) * 6.28318;
      const rr = Math.sqrt(hash(i, 97, 7)) * 1.75;
      MESH_NODES.push({
        x: Math.cos(ang) * rr,
        y: Math.sin(ang) * rr,
        z: hash(i, 31, 13) * MESH_DEPTH,
        r: 0.3 + hash(i, 41, 17) * 1.0,          // node sizes vary by more than 3x
        f: hash(i, 53, 19) * 6.28                // its own firing phase
      });
    }
    // Reach to the nearest few nodes rather than to a fixed pattern. Whatever distance they
    // happen to sit at is the edge length, which is what stops the mesh looking woven.
    for (let i = 0; i < MESH_N; i++) {
      const a = MESH_NODES[i];
      const near = [];
      for (let j = 0; j < MESH_N; j++) {
        if (j === i) continue;
        const b = MESH_NODES[j];
        let dz = b.z - a.z;
        if (dz > MESH_DEPTH / 2) dz -= MESH_DEPTH;
        if (dz < -MESH_DEPTH / 2) dz += MESH_DEPTH;
        near.push([Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.y - a.y) * (b.y - a.y) + dz * dz), j]);
      }
      near.sort((p, q) => p[0] - q[0]);
      const fan = 1 + Math.floor(hash(i, 67, 23) * 3);      // 1..3 edges out of each node
      for (let k = 0; k < Math.min(fan, near.length); k++) {
        if (near[k][0] > 11) continue;
        MESH_EDGES.push({ a: i, b: near[k][1], s: hash(i, k, 29) });
      }
    }
  })();

  const MESH_NEAR = 2.4;            // closer than this and the node has swept past the camera
  const MESH_FAR = 13;              // the far plane, where the tunnel converges

  /**
   * How far into the thinking state we are, 0..1, advanced on wall clock so entering and
   * leaving both animate instead of cutting. The mesh materialises through it and the resting
   * rings dissolve through its inverse, so the two cross-fade rather than swap.
   */
  P.thinkMix = function (A, want) {
    if (this._mixAt === undefined) { this._mixAt = A; this._mix = want ? 1 : 0; }
    const dt = Math.max(0, Math.min(120, A - this._mixAt));
    this._mixAt = A;
    const target = want ? 1 : 0;
    const rate = dt / 380;                                 // ~0.4s each way
    if (this._mix < target) this._mix = Math.min(target, this._mix + rate);
    else if (this._mix > target) this._mix = Math.max(target, this._mix - rate);
    return this._mix;
  };

  P.drawNeuralNetwork = function (g, A, cx, cy, rad, travel, mix) {
    const m = mix === undefined ? 1 : mix;
    if (m <= 0.02) return;
    const t = this.tilt || { x: 0, y: 0 };
    const tx = travel === undefined ? 5.0 : travel;
    const focal = rad * 0.9;
    const camZ = (A / 1000) * 6.5;                         // forward flight through the tunnel
    // Keep every dot inside the box the caller's widget owns; a node sliding past the camera
    // projects a long way out and must not scribble over the clock or the dock.
    const bc0 = cx - rad * 1.7, bc1 = cx + rad * 1.7;
    const br0 = cy - rad * 1.35, br1 = cy + rad * 1.35;
    const spread = 2.0;

    const pts = [];
    for (let i = 0; i < MESH_N; i++) {
      const n = MESH_NODES[i];
      let z = (n.z - camZ) % MESH_DEPTH;
      if (z < 0) z += MESH_DEPTH;
      if (z < MESH_NEAR || z > MESH_FAR) { pts.push(null); continue; }
      const p = focal / z;
      const depth = 1 - (z - MESH_NEAR) / (MESH_FAR - MESH_NEAR);   // 1 = right in front
      // The mesh grows out of the centre as it materialises, so entering thinking reads as
      // the camera diving in rather than a picture appearing.
      const grow = 0.25 + 0.75 * m;
      pts.push({
        x: cx + (n.x * p * spread) * grow - t.x * tx * depth * 0.5,
        y: cy + (n.y * p * spread) * grow + t.y * tx * depth * 0.4,
        d: depth,
        // Dot size comes from the node's own radius scaled by depth, not by the raw
        // projection — otherwise everything close to the camera becomes a blob.
        r: n.r * (0.35 + depth * 2.0),
        f: n.f,
        z: z
      });
    }

    const inBox = (x, y) => x >= bc0 && x <= bc1 && y >= br0 && y <= br1;

    // Connections first, so nodes sit on top of them.
    for (let e = 0; e < MESH_EDGES.length; e++) {
      const ed = MESH_EDGES[e];
      const p1 = pts[ed.a], p2 = pts[ed.b];
      if (!p1 || !p2) continue;
      if (Math.abs(p1.z - p2.z) > MESH_DEPTH / 3) continue;     // wrapped apart, not a real edge
      if (m < 1 && hash(e, 3, 11) > m) continue;                // materialise edge by edge
      const dx = p2.x - p1.x, dy = p2.y - p1.y;
      const len = Math.hypot(dx, dy);
      // A near node wired to a far one projects as a streak right across the widget, which
      // reads as noise rather than structure. Keep the wiring local on screen.
      if (len < 1 || len > rad * 1.25) continue;
      const depth = (p1.d + p2.d) / 2;
      // Far connections thin out to a dotted trace; near ones are solid.
      const step = depth > 0.55 ? 1 : depth > 0.3 ? 1.7 : 2.6;
      const v = depth > 0.6 ? 3 : 3;
      for (let q = step; q < len; q += step) {
        const u = q / len;
        const x = p1.x + dx * u, y = p1.y + dy * u;
        if (inBox(x, y)) g.set(x, y, v);
      }
      // Signals running the wire — only on some edges, and only when close enough to read.
      if (depth > 0.28) {
        const ph = ((A * (0.00035 + ed.s * 0.0009) + ed.s) % 1);
        const sx = p1.x + dx * ph, sy = p1.y + dy * ph;
        if (inBox(sx, sy)) g.set(sx, sy, depth > 0.62 ? 9 : 5);
        const tp = ph - 0.11;
        if (tp > 0) {
          const ax = p1.x + dx * tp, ay = p1.y + dy * tp;
          if (inBox(ax, ay)) g.set(ax, ay, 5);
        }
      }
    }

    // Nodes: size and brightness both fall off with distance, so the eye reads depth.
    for (let i = 0; i < MESH_N; i++) {
      const q = pts[i];
      if (!q) continue;
      if (m < 1 && hash(i, 7, 5) > m) continue;
      const firing = Math.sin(A / 240 + q.f) > 0.62;
      const v = firing ? 9 : q.d > 0.55 ? 1 : q.d > 0.28 ? 2 : 3;
      if (!inBox(q.x, q.y)) continue;
      g.set(q.x, q.y, v);
      const size = q.r;
      if (size > 0.85) {                                   // mid-distance: a small cross
        if (inBox(q.x - 1, q.y)) g.set(q.x - 1, q.y, firing ? 5 : v);
        if (inBox(q.x + 1, q.y)) g.set(q.x + 1, q.y, firing ? 5 : v);
        if (inBox(q.x, q.y - 1)) g.set(q.x, q.y - 1, firing ? 5 : v);
        if (inBox(q.x, q.y + 1)) g.set(q.x, q.y + 1, firing ? 5 : v);
      }
      if (size > 1.9) {                                    // right in front: a filled blob
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (inBox(q.x + dx, q.y + dy)) g.set(q.x + dx, q.y + dy, firing ? 9 : 1);
          }
        }
      }
    }
  };

  /**
   * The RIGEL mark: orbital rings at rest, the mesh flythrough while thinking, and a real
   * cross-fade between the two — the rings dissolve ring-dot by ring-dot as the mesh
   * materialises, instead of one state cutting to the other on a single frame.
   */
  P.drawRigelMark = function (g, A, cx, cy, rad, travel) {
    const t = this.tilt || { x: 0, y: 0 };
    const breathe = 1 + 0.015 * Math.sin(A / 900);
    const R = rad * breathe;
    const tx = travel === undefined ? 5.0 : travel;
    const isBusy = this.rigel.busy || this.rigel.state === 'busy';
    const isTool = !!this.rigel.callingTool;
    const isThinking = (this.rigel.thinking || isBusy) && !isTool;

    const mix = this.thinkMix(A, isThinking);
    if (mix > 0.02) this.drawNeuralNetwork(g, A, cx, cy, rad, tx, mix);
    if (mix >= 0.98) {
      if (isTool) this.drawCogwheel(g, A, cx, cy);
      return;
    }

    const ringMix = 1 - mix;
    RIGEL_RINGS.forEach((ring, ri) => {
      // depth: 1 for the smallest (front) ring, ~0 for the outermost
      const depth = Math.max(0, Math.min(1, (1.05 - ring.e) / 0.53));
      const ox = -t.x * tx * depth, oy = t.y * tx * 0.6 * depth;
      let v = depth > 0.55 ? 1 : 3;
      const pts = ring.p;
      // One dot per grid cell of arc, so big and small rings look equally dense.
      const want = Math.max(10, Math.min(pts.length, Math.round(ring.per * R)));
      const step = pts.length / want;
      // Rings also pull inward as they go, so they look drawn into the mesh.
      const pull = 0.55 + 0.45 * ringMix;
      for (let k = 0; k < want; k++) {
        if (ringMix < 1 && hash(k, ri, 13) > ringMix) continue;
        const q = pts[Math.floor(k * step)];
        let px = cx + q[0] * R * pull + ox;
        let py = cy + q[1] * R * pull + oy;
        g.set(px, py, v);
      }
    });

    if (isTool) {
      this.drawCogwheel(g, A, cx, cy);
    } else if (this.rigel && this.rigel.currentGlyph && !isThinking) {
      const glyphBmp = getRigelGlyph(this.rigel.currentGlyph);
      if (glyphBmp) {
        const gw = glyphBmp[0].length, gh = glyphBmp.length;
        for (let dy = -10; dy <= 10; dy++) {
          for (let dx = -10; dx <= 10; dx++) {
            if (dx * dx + dy * dy <= 80) g.set(cx + dx, cy + dy, 0);
          }
        }
        g.bmp(glyphBmp, Math.round(cx - gw / 2), Math.round(cy - gh / 2), 1);
      }
    }
  };

  /** Cogwheel drawn over the RIGEL logo when tools are executing. */
  P.drawCogwheel = function (g, A, cx, cy) {
    const rot = (A % 2400) / 2400 * Math.PI * 2;
    const teeth = 6;
    // Circular mask so cogwheel reads clearly against background rings
    for (let dy = -12; dy <= 12; dy++) {
      for (let dx = -12; dx <= 12; dx++) {
        if (dx * dx + dy * dy <= 120) g.set(cx + dx, cy + dy, 0);
      }
    }
    // Rotating gear teeth
    const steps = 60;
    for (let i = 0; i < steps; i++) {
      const ang = (i / steps) * Math.PI * 2 + rot;
      const phase = ((ang * teeth / (Math.PI * 2)) % 1 + 1) % 1;
      const isTooth = phase < 0.42;
      const rad = isTooth ? 10.5 : 7.5;
      g.set(cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad, 1);
      if (isTooth) {
        g.set(cx + Math.cos(ang) * (rad - 1.2), cy + Math.sin(ang) * (rad - 1.2), 1);
      }
    }
    // Inner hub rim
    for (let i = 0; i < 24; i++) {
      const ang = (i / 24) * Math.PI * 2;
      g.set(cx + Math.cos(ang) * 4.5, cy + Math.sin(ang) * 4.5, 2);
    }
    // Center axle dot
    g.set(cx, cy, 1);
  };

  P.drawMic = function (g, cy) {
    g.bmp(['.XXX.', 'X...X', 'X...X', 'X...X', 'X...X', 'X...X', '.XXX.'], 31, cy - 12, 1);
    g.bmp(['X...X', 'X...X', '.XXX.'], 31, cy - 4, 1);    // cradle
    g.vline(33, cy - 1, cy + 3, 1);
    g.hline(30, 36, cy + 4, 1);
  };

  /** Listening: the same fire the music widget uses, so the language stays consistent. */
  P.drawMicFire = function (g, A, cy) {
    const base = cy + 6, maxH = 16, L = 16, R = 51;
    const frame = Math.floor(A / 55);
    const lvl = this.audioLevel || 0;
    for (let c = L; c <= R; c++) {
      const u = (c - L) / (R - L);
      let m = 0.45 + 0.55 * Math.sin(Math.PI * u);
      m *= 0.80 + 0.20 * Math.sin(u * 9 - A * 0.006);
      m *= 0.55 + 0.75 * lvl;
      m += 0.10 * hash(c, frame, 19);
      const h = Math.max(1, Math.min(maxH, Math.round(m * maxH)));
      for (let k = 0; k < h; k++) {
        const tt = k / h;
        let v = tt > 0.72 ? 9 : tt > 0.42 ? (hash(c, k + frame, 23) < 0.4 ? 9 : 5) : tt > 0.14 ? 5 : 1;
        if (tt > 0.30 && hash(c, k, frame) < 0.14) v = 3;
        g.set(c, base - k, v);
      }
    }
  };

  /** Working: a Knight Rider sweep, eased so it lingers at the turns. */
  P.drawSweep = function (g, A, cy) {
    const L = 14, R = 53, span = R - L;
    const u = (A % 1400) / 1400;
    const pos = L + span * (0.5 - 0.5 * Math.cos(u * Math.PI * 2));
    for (let c = L; c <= R; c++) {
      const d = Math.abs(c - pos);
      if (d > 7) { g.set(c, cy, 3); continue; }
      const v = d < 1.6 ? 9 : d < 3.4 ? 2 : 1;
      g.set(c, cy, v);
      if (d < 2.6) { g.set(c, cy - 1, v); g.set(c, cy + 1, v); }
    }
  };
})();

// ======================================================================
// RIGEL setup — drawn on the 2x dot grid (136x304) because it shows model
// names, provider ids and a checklist, none of which fit the home font.
// ======================================================================
(function () {
  const P = Launcher.prototype;

  /** Ask Termux whether ~/.rigel/config.json exists yet. Answer lands in onTermux. */
  P.rigelProbe = function () {
    if (!this.bridge.rigelReady) return;
    this.rigel.probe = 'checking';
    this.rigel.probeAt = Date.now();
    this.rigelProbeId = 'rigelcfg' + Date.now();
    this.bridge.rigelReady(this.rigelProbeId);
    this.rigelPullModels();
    this.lastKey = null;
  };

  P.rigelPullModels = function () {
    if (!this.bridge.rigelModels) return;
    this.rigelModelsId = 'rigelmdl' + Date.now();
    this.bridge.rigelModels(this.rigelModelsId);
  };

  P.rigelReset = function () {
    if (this.bridge.rigelReset) {
      this.bridge.rigelReset('rigelrst' + Date.now());
    }
    this.rigel.heard = '';
    this.rigel.reply = '';
    this.rigel.currentGlyph = null;
    this.rigel.note = 'NEW SESSION STARTED';
    this.rigel.since = Date.now();
    this.lastKey = null;
  };

  P.rigelCycleModel = function (dir) {
    const list = (this.rigel.availableModels && this.rigel.availableModels.length)
      ? this.rigel.availableModels
      : FALLBACK_MODELS;
    const cur = (this.rigel.cfg && this.rigel.cfg.model) || this.rigel.model || 'gemini-3.8-flash-low';
    let idx = list.findIndex(m => m.id === cur);
    if (idx < 0) idx = 0;
    const nextIdx = (idx + dir + list.length) % list.length;
    const next = list[nextIdx].id;
    if (!this.rigel.cfg) this.rigel.cfg = {};
    this.rigel.cfg.model = next;
    this.rigel.model = next;
    if (this.bridge.rigelSetModel) {
      this.bridge.rigelSetModel('rigelsetm' + Date.now(), next);
    }
    if (this.bridge.hapticRipple) this.bridge.hapticRipple();
    this.lastKey = null;
  };

  /**
   * Blocked = Termux told us it will not run the command (allow-external-apps off), or a
   * probe went unanswered long enough that something is wrong at the Termux end.
   */
  P.rigelProbeStale = function (A) {
    if (this.rigel.probe === 'blocked') return true;
    return this.rigel.probe === 'checking' && (A - (this.rigel.probeAt || 0)) > 5000;
  };

  /** Termux replies land here before the terminal screen sees them. */
  P.rigelOnTermux = function (id, stdout, stderr, code, err) {
    if (this.rigelModelsId && id === this.rigelModelsId) {
      this.rigelModelsId = null;
      let list = [];
      const txt = (stdout || '').trim();
      try {
        const parsed = JSON.parse(txt);
        if (Array.isArray(parsed) && parsed.length) list = parsed;
      } catch (e) {
        const clean = txt.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').replace(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]|Fetching available models\.\.\./g, '');
        const lines = clean.split('\n');
        for (const line of lines) {
          const m = line.trim().match(/^([a-z0-9\.\-_]+)\s+(.+)$/i);
          if (m && m[1] && m[2]) {
            list.push({ id: m[1].trim(), name: m[2].trim() });
          }
        }
      }
      if (list.length) {
        this.rigel.availableModels = list;
      }
      this.lastKey = null;
      return true;
    }
    if (id && id.indexOf('rigelrst') === 0) {
      this.rigel.note = 'NEW SESSION STARTED';
      this.lastKey = null;
      return true;
    }
    if (id === this.rigelProbeId) {
      const txt = (stdout || '').trim();
      const errmsg = (err || '').trim();
      this.rigel.cfg = null;
      if (isTermuxRefusal(errmsg) || (!txt && isTermuxRefusal(stderr))) {
        // Termux answers a refused RUN_COMMAND with its own error text rather than
        // staying silent, so this is the reliable signal that allow-external-apps is off.
        this.rigel.probe = 'blocked';
      } else if (!txt || txt.indexOf('NOTSET') >= 0) {
        this.rigel.probe = 'missing';
      } else {
        try { this.rigel.cfg = JSON.parse(txt); this.rigel.probe = 'ready'; }
        catch (e) { this.rigel.probe = 'missing'; }
      }
      this.lastKey = null;
      return true;
    }
    if (this.rigelInstallId && id === this.rigelInstallId) {
      this.rigelInstallId = null;
      this.rigel.installing = false;
      const out = (stdout || stderr || err || '');
      this.rigel.status = '';
      // Only send the user to a login prompt if the binary actually landed and ran.
      const ready = /AGY READY/.test(out) || /LOG IN NEXT/.test(out);
      if (this.rigel.loginAfterInstall && ready && this.bridge.rigelAgySetup) {
        this.rigel.loginAfterInstall = false;
        this.rigel.note = 'SIGN IN THEN TYPE /EXIT';
        this.bridge.rigelAgySetup();
      } else if (this.rigel.loginAfterInstall) {
        this.rigel.loginAfterInstall = false;
        this.rigel.note = out.split('\n').filter(Boolean).pop() || 'INSTALL FAILED';
      }
      this.rigelProbe();                     // re-read config: install may have fallen back
      return true;
    }
    if (this.rigelStatusId && id === this.rigelStatusId) {
      this.rigelStatusId = null;
      const raw = (stdout || '').trim();
      let line = raw;
      let streamText = '';
      if (raw.indexOf('---RIGEL_STREAM---') >= 0) {
        const parts = raw.split('---RIGEL_STREAM---');
        line = parts[0].trim().split('\n').pop() || '';
        streamText = (parts[1] || '').trim();
      } else {
        line = raw.split('\n').pop() || '';
      }

      if (line && line !== 'NONE') {
        this.rigel.status = line;
        if (line.indexOf('TOOL') >= 0) {
          this.rigel.callingTool = true;
          this.rigel.thinking = false;
        } else if (line.indexOf('THINKING') >= 0) {
          this.rigel.callingTool = false;
          this.rigel.thinking = true;
        } else if (line.indexOf('DONE') >= 0 || line.indexOf('IDLE') >= 0) {
          this.rigel.callingTool = false;
          this.rigel.thinking = false;
        }
      }

      // Stream live response tokens if streamRigel is enabled
      if (this.config.streamRigel !== false && streamText) {
        // A scene block that has not closed yet is still code; cut the stream there rather
        // than reading half a program out loud.
        const open = streamText.indexOf('[SCENE:');
        if (open >= 0 && streamText.indexOf('[/SCENE]', open) < 0) streamText = streamText.slice(0, open);
        const parsed = parseRigelResponse(streamText);
        if (parsed.text) {
          this.rigel.reply = parsed.text.slice(-1200);
          this.rigel.thinking = false;
        }
        if (parsed.glyph) {
          this.rigel.currentGlyph = parsed.glyph;
        }

        // Transcribe by buffering the stream for speech
        if (this.config.speak && this.bridge.voiceSpeak && this.rigel.reply) {
          const spokenIdx = this.rigel.spokenIndex || 0;
          const unuttered = this.rigel.reply.slice(spokenIdx);
          const punctMatch = unuttered.search(/[\.\!\?\n]\s+/);
          if (punctMatch !== -1 && punctMatch > 6) {
            const chunk = unuttered.slice(0, punctMatch + 1).trim();
            if (chunk) {
              this.bridge.voiceSpeak(chunk);
              this.rigel.spokenIndex = spokenIdx + punctMatch + 1;
            }
          }
        }
      }

      if (this.rigel.busy) setTimeout(() => this.rigelPollStatus(), 140);
      else if (this.rigel.installing) setTimeout(() => this.rigelPollStatus(), 1500);
      this.lastKey = null;
      return true;
    }
    if (this.rigel.askId && id === this.rigel.askId) {
      this.rigel.busy = false;
      this.rigel.state = 'idle';
      this.rigel.thinking = false;
      this.rigel.callingTool = false;
      const errmsg = (err || '').trim();
      // Only treat as Termux refusal if Termux itself refused execution (err/errmsg).
      // Never block the launcher UI just because the LLM/tool stdout contains the word 'permission'.
      if (errmsg && isTermuxRefusal(errmsg)) {
        this.rigel.probe = 'blocked';
        this.rigel.reply = '';
        this.rigel.note = 'TERMUX BLOCKED';
      } else {
        const out = (stdout || stderr || errmsg || '').trim();
        const parsed = parseRigelResponse(out);
        this.rigel.reply = parsed.text.slice(-1200);
        this.rigel.currentGlyph = parsed.glyph;
        this.rigel.note = this.rigel.reply ? '' : 'NO REPLY';
        this.applyRigelDirectives(parsed);
        // Read it back or flush remaining unuttered speech
        if (this.rigel.reply && this.config.speak && this.bridge.voiceSpeak) {
          const spokenIdx = this.rigel.spokenIndex || 0;
          const remainder = this.rigel.reply.slice(spokenIdx).trim();
          if (remainder) {
            this.bridge.voiceSpeak(remainder.slice(0, 400));
          }
        }
      }
      this.rigel.spokenIndex = 0;
      this.refreshMediaGlyphs();
      this.refreshCustomGlyphs();
      this.rigel.askId = null;
      this.lastKey = null;
      return true;
    }
    if (id && id.indexOf('mediaglyphs') >= 0) {
      try {
        const rawJson = (stdout || '').trim();
        if (rawJson && (rawJson.startsWith('[') || rawJson.startsWith('{'))) {
          this.mediaGlyphs = JSON.parse(rawJson);
        }
      } catch (e) {}
      this.lastKey = null;
      return true;
    }
    if (id && id.indexOf('uiscenes') >= 0) {
      const rawJson = (stdout || '').trim();
      if (rawJson && rawJson.startsWith('[')) this.onScenes(rawJson);
      this.lastKey = null;
      return true;
    }
    if (id && id.indexOf('customglyphs') >= 0) {
      try {
        const rawJson = (stdout || '').trim();
        if (rawJson && (rawJson.startsWith('[') || rawJson.startsWith('{'))) {
          const parsed = JSON.parse(rawJson);
          if (Array.isArray(parsed)) {
            parsed.forEach(item => {
              if (item && item.name && (item.rows || item.pattern)) {
                registerCustomGlyph(item.name, item.rows || item.pattern);
              }
            });
          } else if (typeof parsed === 'object') {
            for (const k in parsed) {
              registerCustomGlyph(k, parsed[k]);
            }
          }
        }
      } catch (e) {}
      this.lastKey = null;
      return true;
    }
    return false;
  };

  /** Termux's refusal text, e.g. "Error Code: `2`" for PLUGIN_EXECUTION_NOT_ALLOWED. */
  function isTermuxRefusal(txt) {
    if (!txt) return false;
    const t = txt.toUpperCase();
    return t.indexOf('PLUGIN_EXECUTION_NOT_ALLOWED') >= 0 ||
           t.indexOf('ALLOW-EXTERNAL-APPS') >= 0 ||
           t.indexOf('ALLOW RUN_COMMAND PERMISSION') >= 0 ||
           (t.indexOf('ERROR CODE: 2') >= 0 || (t.indexOf('ERROR CODE') >= 0 && t.indexOf('NOT ALLOWED') >= 0));
  }

  /** Start the background install and begin polling ~/.rigel/status. */
  P.rigelStartInstall = function (backend) {
    if (!this.bridge.rigelInstall) return;
    this.config.agentic = backend;
    this.bridge.saveConfig(this.config);
    this.rigel.installing = true;
    this.rigel.status = 'STARTING';
    this.rigelInstallId = 'rigelinst' + Date.now();
    this.bridge.rigelInstall(this.rigelInstallId, backend);
    this.rigelPollStatus();
    this.lastKey = null;
  };

  P.rigelPollStatus = function () {
    if ((!this.rigel.installing && !this.rigel.busy) || !this.bridge.rigelStatus) return;
    this.rigelStatusId = 'rigelstat' + Date.now();
    this.bridge.rigelStatus(this.rigelStatusId);
  };

  P.rigelSetupFailed = function (why) {
    this.rigel.probe = 'missing';
    this.rigel.note = why || 'SETUP FAILED';
    this.lastKey = null;
  };

  /** Send one turn through ~/.rigel/bin/rigel-run. */
  P.rigelAsk = function (prompt) {
    if (!this.bridge.rigelAsk || this.rigel.busy) return;
    const id = 'rigelask' + Date.now();
    this.rigel.askId = id;
    this.rigel.busy = true;
    this.rigel.state = 'busy';
    this.rigel.thinking = true;
    this.rigel.callingTool = false;
    this.rigel.spokenIndex = 0;
    this.rigel.note = '';
    this.rigel.reply = '';
    this.bridge.rigelAsk(id, b64(prompt));
    this.rigelPollStatus();
    this.lastKey = null;
  };

  /** Installs whatever RIGEL asked for in a reply: new glyphs, new scenes, removals. */
  P.applyRigelDirectives = function (parsed) {
    if (!parsed) return;
    const changes = (parsed.glyphDefs || []).length + (parsed.scenes || []).length + (parsed.sceneOff || []).length;
    // Bank the current state before RIGEL changes the interface, so settings can walk it back.
    if (changes && this.snapshot) this.snapshot('RIGEL');
    if (parsed.glyphDefs && parsed.glyphDefs.length && this.bridge.saveGlyph) {
      parsed.glyphDefs.forEach((d) => {
        try { this.bridge.saveGlyph(JSON.stringify({ name: d.name, rows: d.rows })); } catch (e) {}
      });
    }
    if (parsed.scenes && parsed.scenes.length && this.addScene) {
      parsed.scenes.forEach((def) => {
        const rec = this.addScene(def, true);
        if (rec && rec.error) this.rigel.note = 'SCENE ' + rec.name + ' ' + rec.error;
        else if (rec && rec.trigger !== 'always') this.rigel.note = 'SCENE ' + rec.name + ' ARMED';
        else if (rec) this.startScene(rec);
      });
    }
    if (parsed.sceneOff && parsed.sceneOff.length && this.removeScene) {
      parsed.sceneOff.forEach((n) => this.removeScene(n));
    }
  };

  /** Glyph table accessors for the state timeline, which has to snapshot and restore them. */
  P.snapshotGlyphs = function () { return JSON.parse(JSON.stringify(CUSTOM_GLYPHS)); };

  P.restoreGlyphs = function (obj) {
    Object.keys(CUSTOM_GLYPHS).forEach((k) => { delete CUSTOM_GLYPHS[k]; });
    if (obj) Object.keys(obj).forEach((k) => registerCustomGlyph(k, obj[k]));
    this.lastKey = null;
  };

  P.refreshMediaGlyphs = function () {
    if (this.bridge && this.bridge.mediaGlyphs) {
      this.bridge.mediaGlyphs('mediaglyphs' + Date.now());
    }
  };

  P.refreshCustomGlyphs = function () {
    if (this.bridge && this.bridge.customGlyphs) {
      this.bridge.customGlyphs('customglyphs' + Date.now());
    }
  };

  P.getMediaGlyph = function (track, artist) {
    if (!this.mediaGlyphs || !this.mediaGlyphs.length) return null;
    const hay = ((track || '') + ' ' + (artist || '')).toLowerCase();
    if (!hay.trim()) return null;
    for (let i = 0; i < this.mediaGlyphs.length; i++) {
      const rule = this.mediaGlyphs[i];
      if (rule && rule.contains && hay.indexOf(rule.contains.toLowerCase()) >= 0) {
        return rule.glyph;
      }
    }
    return null;
  };

  P.drawRigelSetup = function (g, A) {
    const cfg = this.rigel.cfg;
    const probe = this.rigel.probe || 'unknown';
    const blocked = this.rigelProbeStale(A);
    const chosen = this.config.agentic || 'agy';

    g.text3c('RIGEL SETUP', 67.5, 12, 1);
    g.hline(8, 127, 24, 3, 2);

    // ---- state ----
    const curModel = (cfg && cfg.model) || this.rigel.model || 'gemini-3.8-flash-low';
    const isStream = this.config.streamRigel !== false;
    const rows = [
      ['TERMUX', blocked ? 'NOT ACCEPTING' : 'PRESENT'],
      ['STREAMING', isStream ? 'ENABLED' : 'DISABLED'],
      ['MODEL', curModel.toUpperCase().slice(0, 20)],
      ['RUNNING VIA', cfg && cfg.backend ? String(cfg.backend).toUpperCase() : '-']
    ];
    rows.forEach((r, i) => {
      const y = 32 + i * 11;
      g.text3(r[0], 12, y, 3, 62);
      if (r[0] === 'MODEL') {
        const mStr = '< ' + r[1] + ' >';
        const mw = DotGrid.width3(mStr);
        g.text3(mStr, 125 - mw, y, 1);
        this.hits.push([46, y - 2, 85, y + 8, () => this.rigelCycleModel(-1)]);
        this.hits.push([86, y - 2, 128, y + 8, () => this.rigelCycleModel(1)]);
      } else if (r[0] === 'STREAMING') {
        const sStr = '< ' + r[1] + ' >';
        const sw = DotGrid.width3(sStr);
        g.text3(sStr, 125 - sw, y, isStream ? 1 : 3);
        this.hits.push([60, y - 2, 128, y + 8, () => {
          this.config.streamRigel = !isStream;
          this.bridge.saveConfig(this.config);
          this.lastKey = null;
        }]);
      } else {
        const good = r[1] === 'PRESENT' || r[1] === 'STORED' || r[1] === 'ENABLED';
        g.text3(r[1], 125 - DotGrid.width3(r[1]), y, good ? 1 : 2);
      }
    });
    g.hline(8, 127, 92, 3, 2);

    if (blocked) {
      // Termux refuses commands from other apps until the user opts in. That is Termux's
      // own boundary, so the most we can do is hand them the line and open it.
      ['TERMUX IS BLOCKING COMMANDS.', 'TAP BELOW: THE ENABLE LINE IS',
       'COPIED AND TERMUX OPENS. PASTE,', 'ENTER, THEN COME BACK.']
        .forEach((ln, k) => g.text3c(ln, 67.5, 100 + k * 10, 3));
      const uY = 146;
      g.frame(20, uY, 116, uY + 16, 2);
      g.text3c('COPY LINE + OPEN TERMUX', 67.5, uY + 6, 2);
      this.hits.push([20, uY, 116, uY + 16, () => {
        if (this.bridge.hapticTransition) this.bridge.hapticTransition();
        if (this.bridge.copyUnlockCommand) this.bridge.copyUnlockCommand();
        if (this.bridge.openTermuxApp) this.bridge.openTermuxApp();
        this.lastKey = null;
      }]);
    } else if (this.rigel.installing) {
      // Background install: no terminal, just the current step.
      g.text3c('INSTALLING', 67.5, 104, 1);
      g.text3c(this.rigel.status || 'WORKING', 67.5, 116, 2);
      const bx = 24, bw = 88, u = (A % 1600) / 1600;
      g.frame(bx, 130, bx + bw, 140, 3);
      for (let k = 0; k < 14; k++) {
        const c = bx + 2 + ((Math.round(u * bw) + k * 6) % (bw - 3));
        g.vline(c, 132, 138, 1);
      }
      g.text3c('RUNS IN THE BACKGROUND', 67.5, 150, 3);
    } else {
      // ---- backend picker: tapping one selects AND installs it ----
      g.text3c('AGENT BACKEND', 67.5, 98, 3);
      RIGEL_BACKENDS.forEach((b, k) => {
        const y = 107 + k * 23;
        // "SELECTED" tracks the backend the device actually resolved to, not the one that
        // was tapped — an install that could not produce a binary must not look like a win.
        const live = cfg && cfg.backend === b.id;
        const tint = b.disabled ? 3 : live ? 1 : 3;
        g.frame(16, y, 120, y + 17, tint);
        // Label and status on separate rows: side by side they collided as soon as either
        // string grew ("ANTIGRAVITY" + "SET UP + LOG IN" overlap by a dozen columns).
        g.text3(b.label, 24, y + 3, tint);
        const tag = b.disabled ? b.note : live ? 'SELECTED' : b.needsLogin ? 'SET UP + LOG IN' : 'TAP TO USE';
        g.text3(tag, 112 - DotGrid.width3(tag), y + 10, b.disabled ? 3 : live ? 2 : 3);
        if (b.disabled) {
          g.hline(24, 24 + DotGrid.width3(b.label), y + 5, 3);   // struck through
          return;                                                 // no hit target
        }
        this.hits.push([16, y, 120, y + 17, () => {
          if (this.bridge.hapticTransition) this.bridge.hapticTransition();
          this.config.agentic = b.id;
          this.bridge.saveConfig(this.config);
          // Install first, in the background. Antigravity's login is interactive, so
          // Termux opens for that — but only once there is a binary to log in with.
          this.rigel.loginAfterInstall = !!b.needsLogin;
          this.rigelStartInstall(b.id);
        }]);
      });

      // Model Switcher Tile
      const mY = 157;
      g.frame(16, mY, 120, mY + 20, 1);
      g.text3('MODEL', 24, mY + 3, 3);
      g.text3fit(curModel.toUpperCase(), 56, 114, mY + 3, 1, A);
      g.text3c('< TAP TO SWITCH MODEL >', 67.5, mY + 12, 2);
      this.hits.push([16, mY, 120, mY + 20, () => this.rigelCycleModel(1)]);

      // Third-party warning sits with the tiles, not buried in a log.
      if (RIGEL_BACKENDS.some((b) => b.thirdParty && !b.disabled)) {
        g.text3c('ANTIGRAVITY IS PULLED FROM AN', 67.5, 183, 2);
        g.text3c('EXTERNAL COMMUNITY FORK', 67.5, 191, 2);
        g.text3c('GITHUB.COM/WALLENTX', 67.5, 199, 3);
      }

      const kY = 207;
      g.frame(20, kY, 116, kY + 15, cfg && cfg.key ? 3 : 1);
      g.text3c(cfg && cfg.key ? 'CHANGE API KEY' : 'ENTER API KEY', 67.5, kY + 5, cfg && cfg.key ? 3 : 1);
      this.hits.push([20, kY, 116, kY + 15, () => {
        if (this.bridge.hapticTransition) this.bridge.hapticTransition();
        if (this.bridge.rigelSetup) this.bridge.rigelSetup(chosen);
        this.lastKey = null;
      }]);
      g.text3c('KEY ENTRY OPENS TERMUX ONCE', 67.5, 224, 3);
    }

    const reY = 232;
    g.frame(20, reY, 116, reY + 13, 3);
    g.text3c('RE-CHECK', 67.5, reY + 4, 3);
    this.hits.push([20, reY, 116, reY + 13, () => this.rigelProbe()]);

    const doneY = 250;
    g.frame(30, doneY, 106, doneY + 14, 1);
    g.text3c('DONE', 67.5, doneY + 5, 1);
    this.hits.push([30, doneY, 106, doneY + 14, () => this.go('rigel')]);
  };
})();

/** UTF-8 safe base64 — prompts carry punctuation the plain btoa() path rejects. */
function b64(s) {
  const bytes = unescape(encodeURIComponent(String(s)));
  if (typeof btoa === 'function') return btoa(bytes);
  const T = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes.charCodeAt(i), b = bytes.charCodeAt(i + 1), c = bytes.charCodeAt(i + 2);
    out += T[a >> 2] + T[((a & 3) << 4) | (isNaN(b) ? 0 : b >> 4)]
        + (isNaN(b) ? '=' : T[((b & 15) << 2) | (isNaN(c) ? 0 : c >> 6)])
        + (isNaN(c) ? '=' : T[c & 63]);
  }
  return out;
}
