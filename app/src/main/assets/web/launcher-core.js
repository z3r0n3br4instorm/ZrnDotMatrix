// ======================================================================
// ZERONE Launcher — core (device build). DOM-free: composes dot layers
// from live data; app.js feeds input and draws with the GPU renderer.
// ======================================================================
const DOCK = [
  { id: 'cam', name: 'CAMERA', c: 4, act: 'camera' },
  { id: 'web', name: 'CHROME', c: 16, act: 'browser' },
  { id: 'term', name: 'TERMUX', c: 28, act: 'terminal' },
  { id: 'chat', name: 'WHATSAPP', c: 40, act: 'pkg:com.whatsapp' },
  { id: 'music', name: 'APPLE MUSIC', c: 52, act: 'pkg:com.apple.android.music' }
];
// Chips on the Termux screen; each runs through Termux's RUN_COMMAND.
const TERM_CMDS = [
  { label: 'UPTIME', cmd: 'uptime -p' },
  { label: 'WHOAMI', cmd: 'whoami' },
  { label: 'LS', cmd: 'ls ~' },
  { label: 'DF', cmd: 'df -h /data | tail -1' },
  { label: 'DATE', cmd: 'date +%H:%M:%S' },
  { label: 'PING', cmd: 'ping -c 3 -W 2 1.1.1.1 | tail -2' },
  { label: 'CLEAR', cmd: null }
];
// Wi-Fi names that mean "at home" / "at work" (edit to taste)
const HOME_SSIDS = [];
const WORK_SSIDS = [];
const COLS = 15;                                        // F3 characters per terminal line
// Padding box for the middle widget. Everything it draws stays inside these columns so
// long strings (SSIDs, "DATA CONNECTED") scroll rather than bleeding to the screen edge.
// Concurrent tap ripples. Was 3, which ate the earliest ring when you tapped quickly;
// ring-band culling in rippleFx made each one cheap enough to raise this.
const HI_SCREENS = ['settings', 'rigelsetup'];   // drawn on the 2x dot grid
const MAX_RIPPLES = 9;
const MID_L = 6;
const MID_R = 61;
// Boot: the home screen assembles out of scattered dots in BOOT_ARRANGE_MS and is live from
// then on. The ZERONE wordmark rides in the middle widget for BOOT_BRAND_MS and then morphs
// away like any other widget change, so branding never holds the whole screen hostage.
const BOOT_ARRANGE_MS = 700;
const BOOT_BRAND_MS = 1700;
// RIGEL's execution backend: Antigravity CLI on Termux by default.
const AGENTIC_BACKENDS = [
  { id: 'agy', label: 'ANTIGRAVITY' },
  { id: 'opencode', label: 'OPENCODE (DEV)' }
];

// Haptic strength steps offered in settings.
const HAPTIC_STEPS = [
  { id: 'off', label: 'OFF', scale: 0 },
  { id: 'low', label: 'LOW', scale: 0.5 },
  { id: 'med', label: 'MEDIUM', scale: 1.0 },
  { id: 'high', label: 'HIGH', scale: 1.6 }
];

// ---- middle event widget glyphs ------------------------------------------
// Solid-arc Wi-Fi, 15x12. The event animation reveals it arc by arc (WIFI_STAGES
// gives the first visible row of each frame), so one bitmap drives the whole loop.
const WIFI_BIG = [
  '....XXXXXXX....',
  '..XXXXXXXXXXX..',
  '.XXX.......XXX.',
  'XX...........XX',
  '...............',
  '....XXXXXXX....',
  '...XXXXXXXXX...',
  '..XX.......XX..',
  '...............',
  '......XXX......',
  '......XXX......',
  '......XXX......'
];
const WIFI_STAGES = [9, 5, 0, 0];

// Mobile data: four bars, 3 wide, bottom-aligned; DATA_STAGES = bars lit per frame.
const DATA_BARS = [[0, 3], [4, 6], [8, 9], [12, 12]];   // [leftCol, height]
const DATA_STAGES = [1, 2, 3, 4];

// Bluetooth rune, 9x13 — the same glyph the status column uses, at widget scale.
const BT_BIG = [
  '....XX...', '....XXX..', '....X.XX.', 'XX..X..XX', '.XX.X.XX.',
  '..XXXXX..', '...XXX...', '..XXXXX..', '.XX.X.XX.', 'XX..X..XX',
  '....X.XX.', '....XXX..', '....XX...'
];

// Low-battery warning triangle, 21x19.
const WARN_TRI = [
  '.........XXX.........',
  '.........XXX.........',
  '........XX.XX........',
  '........XX.XX........',
  '.......XX...XX.......',
  '.......XX...XX.......',
  '......XX.....XX......',
  '......XX.XXX.XX......',
  '.....XX..XXX..XX.....',
  '....XXX..XXX..XXX....',
  '....XX...XXX...XX....',
  '...XX....XXX....XX...',
  '...XX....XXX....XX...',
  '..XX.....XXX.....XX..',
  '..XX.............XX..',
  '.XX......XXX......XX.',
  '.XX......XXX......XX.',
  'XX.................XX',
  'XXXXXXXXXXXXXXXXXXXXX'
];
// Battery thresholds for that warning. At or below WARN it blinks amber; below CRIT
// the whole widget goes red.
const BATT_WARN = 25;
const BATT_CRIT = 15;

// Charging bolt for the middle widget, 11x17 — taller than the 13-row battery shell on
// purpose, so it breaks out above and below it, tapering to a point at each end.
const CHARGE_BOLT = [
  '........X..',
  '.......XX..',
  '......XXX..',
  '.....XXXX..',
  '....XXXX...',
  '...XXXX....',
  '..XXXX.....',
  'XXXXXXXXXX.',
  'XXXXXXXXXXX',
  '.XXXXXXXXXX',
  '......XXXX.',
  '.....XXXX..',
  '....XXXX...',
  '...XXXX....',
  '..XXX......',
  '.XX........',
  'X..........'
];

// Activity lightning bolt icon (shown to the right of battery)
const LIGHTNING_BOLT = [
  '...XX.',
  '..XX..',
  '.XX...',
  'XXXXX.',
  '...XX.',
  '..XX..',
  '.XX...',
  'XX....'
];

// Media player control button bitmaps (5x5)
// |◀ — bar on the left, triangle pointing back at it.
const MEDIA_PREV = [
  'X..X.',
  'X.XX.',
  'XXXX.',
  'X.XX.',
  'X..X.'
];

const MEDIA_PLAY = [
  'X....',
  'XXX..',
  'XXXXX',
  'XXX..',
  'X....'
];

const MEDIA_PAUSE = [
  'XX.XX',
  'XX.XX',
  'XX.XX',
  'XX.XX',
  'XX.XX'
];

// ▶| — triangle pointing at the bar on the right.
const MEDIA_NEXT = [
  '.X..X',
  '.XX.X',
  '.XXXX',
  '.XX.X',
  '.X..X'
];

class Launcher {
  constructor(scr, bridge, scrHi) {
    this.sNormal = scr;
    this.sHi = scrHi || (typeof makeScreen === 'function' ? makeScreen({ w: scr.w, h: scr.h, pitch: scr.pitch / 2, shape: 'rect', radius: 0 }) : scr);
    this.s = scr;
    this.bridge = bridge;
    this.dy = scr.rows - 152;                            // bottom-anchored rows shift on taller/shorter phones
    this.screen = 'splash'; this.t0 = Date.now();
    this.ripples = []; this.hits = []; this.lastCells = []; this.prevCells = []; this.switchAt = 0;
    this.morphMs = 450;                                  // length of the current dot-flight transition
    this.bootHaptic = false;                             // one tick when the dots start arranging
    this.hist = []; this.job = null; this.apps = []; this.drawerTop = 0;
    this.palName = 'Mono';
    this.status = { batt: 100, charging: false, wifi: false, data: false, ssid: '', bt: false, btAudio: false, audio: false, playing: false, track: '', artist: '', signal: 3, alarm: '', cpu: 20, ram: 50 };
    this.weather = { kind: null, temp: null };
    this.lastKey = null;
    this.config = this.bridge.getConfig ? this.bridge.getConfig() : {
      launchDelay: 800, termuxMode: 'app', sysStats: true, eventBanners: true, haptics: true,
      dockCam: 'auto', dockWeb: 'auto', dockTerm: 'auto', dockChat: 'auto', dockMusic: 'auto'
    };
    this.eventQueue = [];
    this.activeEvent = null;
    this.lastWifi = false;
    this.lastBt = false;
    this.lastData = false;
    this.lastPlaying = false;
    this.initialStatusReceived = false;
    this.midCells = [];
    this.midPrevCells = [];
    this.midSwitchAt = 0;
    this.midKindNow = null;                              // which middle widget is on screen
    this.gpuLoad = 15;
    this.audio = null;                                   // live FFT bands from AudioCapture
    this.audioAt = 0;
    this.audioLevel = 0;
    this.audioLive = false;
    this.launchedAway = false;                           // an app is covering us right now
    this.pool = null; this.poolIx = 0; this.midBuf = null;   // reused compose buffers
    this.lastGrid = null; this.lastGridScr = null;
    this.tilt = { x: 0, y: 0 };                          // accelerometer, for the RIGEL parallax
    this.guidePage = 0;
    this.radioCaps = null;                               // filled lazily from the bridge
    this.rigel = { state: 'idle', busy: false, note: '', since: 0, cfg: null, probe: 'unknown', reply: '', askId: null, installing: false, status: '', heard: '' };
    if (this.bridge.setHapticIntensity) this.bridge.setHapticIntensity(this.hapticScale());
  }

  // ---------------- navigation ----------------
  go(screen) {
    this.prevCells = this.cellsSnapshot();
    if (this.bridge.setTiltWanted && (screen === 'rigel') !== (this.screen === 'rigel')) {
      this.bridge.setTiltWanted(screen === 'rigel');     // sensor off everywhere else
    }
    // Entering RIGEL: re-read ~/.rigel/config.json so a setup done in Termux shows at once.
    if ((screen === 'rigel' || screen === 'rigelsetup') && this.rigelProbe) this.rigelProbe();
    this.screen = screen;
    this.switchAt = Date.now();
    this.morphMs = 450;
    this.midKindNow = null;                              // don't double-morph the middle widget
    this.lastKey = null;
    if (this.config.haptics && this.bridge.hapticTransition) this.bridge.hapticTransition();
  }
  /** Short in-place dot flight for changes that stay on the same screen (settings, palette, scroll). */
  nudge(ms) {
    this.prevCells = this.cellsSnapshot();
    this.switchAt = Date.now();
    this.morphMs = ms || 260;
    this.lastKey = null;
  }
  /** Replay the boot sequence: dots re-arrange into home, wordmark greets from the middle slot. */
  splash() {
    this.screen = 'splash';
    this.t0 = Date.now();
    this.ripples = [];
    this.lastKey = null;
    this.bootHaptic = false;
    this.midKindNow = null;                              // the wordmark flies in with the rest
  }

