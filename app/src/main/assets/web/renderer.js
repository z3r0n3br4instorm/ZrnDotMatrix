// GPU renderer: every dot is a WebGL point sprite; 2 draw calls per frame (dots, glow).
// Falls back to 2D canvas sprites if WebGL is unavailable.
function makeRenderer(canvas, scr) {
  // The UI is soft round dots, not fine text, so it does not need a 3x backing store — and
  // the glow pass is fill-rate bound, which is what a 2015-era GPU runs out of first.
  // Cap the backing store by total pixels rather than by ratio so dense phones scale down.
  const MAX_PIXELS = 1.6e6;
  const native = window.devicePixelRatio || 1;
  const fit = Math.sqrt(MAX_PIXELS / Math.max(1, scr.w * scr.h));
  const dpr = Math.max(1, Math.min(native, 2.5, fit));
  canvas.width = Math.round(scr.w * dpr); canvas.height = Math.round(scr.h * dpr);
  canvas.style.width = scr.w + 'px'; canvas.style.height = scr.h + 'px';
  const hex3 = (h) => [parseInt(h.substr(1, 2), 16) / 255, parseInt(h.substr(3, 2), 16) / 255, parseInt(h.substr(5, 2), 16) / 255];
  let gl = null;
  try { gl = canvas.getContext('webgl', { alpha: false, antialias: false, premultipliedAlpha: true, powerPreference: 'high-performance' }); } catch (e) { gl = null; }
  if (gl) {
    try { return glRenderer(gl); } catch (e) { gl = null; }
  }
  return canvasRenderer(canvas.getContext('2d'));

  function glRenderer(gl) {
    const VS = 'attribute vec2 aPos;attribute float aState;uniform vec2 uRes;uniform float uSize;uniform vec3 uMain;uniform vec3 uAcc;uniform vec3 uPal[6];' +
      'varying float vS;varying vec3 vCol;' +
      'void main(){vS=aState;vCol=uMain;if(aState>1.5&&aState<2.5)vCol=uAcc;' +
      'if(aState>3.5){int i=int(aState-3.5);for(int k=0;k<6;k++){if(k==i)vCol=uPal[k];}}' +
      'vec2 p=aPos/uRes*2.0-1.0;gl_Position=vec4(p.x,-p.y,0.0,1.0);gl_PointSize=uSize;}';
    const FS = 'precision mediump float;varying float vS;varying vec3 vCol;uniform float uGhost;uniform float uFace;uniform float uGlow;' +
      'void main(){float r=length(gl_PointCoord-0.5)*2.0;float a;' +
      'if(uGlow>0.0){if(vS<0.5||(vS>2.5&&vS<3.5))discard;a=exp(-r*r*4.73)*0.46*uGlow;gl_FragColor=vec4(vCol*a,a);return;}' +
      'a=smoothstep(0.80,0.62,r);if(vS<0.5)a*=uGhost;else if(vS>2.5&&vS<3.5)a*=0.42*uFace;else a*=uFace;gl_FragColor=vec4(vCol*a,a);}';
    const sh = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error('link');
    gl.useProgram(pr);
    const u = {}; ['uRes', 'uSize', 'uMain', 'uAcc', 'uGhost', 'uFace', 'uGlow'].forEach((n) => { u[n] = gl.getUniformLocation(pr, n); });
    const aPos = gl.getAttribLocation(pr, 'aPos'), aState = gl.getAttribLocation(pr, 'aState');
    let pc = []; PAL_NAMES.forEach((n) => { pc = pc.concat(hex3(PALETTES[n][0])); });
    gl.uniform3fv(gl.getUniformLocation(pr, 'uPal[0]') || gl.getUniformLocation(pr, 'uPal'), new Float32Array(pc));
    gl.uniform2f(u.uRes, scr.w, scr.h);
    const G = new Float32Array(scr.ghostPts.length * 3);
    scr.ghostPts.forEach((q, i) => { G[i * 3] = q.x; G[i * 3 + 1] = q.y; G[i * 3 + 2] = 0; });
    const gbuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, gbuf); gl.bufferData(gl.ARRAY_BUFFER, G, gl.STATIC_DRAW);
    const CAP = 20000, dyn = new Float32Array(CAP * 3);
    const dbuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, dbuf); gl.bufferData(gl.ARRAY_BUFFER, dyn.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(aPos); gl.enableVertexAttribArray(aState);
    gl.enable(gl.BLEND); gl.clearColor(0, 0, 0, 1); gl.viewport(0, 0, canvas.width, canvas.height);
    const bind = (b) => { gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 12, 0); gl.vertexAttribPointer(aState, 1, gl.FLOAT, false, 12, 8); };
    const dotSize = scr.pitch * dpr, glowSize = scr.pitch * 16 / 6 * dpr;
    return {
      kind: 'webgl', dpr: dpr,
      draw(f, palName) {
        const pal = PALETTES[palName] || PALETTES.Mono, L = f.layers;
        let n = 0;
        const push = (list, st) => { for (let i = 0; i < list.length && n < CAP; i++) { dyn[n * 3] = list[i].x; dyn[n * 3 + 1] = list[i].y; dyn[n * 3 + 2] = st === null ? list[i].v : st; n++; } };
        let ghostN = 0;
        if (f.ghostPts) { push(f.ghostPts, 0); ghostN = n; }
        if (f.grid) {
          // Fast path: read the composed grid straight into the vertex buffer. No {x,y,v}
          // objects, no layer split — those cost ~2000 allocations and four list walks a
          // frame. Order inside the dynamic block does not matter: the dots never overlap,
          // and both the glow and main passes draw the whole block.
          const s = f.gridScr, g = f.grid;
          let i = 0;
          for (let r = 0; r < s.rows; r++) {
            const y = s.oy + r * s.pitch;
            for (let c = 0; c < s.cols; c++, i++) {
              const v = g[i];
              if (!v || n >= CAP) continue;
              dyn[n * 3] = s.ox + c * s.pitch; dyn[n * 3 + 1] = y; dyn[n * 3 + 2] = v; n++;
            }
          }
        } else {
          push(L.dim, 3); push(L.main, 1); push(L.acc, 2); push(L.pal || [], null);
        }
        const m = hex3(pal[0]), a = hex3(pal[1]);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.uniform3f(u.uMain, m[0], m[1], m[2]); gl.uniform3f(u.uAcc, a[0], a[1], a[2]);
        gl.uniform1f(u.uFace, f.faceOp); gl.uniform1f(u.uGhost, f.ghostOp);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        const curDotSize = f.pitch ? f.pitch * dpr : dotSize;
        const curGlowSize = f.pitch ? f.pitch * 16 / 6 * dpr : glowSize;
        gl.uniform1f(u.uGlow, 0); gl.uniform1f(u.uSize, curDotSize);
        if (f.ghostOp > 0) { bind(gbuf); gl.drawArrays(gl.POINTS, 0, scr.ghostPts.length); }
        bind(dbuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, dyn.subarray(0, n * 3));
        if (f.bloomOp > 0 && n > ghostN) {
          gl.blendFunc(gl.ONE, gl.ONE); gl.uniform1f(u.uGlow, f.bloomOp * f.faceOp); gl.uniform1f(u.uSize, curGlowSize);
          gl.drawArrays(gl.POINTS, ghostN, n - ghostN);
          gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.uniform1f(u.uGlow, 0); gl.uniform1f(u.uSize, curDotSize);
        }
        gl.drawArrays(gl.POINTS, 0, n);
      }
    };
  }

  function canvasRenderer(ctx) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const sprites = {}, ghostCache = {};
    const sprite = (color, glow) => {
      const k = color + glow; if (sprites[k]) return sprites[k];
      const s = document.createElement('canvas'), R = glow ? scr.pitch * 16 / 12 : scr.pitch / 2;
      s.width = s.height = Math.ceil(R * 2 * dpr); const g = s.getContext('2d'); g.scale(dpr, dpr);
      if (glow) {
        const gr = g.createRadialGradient(R, R, 0, R, R, R), rgb = hex3(color).map((v) => Math.round(v * 255)).join(',');
        for (let i = 0; i <= 8; i++) gr.addColorStop(i / 8, 'rgba(' + rgb + ',' + (0.46 * Math.exp(-i * i / 13.5)).toFixed(3) + ')');
        g.fillStyle = gr; g.fillRect(0, 0, R * 2, R * 2);
      } else { g.fillStyle = color; g.beginPath(); g.arc(R, R, scr.pitch * 0.35, 0, Math.PI * 2); g.fill(); }
      s.R = R; sprites[k] = s; return s;
    };
    const ghost = (color) => {
      if (ghostCache[color]) return ghostCache[color];
      const c = document.createElement('canvas'); c.width = canvas.width; c.height = canvas.height;
      const g = c.getContext('2d'); g.scale(dpr, dpr); const d = sprite(color, false);
      scr.ghostPts.forEach((q) => g.drawImage(d, q.x - d.R, q.y - d.R, d.R * 2, d.R * 2));
      return (ghostCache[color] = c);
    };
    const dots = (list, img) => { for (let i = 0; i < list.length; i++) ctx.drawImage(img, list[i].x - img.R, list[i].y - img.R, img.R * 2, img.R * 2); };
    return {
      kind: '2d', dpr: dpr,
      draw(f, palName) {
        const pal = PALETTES[palName] || PALETTES.Mono;
        // This fallback draws sprite by sprite anyway, so just expand the fast-path grid
        // back into layers rather than duplicating the whole blit routine.
        const L = f.grid ? splitLayers(gridToCells(f.grid, f.gridScr)) : f.layers;
        ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, scr.w, scr.h);
        if (f.ghostOp > 0) { ctx.globalAlpha = f.ghostOp; ctx.drawImage(ghost(pal[0]), 0, 0, scr.w, scr.h); if (f.ghostPts) dots(f.ghostPts, sprite(pal[0], false)); }
        if (f.bloomOp > 0) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = f.bloomOp; dots(L.main, sprite(pal[0], true)); dots(L.acc, sprite(pal[1], true)); ctx.globalCompositeOperation = 'source-over'; }
        ctx.globalAlpha = 0.42; dots(L.dim, sprite(pal[0], false));
        ctx.globalAlpha = 1; dots(L.main, sprite(pal[0], false)); dots(L.acc, sprite(pal[1], false));
        (L.pal || []).forEach((q) => { const s = sprite(PALETTES[PAL_NAMES[q.v - 4]][0], false); ctx.drawImage(s, q.x - s.R, q.y - s.R, s.R * 2, s.R * 2); });
      }
    };
  }
}
