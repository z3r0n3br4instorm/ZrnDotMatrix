#!/usr/bin/env node
const http = require('http');
const cp = require('child_process');
const fs = require('fs');
const path = require('path');

const HOME = process.env.HOME || '/data/data/com.termux/files/home';
const RIGEL_HOME = path.join(HOME, '.rigel');
const STATUS_FILE = path.join(RIGEL_HOME, 'status');
const CONFIG_FILE = path.join(RIGEL_HOME, 'config.json');
const STREAM_FILE = path.join(RIGEL_HOME, 'stream');
const MEDIA_GLYPHS_FILE = path.join(RIGEL_HOME, 'media_glyphs.json');
const CUSTOM_GLYPHS_FILE = path.join(RIGEL_HOME, 'custom_glyphs.json');
const PORT = 4096;

function setStatus(s) {
  try { fs.writeFileSync(STATUS_FILE, s + '\n'); } catch (e) {}
}

function getAgyBin() {
  return fs.existsSync('/data/data/com.termux/files/usr/bin/agy')
    ? '/data/data/com.termux/files/usr/bin/agy'
    : (fs.existsSync(path.join(RIGEL_HOME, 'bin', 'agy'))
      ? path.join(RIGEL_HOME, 'bin', 'agy')
      : 'agy');
}

function getConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch (e) {
    return {};
  }
}

function saveConfig(cfg) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
    return true;
  } catch (e) {
    return false;
  }
}

const DEFAULT_MODELS = [
  { id: 'gemini-3.8-flash-low', name: 'Gemini 3.8 Flash (Low)' },
  { id: 'gemini-3.8-flash-medium', name: 'Gemini 3.8 Flash (Medium)' },
  { id: 'gemini-3.7-flash-low', name: 'Gemini 3.7 Flash (Low)' },
  { id: 'gemini-3.6-flash-low', name: 'Gemini 3.6 Flash (Low)' },
  { id: 'gemini-3.1-pro-high', name: 'Gemini 3.1 Pro (High)' },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6 (Thinking)' },
  { id: 'claude-opus-4-6-thinking', name: 'Claude Opus 4.6 (Thinking)' },
  { id: 'gpt-oss-120b-medium', name: 'GPT-OSS 120B (Medium)' }
];