  getApps() {
    if (!this.apps || !this.apps.length) {
      this.apps = (this.bridge.apps ? this.bridge.apps() : []) || [];
    }
    return this.apps;
  }

  // --- Dock shortcuts resolution (Customizable for all 5 slots) ---
  resolveCameraApp() {
    const all = this.getApps();
    const cfg = this.config.dockCam || 'auto';
    if (cfg !== 'auto' && cfg !== 'camera') {
      const found = all.find((a) => a.pkg === cfg);
      if (found) return { name: found.label.toUpperCase().slice(0, 14), act: 'pkg:' + found.pkg, id: 'cam' };
    }
    return { name: 'CAMERA', act: 'camera', id: 'cam' };
  }

  resolveBrowserApp() {
    const all = this.getApps();
    const cfg = this.config.dockWeb || 'auto';
    if (cfg !== 'auto' && cfg !== 'browser') {
      const found = all.find((a) => a.pkg === cfg);
      if (found) return { name: found.label.toUpperCase().slice(0, 14), act: 'pkg:' + found.pkg, id: 'web' };
    }
    const chrome = all.find((a) => a.pkg === 'com.android.chrome');
    if (chrome) return { name: 'CHROME', act: 'pkg:com.android.chrome', id: 'web' };
    return { name: 'BROWSER', act: 'browser', id: 'web' };
  }

  resolveTerminalApp() {
    const all = this.getApps();
    const cfg = this.config.dockTerm || 'auto';
    if (cfg === 'custom' || this.config.termuxMode === 'custom') {
      return { name: 'TERMUX', act: 'terminal', id: 'term' };
    }
    if (cfg !== 'auto' && cfg !== 'termux') {
      const found = all.find((a) => a.pkg === cfg);
      if (found) return { name: found.label.toUpperCase().slice(0, 14), act: 'pkg:' + found.pkg, id: 'term' };
    }
    return { name: 'TERMUX', act: 'pkg:com.termux', id: 'term' };
  }

  resolveChatApp() {
    const all = this.getApps();
    const cfg = this.config.dockChat || this.config.chatApp || 'auto';
    if (cfg !== 'auto') {
      if (cfg === 'native') return { name: 'MESSAGES', act: 'chat', id: 'chat' };
      const found = all.find((a) => a.pkg === cfg);
      if (found) return { name: found.label.toUpperCase().slice(0, 14), act: 'pkg:' + found.pkg, id: 'chat' };
    }
    // Strict priority: 1. normal WhatsApp (com.whatsapp, NEVER WhatsApp Business com.whatsapp.w4b!)
    const wa = all.find((a) => a.pkg === 'com.whatsapp');
    if (wa) return { name: 'WHATSAPP', act: 'pkg:com.whatsapp', id: 'chat' };

    const tg = all.find((a) => a.pkg === 'org.telegram.messenger');
    if (tg) return { name: 'TELEGRAM', act: 'pkg:org.telegram.messenger', id: 'chat' };

    const sig = all.find((a) => a.pkg === 'org.thoughtcrime.securesms');
    if (sig) return { name: 'SIGNAL', act: 'pkg:org.thoughtcrime.securesms', id: 'chat' };

    const msg = all.find((a) => a.pkg === 'com.google.android.apps.messaging' || a.pkg.toLowerCase().includes('messaging'));
    if (msg) return { name: 'MESSAGES', act: 'pkg:' + msg.pkg, id: 'chat' };

    return { name: 'MESSAGES', act: 'chat', id: 'chat' };
  }

  resolveMusicApp() {
    const all = this.getApps();
    const cfg = this.config.dockMusic || this.config.musicApp || 'auto';
    if (cfg !== 'auto') {
      if (cfg === 'native') return { name: 'MUSIC', act: 'music', id: 'music' };
      const found = all.find((a) => a.pkg === cfg);
      if (found) return { name: found.label.toUpperCase().slice(0, 14), act: 'pkg:' + found.pkg, id: 'music' };
    }
    // Auto selection priority: 1. Apple Music, 2. Spotify, 3. Native app / other installed music apps
    const apple = all.find((a) => a.pkg === 'com.apple.android.music');
    if (apple) return { name: 'APPLE MUSIC', act: 'pkg:com.apple.android.music', id: 'music' };

    const spotify = all.find((a) => a.pkg === 'com.spotify.music');
    if (spotify) return { name: 'SPOTIFY', act: 'pkg:com.spotify.music', id: 'music' };

    const other = all.find((a) => 
      a.pkg === 'com.google.android.apps.youtube.music' ||
      a.pkg.toLowerCase().includes('music') ||
      a.label.toLowerCase().includes('music')
    );
    if (other) return { name: other.label.toUpperCase().slice(0, 14), act: 'pkg:' + other.pkg, id: 'music' };

    return { name: 'MUSIC', act: 'music', id: 'music' };
  }

  // --- Candidates lists for Settings cycling ---
  getCameraCandidates() {
    const all = this.getApps();
    const list = [{ id: 'auto', label: 'DEFAULT CAMERA' }];
    all.forEach((a) => {
      if (a.pkg.toLowerCase().includes('camera') || a.label.toLowerCase().includes('camera')) {
        list.push({ id: a.pkg, label: a.label.toUpperCase().slice(0, 16) });
      }
    });
    return list;
  }

  getBrowserCandidates() {
    const all = this.getApps();
    const list = [{ id: 'auto', label: 'DEFAULT BROWSER' }];
    if (all.some((a) => a.pkg === 'com.android.chrome')) list.push({ id: 'com.android.chrome', label: 'CHROME' });
    all.forEach((a) => {
      const p = a.pkg.toLowerCase(), l = a.label.toLowerCase();
      if (a.pkg !== 'com.android.chrome' && (p.includes('browser') || l.includes('browser') || p.includes('firefox') || p.includes('brave') || p.includes('opera'))) {
        list.push({ id: a.pkg, label: a.label.toUpperCase().slice(0, 16) });
      }
    });
    return list;
  }

  getTerminalCandidates() {
    const all = this.getApps();
    const list = [
      { id: 'auto', label: 'TERMUX APP' },
      { id: 'custom', label: 'CUSTOM MATRIX' }
    ];
    all.forEach((a) => {
      const p = a.pkg.toLowerCase(), l = a.label.toLowerCase();
      if (a.pkg !== 'com.termux' && (p.includes('term') || l.includes('term'))) {
        list.push({ id: a.pkg, label: a.label.toUpperCase().slice(0, 16) });
      }
    });
    return list;
  }

  getChatCandidates() {
    const all = this.getApps();
    const list = [{ id: 'auto', label: 'AUTO (WHATSAPP)' }];
    if (all.some((a) => a.pkg === 'com.whatsapp')) list.push({ id: 'com.whatsapp', label: 'WHATSAPP' });
    if (all.some((a) => a.pkg === 'org.telegram.messenger')) list.push({ id: 'org.telegram.messenger', label: 'TELEGRAM' });
    if (all.some((a) => a.pkg === 'org.thoughtcrime.securesms')) list.push({ id: 'org.thoughtcrime.securesms', label: 'SIGNAL' });
    if (all.some((a) => a.pkg === 'com.google.android.apps.messaging')) list.push({ id: 'com.google.android.apps.messaging', label: 'MESSAGES' });
    if (all.some((a) => a.pkg === 'com.whatsapp.w4b')) list.push({ id: 'com.whatsapp.w4b', label: 'WA BUSINESS' });
    list.push({ id: 'native', label: 'NATIVE SMS' });
    return list;
  }

  getMusicCandidates() {
    const all = this.getApps();
    const list = [{ id: 'auto', label: 'AUTO (PRIORITY)' }];
    if (all.some((a) => a.pkg === 'com.apple.android.music')) list.push({ id: 'com.apple.android.music', label: 'APPLE MUSIC' });
    if (all.some((a) => a.pkg === 'com.spotify.music')) list.push({ id: 'com.spotify.music', label: 'SPOTIFY' });
    if (all.some((a) => a.pkg === 'com.google.android.apps.youtube.music')) list.push({ id: 'com.google.android.apps.youtube.music', label: 'YT MUSIC' });
    all.forEach((a) => {
      const p = a.pkg.toLowerCase(), l = a.label.toLowerCase();
      if (a.pkg !== 'com.apple.android.music' && a.pkg !== 'com.spotify.music' && a.pkg !== 'com.google.android.apps.youtube.music') {
        if (p.includes('music') || l.includes('music') || p.includes('audio') || l.includes('player')) {
          if (!list.some((item) => item.id === a.pkg)) {
            list.push({ id: a.pkg, label: a.label.toUpperCase().slice(0, 16) });
          }
        }
      }
    });
    list.push({ id: 'native', label: 'NATIVE MUSIC' });
    return list;
  }

  // --- Display values for Settings rows ---
  getCameraDisplayVal() {
    const cur = this.config.dockCam || 'auto';
    const cands = this.getCameraCandidates();
    const found = cands.find((c) => c.id === cur);
    return found ? found.label : (cur === 'auto' ? 'DEFAULT CAM' : cur.slice(0, 14).toUpperCase());
  }

  getBrowserDisplayVal() {
    const cur = this.config.dockWeb || 'auto';
    const cands = this.getBrowserCandidates();
    const found = cands.find((c) => c.id === cur);
    return found ? found.label : (cur === 'auto' ? 'CHROME' : cur.slice(0, 14).toUpperCase());
  }

  getTerminalDisplayVal() {
    const cur = this.config.dockTerm || (this.config.termuxMode === 'custom' ? 'custom' : 'auto');
    const cands = this.getTerminalCandidates();
    const found = cands.find((c) => c.id === cur);
    return found ? found.label : (cur === 'custom' ? 'CUSTOM MATRIX' : 'TERMUX APP');
  }

