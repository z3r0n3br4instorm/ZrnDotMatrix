// ======================================================================
// DotMatrix engine — Zerone Laboratories design language
// A screen is a grid of round LED dots. Everything (type, icons, charts,
// transitions) is drawn by lighting dots. Pure JS, no dependencies.
// Dot states: 0 off (ghost), 1 main, 2 accent, 3 dim, 4.. palette swatches.
// ======================================================================

const PALETTES = {
  Mono:  ['#FFFFFF', '#FF3B30'],
  Amber: ['#FFB02E', '#FF4B3A'],
  Green: ['#8CFF5A', '#FFD23F'],
  Ice:   ['#9FE7FF', '#FF6B8A'],
  White: ['#F4F2EC', '#FF5A3C'],
  Red:   ['#FF4636', '#FFC857']
};
const PAL_NAMES = ['Mono', 'Amber', 'Green', 'Ice', 'White', 'Red'];

// ---- screen geometry -------------------------------------------------
// makeScreen({ w, h, pitch, design, shape: 'circle' | 'rect', radius })
// `design` is the column count the screens are laid out against (68, or 136 for the 2x
// settings sheet). On a 16:9 phone the pitch has to shrink to fit 152 rows, which leaves
// more columns than the design uses; cOff centres the content band in them while the dot
// field still covers the whole screen.
function makeScreen(o) {
  const pitch = o.pitch || 6;
  const cols = Math.floor(o.w / pitch + 1e-6), rows = Math.floor(o.h / pitch + 1e-6);
  const cOff = o.design ? Math.max(0, Math.floor((cols - o.design) / 2)) : 0;
  const ox = (o.w - cols * pitch) / 2 + pitch / 2, oy = (o.h - rows * pitch) / 2 + pitch / 2;
  const on = new Uint8Array(cols * rows);            // dot exists
  const content = new Uint8Array(cols * rows);       // dot may carry content
  const ring = [];                                   // outer ring (round screens: seconds ring)
  const ghostPts = [];
  let ghost = '';
  const cx = (cols - 1) / 2, cy = (rows - 1) / 2, rad = o.radius || 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = ox + c * pitch, y = oy + r * pitch;
    let inside = true, inner = true;
    if (o.shape === 'circle') {
      const d = Math.hypot(c - cx, r - cy), R = Math.min(cols, rows) / 2 - 0.1;
      inside = d <= R; inner = d <= R - 2.1;
      if (inside && !inner && d > R - 1.65) ring.push({ r: r, c: c, a: (Math.atan2(c - cx, -(r - cy)) * 180 / Math.PI + 360) % 360 });
    } else if (rad) {                                // rounded-rect screen corners
      const qx = Math.max(rad - x, 0, x - (o.w - rad)), qy = Math.max(rad - y, 0, y - (o.h - rad));
      inside = Math.hypot(qx, qy) <= rad - pitch * 0.35; inner = inside;
    }
    if (!inside) continue;
    on[r * cols + c] = 1; if (inner) content[r * cols + c] = 1;
    ghostPts.push({ x: x, y: y, v: 0 });
    ghost += 'M' + x.toFixed(1) + ' ' + y.toFixed(1) + 'h0';
  }
  ring.sort((a, b) => a.a - b.a);
  return { w: o.w, h: o.h, pitch: pitch, cols: cols, rows: rows, cOff: cOff, ox: ox, oy: oy, on: on, content: content, ring: ring, ghostPts: ghostPts, ghost: ghost };
}