let cachedModels = null;
let hasSession = false;
let currentChild = null;
let streamedText = '';

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end('{"status":"ok"}\n');
  }

  if (req.method === 'POST' && req.url === '/reset') {
    if (currentChild) {
      try { currentChild.kill('SIGTERM'); } catch (e) {}
      currentChild = null;
    }
    hasSession = false;
    streamedText = '';
    try { fs.writeFileSync(STREAM_FILE, ''); } catch (e) {}
    setStatus('IDLE');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end('{"status":"ok","session":"reset"}\n');
  }

  if (req.method === 'POST' && req.url === '/abort') {
    if (currentChild) {
      try {
        currentChild.kill('SIGTERM');
        setTimeout(() => {
          try { if (currentChild) currentChild.kill('SIGKILL'); } catch (e) {}
        }, 400);
      } catch (e) {}
      currentChild = null;
    }
    streamedText = '';
    try { fs.writeFileSync(STREAM_FILE, ''); } catch (e) {}
    setStatus('IDLE');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end('{"status":"ok","action":"aborted"}\n');
  }

  if (req.method === 'GET' && req.url === '/stream') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ text: streamedText }) + '\n');
  }

  if (req.method === 'GET' && req.url === '/media-glyphs') {
    let data = '[]';
    try {
      if (fs.existsSync(MEDIA_GLYPHS_FILE)) {
        data = fs.readFileSync(MEDIA_GLYPHS_FILE, 'utf8') || '[]';
      }
    } catch (e) {}
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(data + '\n');
  }

  if (req.method === 'GET' && req.url === '/custom-glyphs') {
    let data = '{}';
    try {
      if (fs.existsSync(CUSTOM_GLYPHS_FILE)) {
        data = fs.readFileSync(CUSTOM_GLYPHS_FILE, 'utf8') || '{}';
      }
    } catch (e) {}
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(data + '\n');
  }

  if (req.method === 'POST' && req.url === '/custom-glyphs') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        let current = {};
        if (fs.existsSync(CUSTOM_GLYPHS_FILE)) {
          try { current = JSON.parse(fs.readFileSync(CUSTOM_GLYPHS_FILE, 'utf8') || '{}'); } catch (_) {}
        }
        if (parsed.name && (parsed.rows || parsed.pattern)) {
          current[String(parsed.name).toUpperCase().trim()] = parsed.rows || parsed.pattern;
        } else if (typeof parsed === 'object') {
          Object.assign(current, parsed);
        }
        fs.writeFileSync(CUSTOM_GLYPHS_FILE, JSON.stringify(current, null, 2));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ status: 'ok' }) + '\n');
      } catch (e) {
        res.writeHead(400);
        return res.end(JSON.stringify({ error: e.message }) + '\n');
      }
    });
    return;
  }

  if (req.method === 'GET' && req.url === '/models') {
    if (cachedModels && cachedModels.length > 0) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(cachedModels) + '\n');
    }

    const agyBin = getAgyBin();
    cp.execFile(agyBin, ['models'], {
      env: Object.assign({}, process.env, {
        PREFIX: process.env.PREFIX || '/data/data/com.termux/files/usr',
        PATH: path.join(RIGEL_HOME, 'bin') + ':/data/data/com.termux/files/usr/bin:/data/data/com.termux/files/usr/glibc/bin:' + (process.env.PATH || '')
      }),
      timeout: 10000
    }, (err, stdout, stderr) => {
      let models = [];
      if (!err && stdout) {
        const clean = stdout.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').replace(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]|Fetching available models\.\.\./g, '');
        const lines = clean.split('\n');
        for (const line of lines) {
          const m = line.trim().match(/^([a-z0-9\.\-_]+)\s+(.+)$/i);
          if (m && m[1] && m[2]) {
            models.push({ id: m[1].trim(), name: m[2].trim() });
          }
        }
      }
      if (!models.length) {
        models = DEFAULT_MODELS;
      }
      cachedModels = models;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(models) + '\n');
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/setmodel') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      let model = body.trim();
      try {
        const parsed = JSON.parse(body);
        if (parsed.model) model = parsed.model;
      } catch (e) {}

      if (model) {
        const cfg = getConfig();
        cfg.model = model;
        saveConfig(cfg);
        hasSession = false; // reset session when model changes
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ status: 'ok', model: model }) + '\n');
      }
      res.writeHead(400);
      res.end('MISSING MODEL\n');
    });
    return;
  }

  if (req.method === 'POST' && (req.url === '/ask' || req.url === '/')) {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      const prompt = body.trim();
      if (!prompt) {
        res.writeHead(400);
        return res.end('EMPTY PROMPT\n');
      }

      setStatus('THINKING');
      streamedText = '';
      try { fs.writeFileSync(STREAM_FILE, ''); } catch (e) {}

      const agyBin = getAgyBin();
      const cfg = getConfig();

      const args = [
        '--dangerously-skip-permissions',
        '--effort', 'low',
        '--output-format', 'stream-json'
      ];

      if (cfg && cfg.model) {
        args.push('--model', String(cfg.model).trim());
      }
      if (hasSession) {
        args.push('-c');
      }
      args.push('-p', prompt);

      let stdoutText = '';
      let reply = '';
      const child = cp.spawn(agyBin, args, {
        cwd: HOME,
        env: Object.assign({}, process.env, {
          PREFIX: process.env.PREFIX || '/data/data/com.termux/files/usr',
          PATH: path.join(RIGEL_HOME, 'bin') + ':/data/data/com.termux/files/usr/bin:/data/data/com.termux/files/usr/glibc/bin:' + (process.env.PATH || '')
        })
      });

      currentChild = child;

      let buf = '';
      child.stdout.on('data', data => {
        const text = data.toString();
        stdoutText += text;
        buf += text;
        const lines = buf.split('\n');
        buf = lines.pop();

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const ev = JSON.parse(line.trim());
            if (ev.event === 'step_update' && ev.step_update) {
              const su = ev.step_update;
              if (su.step_type === 'tool_call' || (su.state === 'RUNNING' && su.step_type !== 'checkpoint')) {
                setStatus('TOOL');
              } else if (su.step_type === 'checkpoint' || su.step_type === 'user_input' || su.step_type === 'agent_response') {
                setStatus('THINKING');
              }
              if (su.text_delta) {
                streamedText += su.text_delta;
                try { fs.appendFileSync(STREAM_FILE, su.text_delta); } catch (e) {}
              }
            } else if (ev.event === 'result' && ev.result) {
              if (ev.result.response) {
                reply = ev.result.response;
                if (!streamedText) streamedText = reply;
                try { fs.writeFileSync(STREAM_FILE, streamedText); } catch (e) {}
              }
            }
          } catch (e) {}
        }
      });

      child.stderr.on('data', () => {});

      child.on('close', code => {
        if (currentChild === child) currentChild = null;
        setStatus('DONE');
        if (code === 0) {
          hasSession = true;
        } else if (hasSession) {
          hasSession = false;
        }

        const out = reply || streamedText || stdoutText.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').trim() || 'OK';
        try { fs.writeFileSync(STREAM_FILE, out); } catch (e) {}
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(out + '\n');
      });

      child.on('error', err => {
        if (currentChild === child) currentChild = null;
        setStatus('DONE');
        res.writeHead(500);
        res.end('AGENT ERROR: ' + err.message + '\n');
      });
    });
    return;
  }

  res.writeHead(404);
  res.end('Not Found\n');
});

server.listen(PORT, '127.0.0.1', () => {
  try {
    fs.writeFileSync(path.join(RIGEL_HOME, 'daemon.pid'), String(process.pid));
  } catch (e) {}
});