  getChatDisplayVal() {
    const cur = this.config.dockChat || this.config.chatApp || 'auto';
    const cands = this.getChatCandidates();
    const found = cands.find((c) => c.id === cur);
    if (found) return found.label;
    if (cur === 'auto') return 'AUTO (WHATSAPP)';
    if (cur === 'native') return 'NATIVE SMS';
    return cur.slice(0, 14).toUpperCase();
  }

  getMusicDisplayVal() {
    const cur = this.config.dockMusic || this.config.musicApp || 'auto';
    const cands = this.getMusicCandidates();
    const found = cands.find((c) => c.id === cur);
    if (found) return found.label;
    if (cur === 'auto') return 'AUTO (PRIORITY)';
    if (cur === 'native') return 'NATIVE MUSIC';
    return cur.slice(0, 14).toUpperCase();
  }

  getDock() {
    const cam = this.resolveCameraApp();
    const web = this.resolveBrowserApp();
    const term = this.resolveTerminalApp();
    const chat = this.resolveChatApp();
    const music = this.resolveMusicApp();
    // Icons taper 9 / 11 / 13 / 11 / 9 outward from the middle. These centres put exactly
    // one blank column between every pair and keep the whole run symmetric about col 33.
    return [
      { id: 'cam', name: cam.name, cx: 9, act: cam.act, hit: [3, 14] },
      { id: 'web', name: web.name, cx: 20, act: web.act, hit: [15, 26] },
      { id: 'term', name: term.name, cx: 33, act: term.act, hit: [27, 39] },
      { id: 'chat', name: chat.name, cx: 46, act: chat.act, hit: [40, 51] },
      { id: 'music', name: music.name, cx: 57, act: music.act, hit: [52, 63] }
    ];
  }
  home() { if (this.screen !== 'home' && this.screen !== 'splash') this.go('home'); else this.ripple(this.s.w / 2, this.s.h / 2); }
  back() { if (this.screen === 'home' || this.screen === 'splash') return false; this.go('home'); return true; }
  ripple(x, y) {
    const now = Date.now();
    this.ripples = this.ripples.filter((q) => now - q.t < 1400).concat([{ x: x, y: y, t: now, s: now % 997 }]).slice(-MAX_RIPPLES);
    this.lastKey = null;
    if (this.config.haptics && this.bridge.hapticRipple) this.bridge.hapticRipple();
  }
  open(act, name) {
    if (act === 'terminal') {
      if (this.config.termuxMode === 'custom') {
        this.go('terminal');
        return;
      }
      act = 'pkg:com.termux';
      name = 'TERMUX';
    }
    this.launching = { name: name, t: Date.now() };
    this.go('launch');
    const delay = this.config.launchDelay !== undefined ? this.config.launchDelay : 800;
    setTimeout(() => {                                   // let the dots animate fully, then launch
      this.launchedAway = true;
      this.bridge.launch(act);
      // The app is coming up over us — stop burning frames on a screen nobody can see.
      if (this.bridge.uiSleep) this.bridge.uiSleep();
    }, delay);
    // No blind recovery timer here. setTimeout keeps running while we are backgrounded, so
    // a timed "go home" would fire seconds into the launched app: it buzzed the haptic,
    // restarted the render loop behind the app, and cleared launchedAway — which is what
    // killed the return animation. A launch that does not take reports itself through
    // launchFailed(); this long stall check only fires if we are demonstrably still on top.
    setTimeout(() => {
      if (this.screen !== 'launch') return;
      if (this.bridge.isForeground && !this.bridge.isForeground()) return;
      this.launchFailed();
    }, delay + 6000);
  }

  /** The launch never took — no handler for it, or it stalled while we stayed on screen. */
  launchFailed() {
    if (this.screen !== 'launch') return;
    this.launchedAway = false;
    this.go('home');
    if (this.bridge.uiWake) this.bridge.uiWake();
  }

  /**
   * Back on the home screen after a launched app closed (home or back). Flies the dots
   * from the last frame we drew — the OPENING screen — into the home layout, so the
   * return reads as the launch animation running backwards.
   */
  resumeHome() {
    // Only an actual app launch rewinds to home. Quick-settings panels and the RIGEL
    // setup session also leave the launcher, but coming back should return you to the
    // screen you left, with its state refreshed.
    if (this.screen === 'quick' || this.screen === 'rigelsetup' || this.screen === 'rigel') {
      this.launchedAway = false;
      if (this.rigelProbe) this.rigelProbe();
      this.lastKey = null;
      return;
    }
    if (this.launchedAway) {
      this.launchedAway = false;
      this.launching = null;
      this.prevCells = this.cellsSnapshot();
      this.screen = 'home';
      this.switchAt = Date.now();
      this.morphMs = 520;
      this.midKindNow = null;
      if (this.config.haptics && this.bridge.hapticTransition) this.bridge.hapticTransition();
    }
    this.lastKey = null;
  }

  // ---------------- status & events ----------------
  onStatus(json) {
    try {
      const s = typeof json === 'string' ? JSON.parse(json) : json;
      if (this.initialStatusReceived) {
        // Titles are kept short on purpose: drawEventWidget centres them inside the
        // widget's padding box and anything longer would scroll instead of sitting still.
        if (s.wifi && !this.lastWifi) {
          this.enqueueEvent({ type: 'wifi', title: 'WIFI CONNECTED', sub: (s.ssid || 'CONNECTED').toUpperCase() });
        }
        if (s.bt && !this.lastBt) {
          this.enqueueEvent({ type: 'bt', title: 'BT CONNECTED', sub: 'BLUETOOTH' });
        }
        if (s.data && !this.lastData && !s.wifi) {
          this.enqueueEvent({ type: 'data', title: 'DATA CONNECTED', sub: 'MOBILE DATA' });
        }
      } else {
        this.initialStatusReceived = true;
      }
      this.lastWifi = !!s.wifi;
      this.lastBt = !!s.bt;
      this.lastData = !!s.data;
      this.lastPlaying = !!s.playing;
      Object.assign(this.status, s);
      this.lastKey = null;
    } catch (e) {}
  }

  /** Live spectrum from AudioCapture (Visualizer on the output mix). */
  onAudio(json) {
    try {
      const a = typeof json === 'string' ? JSON.parse(json) : json;
      if (!a) return;
      this.audioLive = !!a.live;
      if (a.live && a.b && a.b.length) {
        this.audio = a.b;
        this.audioAt = Date.now();
        this.audioLevel = (a.lvl || 0) / 100;
      } else {
        this.audio = null;
        this.audioLevel = 0;
      }
      this.lastKey = null;
    } catch (e) {}
  }

  enqueueEvent(ev) {
    if (!this.config.eventBanners) return;
    if (this.eventQueue.some((e) => e.type === ev.type) || (this.activeEvent && this.activeEvent.type === ev.type)) return;
    this.eventQueue.push(ev);
    this.lastKey = null;
  }

  // ---------------- haptics ----------------
  agenticStep() {
    const id = this.config.agentic || 'agy';
    return AGENTIC_BACKENDS.find((b) => b.id === id || (b.id === 'agy' && id === 'antigravity')) || AGENTIC_BACKENDS[0];
  }

  hapticStep() {
    const id = this.config.haptics === false ? 'off' : (this.config.hapticLevel || 'med');
    return HAPTIC_STEPS.find((s) => s.id === id) || HAPTIC_STEPS[2];
  }
  hapticScale() { return this.hapticStep().scale; }
  cycleHaptics() {
    const i = HAPTIC_STEPS.indexOf(this.hapticStep());
    const next = HAPTIC_STEPS[(i + 1) % HAPTIC_STEPS.length];
    this.config.hapticLevel = next.id;
    this.config.haptics = next.id !== 'off';             // legacy flag the rest of the UI reads
    if (this.bridge.setHapticIntensity) this.bridge.setHapticIntensity(next.scale);
    // let the user feel the step they just picked
    if (next.scale > 0 && this.bridge.hapticTick) this.bridge.hapticTick(0.45);
  }

  openSettings() {
    if (this.screen === 'settings') return;
    this.go('settings');
  }

  testEvents() {
    this.eventQueue = [
      { type: 'wifi', title: 'CONNECTED TO WIFI', sub: 'ZERONE_5G' },
      { type: 'bt', title: 'BT CONNECTED', sub: 'HEADSET' },
      { type: 'data', title: 'CONNECTED TO DATA', sub: 'LTE NETWORK' }
    ];
    this.go('home');
  }

  toggleDemoPlay() {
    this.status.playing = !this.status.playing;
    if (this.status.playing && !this.status.track) {
      this.status.track = 'NEON HORIZON';
      this.status.artist = 'SYNTHWAVE';
    }
    this.lastKey = null;                                 // drawHome morphs on the widget-kind change
  }

  // ---------------- terminal ----------------
  wrap(text) {
    const out = [];
    String(text).toUpperCase().replace(/\t/g, ' ').split('\n').forEach((ln) => {
      ln = ln.replace(/\s+$/, '');
      if (!ln) return;
      for (let i = 0; i < ln.length; i += COLS) out.push(ln.slice(i, i + COLS));
    });
    return out;
  }
  run(c) {
    if (this.job) return;
    if (!c.cmd) { this.hist = []; this.lastKey = null; return; }
    const id = 'j' + Date.now();
    this.job = { id: id, label: c.label, t: Date.now(), out: null };
    this.bridge.runTermux(id, c.cmd);
  }
  onTermux(id, stdout, stderr, code, err) {
    // RIGEL shares the RUN_COMMAND channel; claim its ids before the terminal screen does.
    if (this.rigelOnTermux && this.rigelOnTermux(id, stdout, stderr, code, err)) return;
    if (!this.job || this.job.id !== id) return;
    let out = this.wrap(stdout || '');
    if (stderr) out = out.concat(this.wrap(stderr));
    if (err) out = out.concat(this.wrap(err));
    if (!out.length) out = [code === 0 ? 'OK' : 'EXIT ' + code];
    this.job.out = out.slice(0, 40); this.job.done = Date.now();
  }