// ---- fonts & glyphs ------------------------------------------------------
const B7 = {                                           // 7x11 bold digits
  '0': ['.XXXXX.','XXXXXXX','XX...XX','XX...XX','XX...XX','XX...XX','XX...XX','XX...XX','XX...XX','XXXXXXX','.XXXXX.'],
  '1': ['..XXX..','.XXXX..','XXXXX..','...XX..','...XX..','...XX..','...XX..','...XX..','...XX..','XXXXXXX','XXXXXXX'],
  '2': ['.XXXXX.','XXXXXXX','XX...XX','.....XX','....XXX','..XXXX.','.XXX...','XXX....','XX.....','XXXXXXX','XXXXXXX'],
  '3': ['.XXXXX.','XXXXXXX','XX...XX','.....XX','..XXXX.','..XXXX.','.....XX','.....XX','XX...XX','XXXXXXX','.XXXXX.'],
  '4': ['....XX.','...XXX.','..XXXX.','.XX.XX.','XX..XX.','XX..XX.','XXXXXXX','XXXXXXX','....XX.','....XX.','....XX.'],
  '5': ['XXXXXXX','XXXXXXX','XX.....','XX.....','XXXXXX.','XXXXXXX','.....XX','.....XX','XX...XX','XXXXXXX','.XXXXX.'],
  '6': ['.XXXXX.','XXXXXXX','XX...XX','XX.....','XXXXXX.','XXXXXXX','XX...XX','XX...XX','XX...XX','XXXXXXX','.XXXXX.'],
  '7': ['XXXXXXX','XXXXXXX','.....XX','....XX.','...XX..','...XX..','..XX...','..XX...','..XX...','..XX...','..XX...'],
  '8': ['.XXXXX.','XXXXXXX','XX...XX','XX...XX','.XXXXX.','XXXXXXX','XX...XX','XX...XX','XX...XX','XXXXXXX','.XXXXX.'],
  '9': ['.XXXXX.','XXXXXXX','XX...XX','XX...XX','XX...XX','XXXXXXX','.XXXXXX','.....XX','XX...XX','XXXXXXX','.XXXXX.'],
  ' ': ['.......','.......','.......','.......','.......','.......','.......','.......','.......','.......','.......'],
  '-': ['.......','.......','.......','.......','.......','XXXXXXX','XXXXXXX','.......','.......','.......','.......']
};
const F3 = {                                           // 3x5 small font (rows separated by spaces)
  '0':'XXX X.X X.X X.X XXX','1':'.X. XX. .X. .X. XXX','2':'XXX ..X XXX X.. XXX','3':'XXX ..X XXX ..X XXX',
  '4':'X.X X.X XXX ..X ..X','5':'XXX X.. XXX ..X XXX','6':'XXX X.. XXX X.X XXX','7':'XXX ..X ..X ..X ..X',
  '8':'XXX X.X XXX X.X XXX','9':'XXX X.X XXX ..X XXX',
  'A':'.X. X.X XXX X.X X.X','B':'XX. X.X XX. X.X XX.','C':'.XX X.. X.. X.. .XX','D':'XX. X.X X.X X.X XX.',
  'E':'XXX X.. XX. X.. XXX','F':'XXX X.. XX. X.. X..','G':'.XX X.. X.X X.X .XX','H':'X.X X.X XXX X.X X.X',
  'I':'XXX .X. .X. .X. XXX','J':'..X ..X ..X X.X .X.','K':'X.X X.X XX. X.X X.X','L':'X.. X.. X.. X.. XXX',
  'M':'X.X XXX XXX X.X X.X','N':'XX. X.X X.X X.X X.X','O':'.X. X.X X.X X.X .X.','P':'XX. X.X XX. X.. X..',
  'Q':'.X. X.X X.X XX. .XX','R':'XX. X.X XX. X.X X.X','S':'.XX X.. .X. ..X XX.','T':'XXX .X. .X. .X. .X.',
  'U':'X.X X.X X.X X.X .XX','V':'X.X X.X X.X .X. .X.','W':'X.X X.X XXX XXX X.X','X':'X.X X.X .X. X.X X.X',
  'Y':'X.X X.X .X. .X. .X.','Z':'XXX ..X .X. X.. XXX','%':'X.X ..X .X. X.. X.X','-':'... ... XXX ... ...',
  '°':'XX. XX. ... ... ...',' ':'... ... ... ... ...',':':'. X . X .','.':'. . . . X','+':'... .X. XXX .X. ...',
  '/':'..X ..X .X. X.. X..','$':'.XX XX. .X. .XX XX.','>':'X.. .X. ..X .X. X..','<':'..X .X. X.. .X. ..X',
  '_':'... ... ... ... XXX','~':'... X.. XXX ..X ...','#':'X.X XXX X.X XXX X.X','=':'... XXX ... XXX ...',
  '!':'X X X . X','?':'XX. ..X .X. ... .X.','(':'.X X. X. X. .X',')':'X. .X .X .X X.','[':'XX X. X. X. XX',']':'XX .X .X .X XX',
  "'":'X X . . .',',':'. . . X X','@':'.X. X.X XXX X.. .XX','*':'... X.X .X. X.X ...','|':'X X X X X','&':'.X. X.X .X. X.X .XX'
};
const ICON = {                                         // 5x5 / 7x5 status + widget icons
  heartBig:   ['.X.X.','XXXXX','XXXXX','.XXX.','..X..'],
  heartSmall: ['.....','.X.X.','.XXX.','..X..','.....'],
  footA:      ['XX...','XX...','....X','...XX','...XX'],
  footB:      ['...XX','...XX','X....','XX...','XX...'],
  battery:    ['XXXXXX.','X....X.','X....XX','X....X.','XXXXXX.'],
  sunA:  ['X..X..X','..XXX..','XXXXXXX','..XXX..','X..X..X'],
  sunB:  ['...X...','.XXXXX.','.XXXXX.','.XXXXX.','...X...'],
  // Cloud body is rounded on both sides — only the top puff shifts between frames, so the
  // right edge never reads as clipped.
  cloudA:['..XX...','.XXXXX.','XXXXXXX','.XXXXX.','.......'],
  cloudB:['...XX..','.XXXXX.','XXXXXXX','.XXXXX.','.......'],
  rainA: ['..XXX..','.XXXXX.','XXXXXXX','.X.X.X.','X.X.X..'],
  rainB: ['..XXX..','.XXXXX.','XXXXXXX','X.X.X..','.X.X.X.']
};
// Zerone wordmark: 7-row (splash) and 5-row (AOD / small) cuts
const ZERONE = [
  ['XXXXXXX', '.....XX', '....XX.', '...XX..', '..XX...', '.XX....', 'XXXXXXX'],
  ['XXXXXXX', '.......', '.......', 'XXXXXX.', '.......', '.......', 'XXXXXXX'],
  ['XXXXXX.', 'X.....X', 'X.....X', 'XXXXXX.', 'X...XX.', 'X....XX', 'X.....X'],
  ['.XXXXX.', 'X.....X', 'X.....X', 'X.....X', 'X.....X', 'X.....X', '.XXXXX.'],
  ['XX....X', 'X.X...X', 'X..X..X', 'X...X.X', 'X....XX', 'X.....X', 'X.....X'],
  ['XXXXXXX', '.......', '.......', 'XXXXXX.', '.......', '.......', 'XXXXXXX']
];
const ZERONE_MINI = [
  ['XXXXX', '...X.', '..X..', '.X...', 'XXXXX'],
  ['XXXXX', '.....', 'XXXX.', '.....', 'XXXXX'],
  ['XXXX.', 'X...X', 'XXXX.', 'X..X.', 'X...X'],
  ['.XXX.', 'X...X', 'X...X', 'X...X', '.XXX.'],
  ['X...X', 'XX..X', 'X.X.X', 'X..XX', 'X...X'],
  ['XXXXX', '.....', 'XXXX.', '.....', 'XXXXX']
];
const ECG = [0, 0, 0, -1, -1, 0, 0, 1, -3, -5, 2, 1, 0, 0, -1, -2, -1, 0];   // one heartbeat, rows from baseline
const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