  // ---------------- context ----------------
  context(A) {
    const st = this.status, h = new Date(A).getHours();
    if (st.audio) return { glyph: 'audio', title: 'HEADPHONES', sub: st.bt ? 'BT CONNECTED' : 'WIRED' };
    if ((h >= 22 || h < 6) && st.alarm) return { glyph: 'night', title: 'BEDTIME', sub: 'ALARM ' + st.alarm };
    if (st.wifi && WORK_SSIDS.indexOf(st.ssid) >= 0) return { glyph: 'work', title: 'AT WORK', sub: st.ssid.toUpperCase().slice(0, 15) };
    if (st.wifi && (HOME_SSIDS.indexOf(st.ssid) >= 0 || !HOME_SSIDS.length)) return { glyph: 'home', title: HOME_SSIDS.length ? 'AT HOME' : 'ON WIFI', sub: (st.ssid || 'CONNECTED').toUpperCase().slice(0, 15) };
    if (st.wifi) return { glyph: 'work', title: 'ON WIFI', sub: (st.ssid || 'CONNECTED').toUpperCase().slice(0, 15) };
    return { glyph: 'commute', title: 'ON THE MOVE', sub: 'MOBILE DATA' };
  }

  // ---------------- frame ----------------
  // Returns null when nothing on screen changed (the caller skips the draw).
  frame(A) {
    // Process event queue — the morph itself is driven by the widget-kind change in drawHome.
    if (this.activeEvent && A - this.activeEvent.start >= this.activeEvent.dur) {
      this.activeEvent = null;
      this.lastKey = null;
    }
    if (!this.activeEvent && this.eventQueue.length > 0) {
      this.activeEvent = this.eventQueue.shift();
      this.activeEvent.start = A;
      this.activeEvent.dur = 3200;
      this.lastKey = null;
    }

    const s = HI_SCREENS.indexOf(this.screen) >= 0 ? this.sHi : this.sNormal;
    this.s = s;
    const t = A - this.t0;
    const arranging = this.screen === 'splash' || t < BOOT_ARRANGE_MS;
    const switching = A - this.switchAt < this.morphMs;
    const midSwitching = (this.screen === 'home') && (A - this.midSwitchAt < 380);
    const live = this.ripples.filter((q) => A - q.t < 1300);
    // t < BOOT_BRAND_MS keeps frames coming through the wordmark's sweep and, crucially,
    // through the frame where midKind flips off 'boot' and starts the morph out of it.
    const busy = arranging || t < BOOT_BRAND_MS || switching || midSwitching || live.length || !!this.activeEvent ||
      !!this.status.playing || this.battWarn() || (this.rigel && this.rigel.busy) || (this.job && (!this.job.out || A - this.job.done < COLS * 70 * 3));
    // A ripple that has just expired leaves transient sparks in the last drawn frame. The
    // redraw key does not change when they go, so without this the stale ripple stays
    // burned on screen until something else happens to invalidate the key.
    if (this.hadRipples && !live.length) { this.hadRipples = false; this.lastKey = null; }
    if (live.length) this.hadRipples = true;

    const key = busy ? null : this.keyFor(A);
    if (key !== null && key === this.lastKey) return null;
    this.lastKey = key;

    // AMOLED: the ghost field is a dot lit on *every* pixel of the panel, so switching it
    // off is what actually buys black. Bloom stays — it is the look, and it only lights
    // pixels that are already on.
    const amoled = !!this.config.amoled;
    let all, ghostOp = amoled ? 0 : 0.09, bloomOp = 0.7;
    this.hits = [];
    if (arranging) {
      // Straight from scatter into the finished home screen — no full-screen logo stop on the
      // way. The wordmark is part of that home frame (composeMiddle draws it), so it arrives
      // on the same dot flight as the clock and the dock.
      if (this.screen === 'splash') this.screen = 'home';
      if (!this.bootHaptic) {
        this.bootHaptic = true;
        if (this.config.haptics && this.bridge.hapticTransition) this.bridge.hapticTransition();
      }
      const home = this.compose('home', A).cells();
      const u = Math.min(1, t / BOOT_ARRANGE_MS);
      all = morph(scatter(s, home.length, 4), home, u, 1);
      ghostOp = amoled ? 0 : 0.02 + 0.07 * u;
      bloomOp = 0.35 + 0.35 * u;
      this.hits = [];                                    // nothing is tappable mid-flight
    } else {
      const g = this.compose(this.screen, A);
      // Steady state — no morph, no ripple — is the overwhelmingly common frame. Hand the
      // grid buffer straight to the renderer instead of expanding it into dot objects and
      // splitting it into layers; that alone was most of the per-frame cost.
      if (!switching && !this.ripples.length) {
        this.lastGrid = g.g; this.lastGridScr = s; this.lastCells = null;
        return { grid: g.g, gridScr: s, layers: null, ghostPts: null, ghostOp: ghostOp, bloomOp: bloomOp, faceOp: 1, pitch: s.pitch };
      }
      all = g.cells();
      this.lastCells = all; this.lastGrid = null;
      if (switching) all = morph(this.prevCells, all, (A - this.switchAt) / this.morphMs, 5);
    }
    let L = splitLayers(all), ghostExtra = [], sparks = [];
    const fx = rippleFx(s, this.ripples, A);
    if (fx) {
      L = { main: fx.bend(L.main), acc: fx.bend(L.acc), dim: fx.bend(L.dim), pal: fx.bend(L.pal) };
      const gh = fx.ghosts(); ghostExtra = gh.moved; sparks = gh.sparks;
    }
    L.acc = L.acc.concat(sparks);
    return { layers: L, ghostPts: ghostExtra.length ? ghostExtra : null, ghostOp: ghostOp, bloomOp: bloomOp, faceOp: 1, pitch: s.pitch };
  }

  /** The last drawn frame as dots, for seeding a morph. Materialised only when a
   *  transition actually starts, so the steady-state path never builds the list. */
  cellsSnapshot() {
    if (this.lastCells) return this.lastCells;
    if (this.lastGrid) { this.lastCells = gridToCells(this.lastGrid, this.lastGridScr); return this.lastCells; }
    return [];
  }

  keyFor(A) {
    const d = new Date(A), st = this.status, w = this.weather;
    const k = [this.screen, this.palName, d.getHours(), d.getMinutes()];
    if (this.screen === 'home') {
      k.push(d.getMilliseconds() < 500, Math.floor(A / 350) % 2, st.batt, st.charging, st.charging ? Math.floor(A / 120) : 0,
        st.wifi, st.bt, st.data, st.audio, st.playing, st.track, st.artist, st.signal, st.ssid, st.alarm, w.kind, w.temp,
        st.cpu, st.ram, this.gpuLoad, Math.floor(A / 230) % 4, !!this.activeEvent, this.eventQueue.length,
        this.battWarn() && A % 1000 < 620,               // low-battery blink phase
        Math.floor(A / 530) % 2);                        // dock terminal cursor blink
    }
    else if (this.screen === 'terminal') k.push(Math.floor(A / 530) % 2, this.hist.length, !!this.job);
    else if (this.screen === 'drawer') k.push(this.drawerTop, this.apps.length);
    else if (this.screen === 'launch') return null;
    else if (this.screen === 'menu') k.push(this.palName, !!this.config.amoled);
    else if (this.screen === 'settings') k.push(JSON.stringify(this.config));
    else if (this.screen === 'quick') {
      k.push(st.wifi, st.bt, st.data, st.loc, Math.floor(A / 160) % 3, Math.floor(A / 260) % 4, A % 900 < 520);
    }
    else if (this.screen === 'guide') k.push(this.guidePage);
    else if (this.screen === 'rigel') return null;        // parallax + sweep animate every frame
    else if (this.screen === 'rigelsetup') {
      if (this.rigel.installing) return null;          // progress bar animates every frame
      k.push(JSON.stringify(this.rigel.cfg), this.rigel.probe, this.config.agentic, this.rigelProbeStale(A));
    }
    return k.join('|');
  }

  compose(screen, A) {
    // Setup shows a key, a model name and a checklist — all small type, so it borrows the
    // settings sheet's 2x dot density instead of the 68-column home grid.
    const s = HI_SCREENS.indexOf(screen) >= 0 ? this.sHi : this.sNormal;
    // Double-buffered: the renderer's fast path keeps a reference to the frame it just
    // drew (to seed a morph), so this frame must not scribble over it.
    const n = s.cols * s.rows;
    if (!this.pool || this.pool[0].length !== n) this.pool = [new Uint8Array(n), new Uint8Array(n)];
    this.poolIx = this.poolIx ^ 1;
    const g = new DotGrid(s, this.pool[this.poolIx]);
    if (screen === 'home') this.drawHome(g, A);
    else if (screen === 'terminal') this.drawTerminal(g, A);
    else if (screen === 'drawer') this.drawDrawer(g);
    else if (screen === 'launch') this.drawLaunch(g, A);
    else if (screen === 'menu') this.drawMenu(g);
    else if (screen === 'settings') this.drawSettings(g);
    else if (screen === 'quick') this.drawQuick(g, A);
    else if (screen === 'guide') this.drawGuide(g, A);
    else if (screen === 'rigel') this.drawRigel(g, A);
    else if (screen === 'rigelsetup') this.drawRigelSetup(g, A);
    return g;
  }