// ---- grid ---------------------------------------------------------------
class DotGrid {
  // `buf` lets a caller hand in a scratch buffer instead of allocating one every frame;
  // at 68x152 (and 85x152 on a 16:9 phone) that is ~13KB of garbage per composed layer.
  constructor(scr, buf) {
    this.s = scr;
    const n = scr.cols * scr.rows;
    if (buf && buf.length === n) { buf.fill(0); this.g = buf; } else { this.g = new Uint8Array(n); }
  }
  // c is a design column (0..67, or 0..135 on the settings sheet); cOff shifts it into the
  // centred band so every screen stays laid out the same on wider dot fields.
  set(c, r, v) {
    c = Math.round(c); r = Math.round(r);
    const s = this.s;
    if (this.clip && (c < this.clip[0] || c > this.clip[1])) return;
    c += s.cOff;
    if (c >= 0 && c < s.cols && r >= 0 && r < s.rows && s.content[r * s.cols + c]) this.g[r * s.cols + c] = v;
  }
  bmp(rows, c0, r0, v) { for (let r = 0; r < rows.length; r++) for (let c = 0; c < rows[r].length; c++) if (rows[r][c] === 'X') this.set(c0 + c, r0 + r, v); }
  bmp2(rows, c0, r0, v) {                             // two-tone: X = v, + = dim, * = accent
    for (let r = 0; r < rows.length; r++) for (let c = 0; c < rows[r].length; c++) {
      const ch = rows[r][c];
      if (ch === 'X') this.set(c0 + c, r0 + r, v); else if (ch === '+') this.set(c0 + c, r0 + r, 3); else if (ch === '*') this.set(c0 + c, r0 + r, 2);
    }
  }
  glyph3(ch, c0, r0, v) { const rows = (F3[ch] || F3[ch.toUpperCase()] || F3[' ']).split(' '); this.bmp(rows, c0, r0, v); return rows[0].length; }
  static width3(s) { let w = 0; for (let i = 0; i < s.length; i++) w += (F3[s[i]] || F3[s[i].toUpperCase()] || F3[' ']).split(' ')[0].length + (i ? 1 : 0); return w; }
  text3(s, c0, r0, v, maxC) {                          // returns width; clips at column maxC
    let c = c0;
    for (let i = 0; i < s.length; i++) {
      const w = (F3[s[i]] || F3[s[i].toUpperCase()] || F3[' ']).split(' ')[0].length;
      if (maxC !== undefined && c + w - 1 > maxC) break;
      this.glyph3(s[i], c, r0, v); c += w + 1;
    }
    return c - c0 - 1;
  }
  marquee3(s, minC, maxC, r0, v, A, speed) {
    const totalW = DotGrid.width3(s);
    const boxW = maxC - minC + 1;
    if (totalW <= boxW) {
      this.text3(s, maxC - totalW, r0, v, maxC);
      return;
    }
    const cycle = totalW + 12;
    const shift = Math.floor(A / (speed || 55)) % cycle;
    let c = maxC - shift;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      const rows = (F3[ch] || F3[' ']).split(' ');
      const w = rows[0].length;
      if (c + w >= minC && c <= maxC) {
        for (let r = 0; r < rows.length; r++) {
          for (let col = 0; col < w; col++) {
            const px = c + col;
            if (px >= minC && px <= maxC && rows[r][col] === 'X') {
              this.set(px, r0 + r, v);
            }
          }
        }
      }
      c += w + 1;
    }
  }
  text3c(s, cc, r0, v) { return this.text3(s, Math.round(cc - DotGrid.width3(s) / 2), r0, v); }
  // Live caption: keeps the TAIL of the string visible. Streaming speech should show the
  // words just spoken, so this trims from the front rather than scrolling like a marquee.
  text3tail(s, minC, maxC, r0, v) {
    const box = maxC - minC + 1;
    let out = String(s);
    while (out.length && DotGrid.width3(out) > box) out = out.slice(1);
    // don't leave a half word at the front
    if (out.length && out.length < String(s).length) {
      const sp = out.indexOf(' ');
      if (sp > 0 && sp < 6) out = out.slice(sp + 1);
    }
    this.text3(out, Math.round(maxC - DotGrid.width3(out)), r0, v, maxC);
    return out;
  }
  // Centred inside [minC, maxC] when it fits, otherwise scrolled — never bleeds past the padding.
  text3fit(s, minC, maxC, r0, v, A) {
    const w = DotGrid.width3(s), box = maxC - minC + 1;
    if (w <= box) { this.text3(s, Math.round(minC + (box - w) / 2), r0, v, maxC); return; }
    this.marquee3(s, minC, maxC, r0, v, A || 0, 60);
  }
  big(str, c0, r0, v) { let c = c0; for (const ch of str) { this.bmp(B7[ch] || B7[' '], c, r0, v); c += 9; } return c - c0 - 2; }
  hline(c0, c1, r, v, step) { for (let c = c0; c <= c1; c += (step || 1)) this.set(c, r, v); }
  vline(c, r0, r1, v, step) { for (let r = r0; r <= r1; r += (step || 1)) this.set(c, r, v); }
  frame(c0, r0, c1, r1, v) {                           // rounded widget frame (corners dropped)
    this.hline(c0 + 1, c1 - 1, r0, v); this.hline(c0 + 1, c1 - 1, r1, v);
    this.vline(c0, r0 + 1, r1 - 1, v); this.vline(c1, r0 + 1, r1 - 1, v);
  }
  disc(cx, cy, rad, v) {
    for (let r = Math.floor(cy - rad); r <= Math.ceil(cy + rad); r++) for (let c = Math.floor(cx - rad); c <= Math.ceil(cx + rad); c++)
      if ((c - cx) * (c - cx) + (r - cy) * (r - cy) <= rad * rad) this.set(c, r, v);
  }
  trace(c0, c1, base, samples, v) {                    // connected line chart, samples = row offsets
    let prev = null;
    for (let c = c0; c <= c1; c++) {
      const y = Math.round(base + samples(c));
      if (prev !== null) for (let r = Math.min(prev, y); r <= Math.max(prev, y); r++) this.set(c, r, v); else this.set(c, y, v);
      prev = y;
    }
  }
  cells() {                                            // lit dots as {x, y, v}
    const s = this.s, out = [];
    for (let i = 0; i < this.g.length; i++) if (this.g[i]) out.push({ x: s.ox + (i % s.cols) * s.pitch, y: s.oy + ((i / s.cols) | 0) * s.pitch, v: this.g[i] });
    return out;
  }
  // Lit dots as {c, r, v} in DESIGN column units — cOff is removed so these can be fed
  // back through set() (the middle-widget morph does exactly that) without shifting twice.
  gridCells() {
    const s = this.s, out = [];
    for (let i = 0; i < this.g.length; i++) if (this.g[i]) out.push({ c: (i % s.cols) - s.cOff, r: ((i / s.cols) | 0), v: this.g[i] });
    return out;
  }
}

// ---- motion ---------------------------------------------------------------
function hash(a, b, c) { let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
const easeIO = (u) => u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
// Fly every dot of `from` to a place in `to`: row-major pairing, staggered, with a small lift arc.
function morph(from, to, u, seed, cx, cy) {
  const out = [], n1 = from.length, n2 = to.length;
  for (let i = 0; i < n2; i++) {
    const b = to[i], a = n1 ? from[Math.floor(i * n1 / n2)] : { x: cx || 0, y: cy || 0 };
    const k = easeIO(Math.max(0, Math.min(1, (u - 0.3 * hash(i, seed, 7)) / 0.7)));
    const lift = Math.sin(Math.PI * k) * (6 + 10 * hash(i, seed, 3));
    out.push({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k - lift, v: k > 0.98 ? b.v : 1 });
  }
  return out;
}
function morphGrid(from, to, u, seed, cx, cy) {
  const out = [], n1 = from.length, n2 = to.length;
  for (let i = 0; i < n2; i++) {
    const b = to[i], a = n1 ? from[Math.floor(i * n1 / n2)] : { c: cx || 33, r: cy || 62, v: 1 };
    const k = easeIO(Math.max(0, Math.min(1, (u - 0.3 * hash(i, seed, 7)) / 0.7)));
    out.push({
      c: Math.round(a.c + (b.c - a.c) * k),
      r: Math.round(a.r + (b.r - a.r) * k),
      v: k > 0.5 ? b.v : (a.v || b.v)
    });
  }
  return out;
}
// Scatter: random dots across the screen (splash start state)
function scatter(scr, n, seed) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = scr.ghostPts[Math.floor(hash(i, seed, 11) * scr.ghostPts.length)];
    out.push({ x: p.x, y: p.y, v: 3 });
  }
  return out;
}
// Tap ripple: shock ring that bends dots outward, tears rows and drops dots as it passes.
// ripples: [{x, y, t, s}], returns { bend(list), moved(ghostPts) → displaced ghosts, sparks }
function rippleFx(scr, ripples, A) {
  const live = ripples.filter((q) => A - q.t < 1300);
  if (!live.length) return null;
  const frame = Math.floor(A / 55);
  // The shock ring only touches dots within ~BAND px of its radius — past that the
  // gaussian weight is under 0.00005. Precompute each ring's squared cull band so a dot
  // can be rejected with two multiplies instead of a sqrt, an exp and a pow. Without this,
  // ghosts() ran that math over every dot on the screen (12,920 of them) every frame.
  const BAND = 34;
  const rings = live.map((r) => {
    const t = A - r.t, R = t * 0.42;
    const lo = Math.max(0, R - BAND), hi = R + BAND;
    return { x: r.x, y: r.y, s: r.s, R: R, decay: 1 - t / 1300, lo2: lo * lo, hi2: hi * hi };
  });
  const near = (x, y) => {
    for (let i = 0; i < rings.length; i++) {
      const r = rings[i], dx = x - r.x, dy = y - r.y, d2 = dx * dx + dy * dy;
      if (d2 >= r.lo2 && d2 <= r.hi2) return true;
    }
    return false;
  };
  const fx = (q) => {
    let x = q.x, y = q.y, hot = 0;
    for (let i = 0; i < rings.length; i++) {
      const r = rings[i];
      const dx = x - r.x, dy = y - r.y, d2 = dx * dx + dy * dy;
      if (d2 < r.lo2 || d2 > r.hi2) continue;
      const dist = Math.sqrt(d2) || 1;
      const e = (dist - r.R) / 11;
      const w = Math.exp(-e * e) * r.decay;
      if (w < 0.02) continue;
      x += dx / dist * 6 * w; y += dy / dist * 6 * w;
      const row = Math.round(q.y / scr.pitch);
      if (w > 0.3 && hash(row, frame, r.s) < 0.28) x += (hash(row, frame, 9) < 0.5 ? -1 : 1) * scr.pitch;
      if (w > hot) hot = w;
    }
    return { x: x, y: y, v: q.v, hot: hot };
  };
  return {
    bend: (list) => {
      const out = [];
      for (let i = 0; i < list.length; i++) {
        const q = list[i];
        if (!near(q.x, q.y)) { out.push(q); continue; }      // untouched dots pass through as-is
        const m = fx(q);
        if (m.hot > 0.35 && hash(Math.round(m.x), Math.round(m.y), frame) < 0.22) continue;
        out.push(m);
      }
      return out;
    },
    ghosts: () => {
      const moved = [], sparks = [], pts = scr.ghostPts;
      for (let i = 0; i < pts.length; i++) {
        const q = pts[i];
        if (!near(q.x, q.y)) continue;
        const m = fx(q);
        if (m.hot > 0.05) moved.push(m);
        if (m.hot > 0.3 && hash(Math.round(m.x * 7), Math.round(m.y * 3), frame) < 0.3 * m.hot) sparks.push(m);
      }
      return { moved: moved, sparks: sparks };
    }
  };
}
// Expand a composed grid buffer into {x, y, v} dots — used when something needs the list
// form (the 2D fallback, and seeding a morph from the last drawn frame).
function gridToCells(g, s) {
  const out = [];
  let i = 0;
  for (let r = 0; r < s.rows; r++) {
    const y = s.oy + r * s.pitch;
    for (let c = 0; c < s.cols; c++, i++) {
      if (g[i]) out.push({ x: s.ox + c * s.pitch, y: y, v: g[i] });
    }
  }
  return out;
}
// One pass, four buckets — four .filter() calls walked the whole list four times and
// allocated four arrays every frame.
function splitLayers(all) {
  const main = [], acc = [], dim = [], pal = [];
  for (let i = 0; i < all.length; i++) {
    const q = all[i], v = q.v;
    if (v === 1) main.push(q); else if (v === 2) acc.push(q); else if (v === 3) dim.push(q); else if (v >= 4) pal.push(q);
  }
  return { main: main, acc: acc, dim: dim, pal: pal };
}
const DOT = (x, y) => 'M' + x.toFixed(1) + ' ' + y.toFixed(1) + 'h0';
const toPath = (list) => { let d = ''; for (let i = 0; i < list.length; i++) d += 'M' + list[i].x.toFixed(1) + ' ' + list[i].y.toFixed(1) + 'h0'; return d; };