  // ---------------- input ----------------
  tap(x, y) {
    const A = Date.now();
    if (A - this.t0 < BOOT_ARRANGE_MS) return;            // dots still in flight, no targets yet
    this.ripple(x, y);
    const s = HI_SCREENS.indexOf(this.screen) >= 0 ? this.sHi : this.sNormal;
    const c = (x - s.ox) / s.pitch - s.cOff, r = (y - s.oy) / s.pitch;   // back to design columns
    const hit = this.hits.find((h) => c >= h[0] - 0.5 && c <= h[2] + 0.5 && r >= h[1] - 0.5 && r <= h[3] + 0.5);
    if (hit) hit[4]();
  }
  hold(x, y) {
    const s = HI_SCREENS.indexOf(this.screen) >= 0 ? this.sHi : this.sNormal;
    const c = (x - s.ox) / s.pitch - s.cOff, r = (y - s.oy) / s.pitch;

    // RIGEL screen: holding the logo starts a new session or dismisses if busy
    if (this.screen === 'rigel') {
      const dist = Math.hypot(c - 33.5, r - 68);
      if (dist <= 26) {
        if (this.rigel && (this.rigel.busy || this.rigel.state === 'listening')) {
          this.rigelStop();
          if (this.bridge.voiceStop) this.bridge.voiceStop();
          this.rigel.note = 'DISMISSED';
        } else {
          this.rigelReset();
        }
        if (this.bridge.hapticRipple) this.bridge.hapticRipple();
        this.ripple(x, y);
        this.lastKey = null;
        return true;
      }
    }

    // HOME screen: holding the middle widget activates mini-Rigel, or dismisses if already active
    if (this.screen === 'home') {
      const inMid = c >= (MID_L - 2) && c <= (MID_R + 2) && r >= 48 && r <= 108;
      if (inMid) {
        if (this.rigel && (this.rigel.activeMini || this.rigel.busy || this.rigel.state === 'listening')) {
          // Dismiss mini-Rigel
          this.rigelStop();
          if (this.bridge.voiceStop) this.bridge.voiceStop();
          this.rigel.activeMini = false;
          this.rigel.note = 'DISMISSED';
          if (this.bridge.hapticTransition) this.bridge.hapticTransition();
          this.ripple(x, y);
          this.lastKey = null;
          return true;
        } else {
          // Activate mini-Rigel in middle widget!
          if (!this.rigel) this.rigel = { state: 'idle' };
          this.rigel.activeMini = true;
          this.rigel.heard = '';
          this.rigel.reply = '';
          this.rigel.currentGlyph = null;
          this.rigel.note = 'LISTENING';
          const caps = this.voiceCaps ? this.voiceCaps() : {};
          if (caps.recognition === false) {
            this.rigel.note = 'NO SPEECH ENGINE';
          } else if (this.bridge.voiceStart && this.bridge.voiceStart()) {
            this.rigel.state = 'listening';
          } else {
            this.rigel.note = 'MIC BLOCKED';
          }
          if (this.bridge.hapticRipple) this.bridge.hapticRipple();
          this.ripple(x, y);
          this.lastKey = null;
          return true;
        }
      }
      this.go('menu');
      this.ripple(x, y);
      return true;
    }

    if (this.screen === 'menu') { this.go('home'); return true; }
    if (this.screen === 'terminal') { this.bridge.launch('pkg:com.termux'); return true; }
    return false;
  }
  drag(dyPx) {                                          // drawer scrolling
    if (this.screen !== 'drawer') return;
    const rowsPer = 7, maxTop = Math.max(0, this.apps.length - this.drawerRows());
    const next = Math.max(0, Math.min(maxTop, this.drawerTop - dyPx / (this.s.pitch * rowsPer)));
    if (Math.round(next) !== Math.round(this.drawerTop)) this.lastKey = null;
    this.drawerTop = next;
  }
  drawerRows() { return Math.floor((this.s.rows - 30) / 7); }

  // ---------------- screens ----------------
  /**
   * Boot greeting, drawn inside the middle widget's band: ZERONE wordmark, product name and
   * version, with a light bar sweeping across the letters — the one part of the old
   * full-screen splash worth keeping. cy is the row the widget centres on.
   */
  drawBootMark(g, A, cy) {
    const top = cy - 12;                                 // 7-row wordmark, then two text lines
    const u = Math.min(1, (A - this.t0) / BOOT_BRAND_MS);
    const sweep = MID_L - 8 + u * (MID_R - MID_L + 18);
    ZERONE.forEach((Lg, i) => {
      const c0 = 10 + i * 8;                             // 6 glyphs, 47 columns, centred on 33.5
      for (let r = 0; r < Lg.length; r++) {
        for (let c = 0; c < Lg[r].length; c++) {
          if (Lg[r][c] !== 'X') continue;
          g.set(c0 + c, top + r, Math.abs(c0 + c - sweep) < 2.5 ? 2 : 1);
        }
      }
    });
    g.text3c('ZrnDotMatrix', 33.5, top + 10, 1);
    const ver = this.bridge.version ? this.bridge.version() : 'v0.2.1.dev.1';
    g.text3c(ver, 33.5, top + 17, 3);
  }

  /**
   * Clock, date, weather and the left status column — shared by home and RIGEL so the two
   * screens read as the same device rather than as separate apps.
   */
  drawStatusBar(g, A) {
    const d = new Date(A), H = d.getHours(), M = d.getMinutes(), st = this.status;
    const fr = (ms) => Math.floor(A / ms) % 2;
    const h24 = this.bridge.is24h();
    const hh = h24 ? String(H).padStart(2, '0') : String(H % 12 || 12).padStart(2, ' ');
    const mm = String(M).padStart(2, '0');
    [[hh[0], 25], [hh[1], 34], [mm[0], 47], [mm[1], 56]].forEach(([ch, c]) => g.bmp(B7[ch], c, 13, 1));
    if (d.getMilliseconds() < 500) { g.bmp(['XX', 'XX'], 43, 15, 1); g.bmp(['XX', 'XX'], 43, 20, 1); }
    const date = DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONS[d.getMonth()];
    g.text3(date, 63 - DotGrid.width3(date), 27, 3);
    const w = this.weather;
    if (w.temp !== null) {
      const wi = { Sun: fr(700) ? ICON.sunB : ICON.sunA, Cloud: fr(1100) ? ICON.cloudB : ICON.cloudA, Rain: fr(260) ? ICON.rainB : ICON.rainA }[w.kind];
      const ts = Math.round(w.temp) + '\u00B0C', tw = DotGrid.width3(ts);
      g.text3(ts, 63 - tw, 34, 1);
      if (wi) g.bmp(wi, 63 - tw - 9, 34, 1);
    }

    const battTint = st.charging ? 1 : st.batt < BATT_CRIT ? 9 : st.batt <= BATT_WARN ? 5 : 1;
    g.bmp(ICONS.battV, 5, 13, battTint);
    const lvl = Math.max(1, Math.round(st.batt / 100 * 6));
    for (let k = 0; k < lvl; k++) g.hline(6, 8, 20 - k, battTint);
    if (st.charging && this.midKind(A) !== 'charge') g.bmp(LIGHTNING_BOLT, 12, 13, 9);
    [2, 3, 4, 5].forEach((h, k) => g.vline(4 + k * 2, 30 - h, 29, k < st.signal ? 1 : 3));
    g.bmp(ICONS.wifi, 4, 33, st.wifi ? 1 : 3);
    g.bmp(ICONS.bt, 5, 40, st.bt ? 1 : 3);
  }

  drawHome(g, A) {
    const st = this.status, dy = this.dy;
    const fr = (ms) => Math.floor(A / ms) % 2;
    this.drawStatusBar(g, A);

    // Song name and artist below clock & weather with marquee scrolling
    if (st.playing) {
      const songName = (st.track || 'AUDIO PLAYBACK').toUpperCase();
      const artistName = (st.artist || '').toUpperCase();
      const mediaText = artistName ? songName + ' \u2022 ' + artistName : songName;
      g.marquee3(mediaText, 17, 63, 41, 1, A, 55);
    }

    // ---- middle widget, centred in the space the chrome leaves it ----
    const kind = this.midKind(A);
    const py = 118 + dy;                                 // phone-circle centre
    const ctrlY = py - 16;                               // media transport row
    const midTop = 50;                                   // first row clear of the status column
    const midBot = st.playing ? ctrlY - 4 : py - 12;     // last row clear of the controls / phone
    // Centred in that band, but never riding up into the status icons on a short screen.
    const midY = Math.max(midTop + 17, Math.round((midTop + midBot) / 2));

    if (this.midKindNow !== null && kind !== this.midKindNow) {
      this.midPrevCells = this.midCells;
      this.midSwitchAt = A;
      if (this.config.haptics && this.bridge.hapticTransition) this.bridge.hapticTransition();
    }
    this.midKindNow = kind;

    let midTarget = this.composeMiddle(A, midY, midBot, ctrlY);
    if (A - this.midSwitchAt < 380 && this.midPrevCells.length) {
      const u = (A - this.midSwitchAt) / 380;
      midTarget = morphGrid(this.midPrevCells, midTarget, u, 7);
    }
    this.midCells = midTarget;
    midTarget.forEach((pt) => g.set(pt.c, pt.r, pt.v));

    if (this.rigel && (this.rigel.activeMini || this.rigel.busy || this.rigel.state === 'listening')) {
      this.hits.push([MID_L, midTop, MID_R, midBot, () => {
        if (this.rigel.state === 'listening') {
          if (this.bridge.voiceStop) this.bridge.voiceStop();
        }
      }]);
    }

    // Transport glyphs are drawn by composeMiddle so they morph with the widget; only the
    // touch targets live here.
    if (st.playing) {
      this.hits.push([16, ctrlY - 2, 26, ctrlY + 8, () => {
        if (this.bridge.hapticRipple) this.bridge.hapticRipple();
        this.bridge.mediaPrev();
      }]);
      this.hits.push([28, ctrlY - 2, 38, ctrlY + 8, () => {
        if (this.bridge.hapticRipple) this.bridge.hapticRipple();
        this.bridge.mediaPlayPause();
      }]);
      this.hits.push([40, ctrlY - 2, 50, ctrlY + 8, () => {
        if (this.bridge.hapticRipple) this.bridge.hapticRipple();
        this.bridge.mediaNext();
      }]);
    }

    g.bmp2(ICONS.phone, 28, py - 5, 1);                  // dialpad, no ring around it
    this.hits.push([23, py - 10, 43, py + 10, () => this.open('dial', 'PHONE')]);
    // Dock: icon sizes taper out from the middle (11 / 9 / 7). Slots are spaced by their
    // CENTRES, and each glyph is centred in its slot both ways, so the optical gaps stay
    // even no matter which size sits where. Touch targets are uniform regardless of size.
    const dockMid = 137 + dy;
    this.getDock().forEach((a) => {
      const ic = ICONS[a.id], w = ic[0].length, h = ic.length;
      const ix = a.cx - (w >> 1), iy = dockMid - (h >> 1);
      g.bmp2(ic, ix, iy, 1);
      // Live prompt: the terminal tile blinks its cursor on the same 530ms cadence as the
      // Termux screen, rather than carrying a dead one baked into the bitmap.
      if (a.id === 'term' && fr(530)) g.hline(ix + 6, ix + 9, iy + 10, 2);
      // Touch targets tile the row edge to edge regardless of glyph size, so the small
      // outer icons are no harder to hit than the big middle one.
      this.hits.push([a.hit[0], 130 + dy, a.hit[1], 144 + dy, () => this.open(a.act, a.name)]);
    });
    if (!fr(530)) g.hline(34, 36, 140 + dy, 0);
    g.hline(4, 63, 145 + dy, 3, 2);
    g.bmp(['..X..', '.X.X.', 'X...X'], 31, 147 + dy, 3);
    this.hits.push([24, 146 + dy, 43, this.s.rows - 1, () => { this.apps = this.bridge.apps(); this.go('drawer'); }]);
  }

  /** True while the battery needs the user's attention (and isn't already on charge). */
  battWarn() { return !this.status.charging && this.status.batt <= BATT_WARN; }

  /**
   * Which widget owns the middle slot right now — a change here drives the dot morph.
   * Playback outranks charging: the phone is on a charger most evenings and that must not
   * cost you the visualiser. A critically flat battery still outranks everything, and the
   * playing flag is folded in so the transport always morphs, even under an event banner.
   */
  midKind(A) {
    const p = this.status.playing ? '+p' : '';
    if (A - this.t0 < BOOT_BRAND_MS) return 'boot';       // outranks everything: it is only ~1.7s
    if (this.rigel && (this.rigel.busy || this.rigel.activeMini || this.rigel.state === 'listening')) return 'rigel' + p;
    if (this.activeEvent) return 'ev:' + this.activeEvent.type + p;
    if (!this.status.charging && this.status.batt < BATT_CRIT) return 'lowbatt' + p;
    if (this.status.playing) return this.status.btAudio ? 'btaudio' : 'wave';
    if (this.status.charging) return 'charge';
    if (this.battWarn()) return 'lowbatt';
    if (this.config.sysStats) return 'sys';
    return 'ctx:' + this.context(A).glyph;
  }

  // cy = the row every widget centres on; bottom = last row it may touch (the fire sits on
  // it); ctrlY = the transport row, which rides along so it morphs with the widget.
  composeMiddle(A, cy, bottom, ctrlY) {
    const n = this.s.cols * this.s.rows;
    if (!this.midBuf || this.midBuf.length !== n) this.midBuf = new Uint8Array(n);
    const g = new DotGrid(this.s, this.midBuf);
    if (A - this.t0 < BOOT_BRAND_MS) {
      this.drawBootMark(g, A, cy);
    } else if (this.rigel && (this.rigel.busy || this.rigel.activeMini || this.rigel.state === 'listening')) {
      const isTool = !!this.rigel.callingTool;
      const isBusy = this.rigel.busy || this.rigel.state === 'busy';
      const isListening = this.rigel.state === 'listening';

      if (isListening) {
        // Send listening canvas ripples periodically
        if (A - (this._lastListenRipple || 0) > 750) {
          this._lastListenRipple = A;
          const px = (33.5 + this.sNormal.cOff) * this.sNormal.pitch + this.sNormal.ox;
          const py = (cy - 7) * this.sNormal.pitch + this.sNormal.oy;
          this.ripple(px, py);
        }
        // Draw the mini Rigel mark
        this.drawRigelMark(g, A, 33.5, cy - 7, 13, 2.0);
        const said = (this.rigel.heard || 'LISTENING...').toUpperCase();
        g.text3fit(said, MID_L, MID_R, cy + 11, 1, A);
        g.text3fit('HOLD TO DISMISS', MID_L, MID_R, cy + 18, 3, A);
      } else if (isBusy) {
        this.drawRigelMark(g, A, 33.5, cy - 7, 13, 2.0);
        const busyTxt = isTool ? 'CALLING TOOL' : 'THINKING...';
        g.text3fit(busyTxt, MID_L, MID_R, cy + 11, isTool ? 2 : 1, A);
        g.text3fit('HOLD TO DISMISS', MID_L, MID_R, cy + 18, 3, A);
      } else if (this.rigel.currentGlyph) {
        const glyphBmp = typeof getRigelGlyph === 'function' ? getRigelGlyph(this.rigel.currentGlyph) : null;
        if (glyphBmp) {
          const gw = glyphBmp[0].length, gh = glyphBmp.length;
          g.bmp(glyphBmp, Math.round(33.5 - gw / 2), cy - 13, 1);
        } else {
          this.drawRigelMark(g, A, 33.5, cy - 7, 11, 1.5);
        }
        const rep = (this.rigel.reply || 'DONE').toUpperCase();
        g.marquee3(rep, MID_L, MID_R, cy + 11, 1, A, 65);
        g.text3fit('HOLD TO DISMISS', MID_L, MID_R, cy + 18, 3, A);
      } else {
        this.drawRigelMark(g, A, 33.5, cy - 7, 13, 2.0);
        if (this.rigel.reply) {
          g.marquee3(this.rigel.reply.toUpperCase(), MID_L, MID_R, cy + 11, 1, A, 65);
        } else {
          g.text3fit('RIGEL READY', MID_L, MID_R, cy + 11, 1, A);
        }
        g.text3fit('HOLD TO DISMISS', MID_L, MID_R, cy + 18, 3, A);
      }
    } else if (this.activeEvent) {
      this.drawEventWidget(g, A, this.activeEvent, cy);
    } else if (!this.status.charging && this.status.batt < BATT_CRIT) {
      this.drawLowBattery(g, A, cy);
    } else if (this.status.playing && this.status.btAudio) {
      this.drawBtAudio(g, A, cy);
    } else if (this.status.playing) {
      this.drawWave(g, A, bottom);
    } else if (this.status.charging) {
      this.drawCharging(g, A, cy);
    } else if (this.battWarn()) {
      this.drawLowBattery(g, A, cy);
    } else if (this.config.sysStats) {
      this.drawSystemStats(g, A, cy);
    } else {
      const ctx = this.context(A), gl = ICONS[ctx.glyph], gh = gl.length, gw = gl[0].length;
      const top = cy - Math.round((gh + 16) / 2);
      g.bmp2(gl, Math.round(33.5 - gw / 2), top, 1);
      g.text3fit(ctx.title, MID_L, MID_R, top + gh + 4, 1, A);
      g.text3fit(ctx.sub, MID_L, MID_R, top + gh + 11, 3, A);
    }
    // The transport belongs to this layer, not the page chrome, so it flies in and out on
    // the same dot morph as everything else instead of a bespoke fade.
    if (this.status.playing) {
      g.bmp(MEDIA_PREV, 20, ctrlY, 1);
      g.bmp(MEDIA_PAUSE, 31, ctrlY, 2);
      g.bmp(MEDIA_NEXT, 43, ctrlY, 1);
    }
    return g.gridCells();
  }

  /**
   * Live audio fire: every column burns from the baseline up to a height driven by that
   * band's magnitude from AudioCapture, so the whole body is lit rather than just a crest.
   * White-hot at the base, accent through the middle, red at the tips, with flicker and
   * embers on top. Anchored to `bottom` so the flame always sits on the media transport.
   * Falls back to a synthetic spectrum when the Visualizer has no data.
   */
  drawWave(g, A, bottom) {
    const maxH = 30;
    const base = bottom;                                 // flame sits on this row
    const bands = this.audioBands(A);
    const nb = bands.length;
    const frame = Math.floor(A / 55);

    const customGlyph = typeof this.getMediaGlyph === 'function' ? this.getMediaGlyph(this.status.track, this.status.artist) : null;
    const glyphBmp = customGlyph && typeof getRigelGlyph === 'function' ? getRigelGlyph(customGlyph) : null;
    if (glyphBmp) {
      const gw = glyphBmp[0].length, gh = glyphBmp.length;
      g.bmp(glyphBmp, Math.round(33.5 - gw / 2), base - maxH - 18, 1);
      g.text3fit(this.audioLive ? 'NOW PLAYING' : 'NO AUDIO TAP', MID_L, MID_R, base - maxH - 6, 3, A);
    } else {
      g.text3fit(this.audioLive ? 'NOW PLAYING' : 'NO AUDIO TAP', MID_L, MID_R, base - maxH - 7, 3, A);
    }

    const span = MID_R - MID_L;
    for (let c = MID_L; c <= MID_R; c++) {
      const u = (c - MID_L) / span;
      // spectrum sample, linearly interpolated between bands
      const f = u * (nb - 1), i0 = Math.floor(f), i1 = Math.min(nb - 1, i0 + 1);
      let m = bands[i0] + (bands[i1] - bands[i0]) * (f - i0);
      m *= 0.55 + 0.45 * Math.sin(Math.PI * u);          // shoulders lower than the middle
      // licking motion, so the crest moves even on a steady tone
      m *= 0.86 + 0.14 * Math.sin(u * 9.0 - A * 0.006);
      m += 0.10 * hash(c, frame, 19);                    // per-column flicker

      const h = Math.max(1, Math.min(maxH, Math.round(m * maxH)));
      for (let k = 0; k < h; k++) {
        const r = base - k;
        const t = k / h;                                 // 0 at the base, 1 at the tip
        // White → amber → red. Deliberately fixed colours rather than main/accent: in the
        // Mono palette accent is #FF3B30, near-identical to the red tips, which flattened
        // the whole flame into one slab.
        let v;
        if (t > 0.72) v = 9;                             // red tips
        else if (t > 0.42) v = hash(c, k + frame, 23) < 0.40 ? 9 : 5;
        else if (t > 0.14) v = 5;                        // amber body
        else v = 1;                                      // white hot at the base
        // burn holes through the body so it reads as flame, not a solid block
        if (t > 0.30 && hash(c, k, frame) < 0.14) v = 3;
        g.set(c, r, v);
      }
      // embers drifting off the tip
      if (hash(c, frame, 41) < 0.14 * m) g.set(c, base - h - 1 - Math.floor(hash(c, frame, 43) * 3), 9);
    }

    // occasional red scanline tear across the flame
    if (hash(frame, 3, 17) < 0.22 + 0.28 * this.audioLevel) {
      const gc = MID_L + Math.floor(hash(frame, 7, 23) * (span - 8));
      const gr = base - 2 - Math.floor(hash(frame, 11, 29) * (maxH - 4));
      const len = 4 + Math.floor(hash(frame, 13, 31) * 7);
      for (let k = 0; k < len; k++) g.set(gc + k, gr, 9);
    }
  }

  /**
   * Playing out over Bluetooth. A2DP offload bypasses the AudioFlinger mix, so the
   * Visualizer tap reads silence and there is no honest spectrum to draw — show the
   * Bluetooth rune with waves propagating out of it either side instead.
   */
  drawBtAudio(g, A, cy) {
    const cx = 33, gcy = cy - 8;                         // glyph centre; text hangs below
    g.bmp(BT_BIG, cx - Math.floor(BT_BIG[0].length / 2), gcy - Math.floor(BT_BIG.length / 2), 1);

    // three arcs leaving the glyph on both sides, each restarting as it fades out.
    // They start clear of the 9x13 rune so the two never tangle.
    const phase = (A % 1200) / 1200;
    for (let k = 0; k < 3; k++) {
      const f = (phase + k / 3) % 1;                     // 0 just off the glyph, 1 fully out
      const R = 10 + f * 7;
      const v = f > 0.75 ? 3 : f < 0.2 ? 1 : 2;
      // wider sweep up close, narrower far out, so even the inner arc reads as a curve
      const spread = 46 - 14 * f;
      for (let a = -spread; a <= spread; a += 2) {       // 2° keeps the arc unbroken at R=17
        const rad = a * Math.PI / 180;
        const dx = Math.cos(rad) * R, dy = Math.sin(rad) * R;
        g.set(cx + dx, gcy + dy, v);
        g.set(cx - dx, gcy + dy, v);
      }
    }

    g.text3fit('BLUETOOTH', MID_L, MID_R, gcy + 15, 1, A);
    g.text3fit('STREAMING', MID_L, MID_R, gcy + 22, 3, A);
  }

  /** Spectrum in 0..1, from the Visualizer when it is fresh, synthetic otherwise. */
  audioBands(A) {
    const n = 22, out = new Array(n);
    if (this.audio && A - this.audioAt < 500) {
      const src = this.audio, ls = src.length - 1;
      for (let i = 0; i < n; i++) {
        const f = (i / (n - 1)) * ls, i0 = Math.floor(f), i1 = Math.min(ls, i0 + 1);
        out[i] = Math.min(1, (src[i0] + (src[i1] - src[i0]) * (f - i0)) / 100);
      }
      return out;
    }
    for (let i = 0; i < n; i++) {
      const f1 = Math.sin(A * 0.0031 + i * 0.70);
      const f2 = Math.sin(A * 0.0057 - i * 0.33);
      const f3 = Math.cos(A * 0.0091 + i * 1.21);
      out[i] = Math.min(1, Math.abs(f1 * 0.45 + f2 * 0.33 + f3 * 0.22) * 0.9 + 0.08);
    }
    return out;
  }

  // 28 rows total: 12-13 for the glyph, then title and sub, centred on cy.
  drawEventWidget(g, A, ev, cy) {
    const top = cy - 14;
    if (ev.type === 'wifi') {
      const from = WIFI_STAGES[Math.floor(A / 240) % WIFI_STAGES.length];
      for (let r = from; r < WIFI_BIG.length; r++) g.bmp([WIFI_BIG[r]], 26, top + r, 1);
    } else if (ev.type === 'data') {
      const lit = DATA_STAGES[Math.floor(A / 240) % DATA_STAGES.length];
      DATA_BARS.forEach(([c, h], i) => {
        if (i >= lit) return;
        for (let k = 0; k < 3; k++) g.vline(26 + c + k, top + 12 - h, top + 11, 1);
      });
    } else if (ev.type === 'bt') {
      g.bmp(BT_BIG, 29, top, 1);
      const ring = Math.floor(A / 240) % 3;              // pulse radiating off both sides
      for (let k = 0; k <= ring; k++) {
        const off = 2 + k * 2;
        g.vline(28 - off, top + 4, top + 8, 3);
        g.vline(38 + off, top + 4, top + 8, 3);
      }
    }
    g.text3fit(ev.title, MID_L, MID_R, top + 16, 1, A);
    g.text3fit(ev.sub, MID_L, MID_R, top + 23, 3, A);
  }

  /**
   * Blinking /!\ when the battery is low. Amber at or below BATT_WARN; below BATT_CRIT
   * the triangle and both text lines turn red. Blink dips to dim rather than off, so the
   * glyph never disappears from the grid.
   */
  drawLowBattery(g, A, cy) {
    const st = this.status;
    const crit = st.batt < BATT_CRIT;
    const tint = crit ? 9 : 5;                           // 9 = red, 5 = amber
    const on = A % 1000 < 620;                           // ~1 Hz blink
    const top = cy - 17;                                 // 19-row glyph + two text lines = 35 rows

    g.bmp(WARN_TRI, 23, top, on ? tint : 3);
    g.text3fit(crit ? 'BATTERY CRITICAL' : 'BATTERY LOW', MID_L, MID_R, top + 23, crit ? 9 : tint, A);
    g.text3fit(st.batt + '% REMAINING', MID_L, MID_R, top + 30, crit ? 9 : 3, A);
  }

  drawCharging(g, A, cy) {
    const st = this.status;
    const top = cy - 13;                                 // shell rows top..top+12, bolt top-2..top+14
    const bx = 22;
    g.frame(bx, top, bx + 21, top + 12, 1);
    g.vline(bx + 22, top + 4, top + 8, 1);
    g.vline(bx + 23, top + 4, top + 8, 1);
    const have = Math.max(1, Math.round(st.batt / 100 * 18));
    const fill = Math.min(18, have + Math.floor(A / 120) % (19 - have + 4));
    for (let c = 0; c < 18; c++) {
      for (let r = top + 2; r <= top + 10; r++) {
        g.set(bx + 2 + c, r, c < have ? 1 : c < fill ? 3 : 0);
      }
    }
    g.bmp(CHARGE_BOLT, 27, top - 2, 9);                  // breaks out of the shell top and bottom
    g.text3fit('CHARGING', MID_L, MID_R, top + 18, 1, A);
    g.text3fit(st.batt >= 100 ? 'FULL' : 'PLUGGED IN ' + st.batt + '%', MID_L, MID_R, top + 25, 3, A);
  }

  // Label + meter only. The numeric readout used to collide with the label at three
  // digits, and the bar already carries the value.
  drawSystemStats(g, A, cy) {
    const top = cy - 17;                                 // title + 3 rows, 34 rows tall
    const rows = [
      ['CPU', this.status.cpu],
      ['GPU', this.gpuLoad],
      ['RAM', this.status.ram]
    ];
    g.text3fit('SYSTEM LOAD', MID_L, MID_R, top, 3, A);
    rows.forEach(([label, raw], i) => {
      const pct = Math.max(0, Math.min(100, Math.round(raw === undefined ? 0 : raw)));
      const y = top + 11 + i * 9;
      g.text3(label, MID_L, y, 1, MID_L + 11);           // 'CPU' is exactly 11 columns wide
      this.drawMeterBar(g, MID_L + 15, y, MID_R, y + 4, pct);
    });
  }

  drawMeterBar(g, x1, y1, x2, y2, pct) {
    g.frame(x1, y1, x2, y2, 3);
    const width = x2 - x1 - 1;
    const fill = Math.max(0, Math.min(width, Math.round((pct / 100) * width)));
    const v = pct > 85 ? 9 : pct > 60 ? 2 : 1;
    for (let c = 0; c < fill; c++) {
      for (let r = y1 + 1; r < y2; r++) g.set(x1 + 1 + c, r, v);
    }
  }

  /** One label/value row. The label is clipped at the value so the two can never collide. */
  settingsRow(g, row, y) {
    const valX = 125 - DotGrid.width3(row.val);
    g.text3(row.label, 12, y, 3, valX - 3);
    g.text3(row.val, valX, y, 1);
    this.hits.push([8, y - 2, 127, y + 8, () => {
      row.toggle();
      this.bridge.saveConfig(this.config);
      this.nudge(240);                                   // dots fly into the new value
    }]);
  }

  drawSettings(g) {
    g.text3c('SETTINGS', 67.5, 12, 1);
    g.text3c('2X DENSITY SYSTEM CONFIGURATION', 67.5, 20, 3);
    g.hline(8, 127, 28, 3, 2);

    g.text3('-- DOCK SHORTCUTS --', 12, 34, 2);

    const dockRows = [
      { label: 'DOCK 1 (CAM)', val: this.getCameraDisplayVal(), toggle: () => {
        const cands = this.getCameraCandidates();
        const cur = this.config.dockCam || 'auto';
        const idx = Math.max(0, cands.findIndex((c) => c.id === cur));
        this.config.dockCam = cands[(idx + 1) % cands.length].id;
      }},
      { label: 'DOCK 2 (WEB)', val: this.getBrowserDisplayVal(), toggle: () => {
        const cands = this.getBrowserCandidates();
        const cur = this.config.dockWeb || 'auto';
        const idx = Math.max(0, cands.findIndex((c) => c.id === cur));
        this.config.dockWeb = cands[(idx + 1) % cands.length].id;
      }},
      { label: 'DOCK 3 (TERM)', val: this.getTerminalDisplayVal(), toggle: () => {
        const cands = this.getTerminalCandidates();
        const cur = this.config.dockTerm || (this.config.termuxMode === 'custom' ? 'custom' : 'auto');
        const idx = Math.max(0, cands.findIndex((c) => c.id === cur));
        this.config.dockTerm = cands[(idx + 1) % cands.length].id;
        if (this.config.dockTerm === 'custom') this.config.termuxMode = 'custom';
        else this.config.termuxMode = 'app';
      }},
      { label: 'DOCK 4 (CHAT)', val: this.getChatDisplayVal(), toggle: () => {
        const cands = this.getChatCandidates();
        const cur = this.config.dockChat || this.config.chatApp || 'auto';
        const idx = Math.max(0, cands.findIndex((c) => c.id === cur));
        this.config.dockChat = cands[(idx + 1) % cands.length].id;
        this.config.chatApp = this.config.dockChat;
      }},
      { label: 'DOCK 5 (MUSIC)', val: this.getMusicDisplayVal(), toggle: () => {
        const cands = this.getMusicCandidates();
        const cur = this.config.dockMusic || this.config.musicApp || 'auto';
        const idx = Math.max(0, cands.findIndex((c) => c.id === cur));
        this.config.dockMusic = cands[(idx + 1) % cands.length].id;
        this.config.musicApp = this.config.dockMusic;
      }}
    ];

    dockRows.forEach((row, i) => this.settingsRow(g, row, 44 + i * 11));

    g.hline(8, 127, 102, 3, 2);
    g.text3('-- SYSTEM CONFIGURATION --', 12, 108, 2);

    const sysRows = [
      { label: 'LAUNCH DELAY', val: this.config.launchDelay + 'MS', toggle: () => {
        const seq = [800, 1000, 300, 600];
        const idx = seq.indexOf(this.config.launchDelay);
        this.config.launchDelay = seq[(idx + 1) % seq.length];
      }},
      { label: 'TERMUX ACTION', val: this.config.termuxMode.toUpperCase(), toggle: () => {
        this.config.termuxMode = this.config.termuxMode === 'app' ? 'custom' : 'app';
        this.config.dockTerm = this.config.termuxMode;
      }},
      { label: 'SYSTEM STATS', val: this.config.sysStats ? 'ON' : 'OFF', toggle: () => {
        this.config.sysStats = !this.config.sysStats;
      }},
      { label: 'EVENT BANNERS', val: this.config.eventBanners ? 'ON' : 'OFF', toggle: () => {
        this.config.eventBanners = !this.config.eventBanners;
      }},
      { label: 'HAPTIC INTENSITY', val: this.hapticStep().label, toggle: () => this.cycleHaptics() },
      { label: 'RIGEL SPEAKS', val: this.config.speak ? 'ON' : 'OFF', toggle: () => {
        this.config.speak = !this.config.speak;
        if (!this.config.speak && this.bridge.voiceShutUp) this.bridge.voiceShutUp();
      }},
      { label: 'STREAM RIGEL', val: this.config.streamRigel !== false ? 'ON' : 'OFF', toggle: () => {
        this.config.streamRigel = this.config.streamRigel === false ? true : false;
      }},
      { label: 'AGENTIC BACKEND', val: this.agenticStep().label, toggle: () => {
        const i = AGENTIC_BACKENDS.indexOf(this.agenticStep());
        this.config.agentic = AGENTIC_BACKENDS[(i + 1) % AGENTIC_BACKENDS.length].id;
      }}
    ];

    sysRows.forEach((row, i) => this.settingsRow(g, row, 116 + i * 10));

    g.text3('* BETA', 12, 191, 3);
    g.hline(8, 127, 198, 3, 2);

    // Test Audio toggle
    const audioY = 206;
    g.frame(16, audioY, 120, audioY + 12, 3);
    g.text3c(this.status.playing ? 'STOP DEMO AUDIO' : 'TEST DEMO AUDIO', 67.5, audioY + 4, 1);
    this.hits.push([16, audioY, 120, audioY + 12, () => {
      this.toggleDemoPlay();
      this.go('home');
    }]);

    // Guide
    const guideY = 224;
    g.frame(16, guideY, 120, guideY + 12, 3);
    g.text3c('HOW TO USE THIS LAUNCHER', 67.5, guideY + 4, 1);
    this.hits.push([16, guideY, 120, guideY + 12, () => this.go('guide')]);

    // Test Event button
    const testY = 242;
    g.frame(16, testY, 120, testY + 12, 3);
    g.text3c('TEST EVENT BANNERS', 67.5, testY + 4, 1);
    this.hits.push([16, testY, 120, testY + 12, () => {
      this.testEvents();
    }]);

    // Media permissions button
    const permY = 260;
    g.frame(16, permY, 120, permY + 12, 3);
    g.text3c('GRANT MEDIA + AUDIO ACCESS', 67.5, permY + 4, 1);
    this.hits.push([16, permY, 120, permY + 12, () => {
      this.bridge.openNotificationAccess();
    }]);

    // Done button
    const doneY = 278;
    g.frame(26, doneY, 110, doneY + 14, 1);
    g.text3c('DONE (RETURN HOME)', 67.5, doneY + 5, 1);
    this.hits.push([26, doneY, 110, doneY + 14, () => {
      this.bridge.saveConfig(this.config);
      this.go('home');
    }]);
  }

  drawTerminal(g, A) {
    const dy = this.dy;
    g.text3('TERMUX', 5, 11, 2); g.text3('RUN_COMMAND', 62 - DotGrid.width3('RUN_COMMAND'), 11, 3);
    g.hline(5, 62, 17, 3, 2);
    let lines = this.hist.slice(), cursor = !this.job;
    if (this.job) {
      const j = this.job;
      lines.push(['$ ' + j.label, 1]);
      if (j.out) {
        const n = Math.floor((A - j.done) / 70);
        j.out.slice(0, n).forEach((l) => lines.push([l, 0]));
        if (n >= j.out.length) { this.hist = this.hist.concat([['$ ' + j.label, 1]], j.out.map((l) => [l, 0])).slice(-60); this.job = null; }
      } else {
        const k = Math.floor(A / 120) % 4; lines.push(['.'.repeat(k + 1), 3]);
      }
    }
    const maxLines = 13 + Math.floor(dy / 6);
    lines = lines.slice(-maxLines);
    lines.forEach(([ln, isCmd], i) => g.text3(ln, 5, 21 + i * 6, isCmd ? 1 : 3, 62));
    const cy = 21 + lines.length * 6;
    if (cursor && lines.length < maxLines) { g.text3('$', 5, cy, 1); if (Math.floor(A / 530) % 2) g.hline(9, 11, cy + 4, 1); }
    let c = 5, r = 101 + dy;
    TERM_CMDS.forEach((cm) => {
      const w = DotGrid.width3(cm.label) + 4;
      if (c + w > 63) { c = 5; r += 10; }
      g.frame(c, r, c + w, r + 8, this.job && this.job.label === cm.label ? 2 : 3);
      g.text3(cm.label, c + 2, r + 2, 1);
      this.hits.push([c, r, c + w, r + 8, () => this.run(cm)]);
      c += w + 3;
    });
    g.text3('< HOME', 5, 143 + dy, 3);
    g.text3('HOLD: OPEN APP', 62 - DotGrid.width3('HOLD: OPEN APP'), 143 + dy, 3);
    this.hits.push([3, 140 + dy, 30, this.s.rows - 1, () => this.go('home')]);
  }
  drawDrawer(g) {
    const dy = this.dy, apps = this.apps, rows = this.drawerRows(), top = Math.round(this.drawerTop);
    g.text3('APPS', 5, 11, 2); g.text3(String(apps.length), 62 - DotGrid.width3(String(apps.length)), 11, 3);
    g.hline(5, 62, 17, 3, 2);
    apps.slice(top, top + rows).forEach((a, i) => {
      const r = 21 + i * 7, nm = a.label.toUpperCase().replace(/[^A-Z0-9 .\-+&!?']/g, '').slice(0, 12);
      g.bmp(['.XXX.', 'XXXXX', 'XXXXX', 'XXXXX', '.XXX.'], 5, r, a.pkg === 'com.termux' ? 2 : 3);
      g.text3(nm || '?', 13, r, 1, 57);
      this.hits.push([4, r - 1, 57, r + 5, () => this.open('pkg:' + a.pkg, nm)]);
    });
    // scroll bar + letter index (tap a letter to jump)
    if (apps.length > rows) {
      const h = rows * 7 - 2, bar = Math.max(4, Math.round(h * rows / apps.length)), y0 = 21 + Math.round((h - bar) * top / Math.max(1, apps.length - rows));
      g.vline(66, 21, 21 + h, 3, 2); g.vline(66, y0, y0 + bar, 1);
    }
    const letters = [];
    apps.forEach((a, i) => { const L = a.label.toUpperCase()[0]; if (/[A-Z]/.test(L) && !letters.find((q) => q[0] === L)) letters.push([L, i]); });
    const step = Math.max(6, Math.floor((rows * 7) / Math.max(1, letters.length)));
    letters.slice(0, Math.floor(rows * 7 / 6)).forEach(([L, i], k) => {
      const r = 21 + k * Math.min(step, 7);
      g.glyph3(L, 61, r, 3);
      this.hits.push([59, r - 1, 64, r + 5, () => { this.drawerTop = Math.min(i, Math.max(0, apps.length - rows)); this.nudge(280); }]);
    });
    g.text3('< HOME', 5, 143 + dy, 3);
    this.hits.push([3, 140 + dy, 30, this.s.rows - 1, () => this.go('home')]);
  }
  drawLaunch(g, A) {
    const L = this.launching || { name: 'APP', t: A }, my = Math.round(this.s.rows / 2);
    g.text3c('OPENING', 33.5, my - 14, 3);
    g.text3c(L.name, 33.5, my - 6, 1);
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2, on = Math.floor((A - L.t) / 70) % 12;
      g.set(33.5 + 7 * Math.sin(a), my + 12 - 7 * Math.cos(a), k === on ? 2 : (k === (on + 11) % 12 ? 1 : 3));
    }
  }
  drawMenu(g) {
    const my = Math.round(this.s.rows / 2) - 16;
    g.text3c('THEME', 33.5, my - 14, 3);
    const sel = Math.max(0, PAL_NAMES.indexOf(this.palName));
    PAL_NAMES.forEach((nm, i) => {
      const c = 8.5 + i * 10;
      g.disc(c, my, 3.1, 4 + i);
      if (i === sel) for (let a = 0; a < 360; a += 15) g.set(c + 4.9 * Math.sin(a * Math.PI / 180), my - 4.9 * Math.cos(a * Math.PI / 180), 1);
      this.hits.push([c - 4.5, my - 6, c + 4.5, my + 6, () => { this.palName = nm; this.bridge.savePalette(nm); this.nudge(240); }]);
    });
    g.text3c(PAL_NAMES[sel].toUpperCase(), 33.5, my + 11, 4 + sel);

    const am = !!this.config.amoled;
    const ay = my + 20;
    g.frame(10, ay, 57, ay + 12, am ? 1 : 3);
    g.text3('AMOLED', 14, ay + 4, am ? 1 : 3);
    g.text3(am ? 'ON' : 'OFF', 53 - DotGrid.width3(am ? 'ON' : 'OFF'), ay + 4, am ? 2 : 3);
    this.hits.push([10, ay, 57, ay + 12, () => {
      this.config.amoled = !this.config.amoled;
      this.bridge.saveConfig(this.config);
      this.nudge(300);
    }]);

    g.frame(22, my + 38, 45, my + 48, 3); g.text3c('DONE', 33.5, my + 41, 1);
    this.hits.push([22, my + 38, 45, my + 48, () => this.go('home')]);
  }
}
