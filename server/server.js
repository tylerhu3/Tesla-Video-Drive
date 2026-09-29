const express = require('express');
const path = require('path');
const fs = require('fs');

// Auto-load .env if available
if (typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile();
  } catch (e) { }
}

const app = express();
const PORT = process.env.PORT || 8742;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// Locate yt-dlp binary across common environments
function resolveYtDlp() {
  if (process.env.YT_DLP) {
    try {
      if (fs.existsSync(process.env.YT_DLP)) return process.env.YT_DLP;
    } catch (e) { }
  }

  // Check `which yt-dlp` in current PATH
  try {
    const whichOut = require('child_process').execSync('which yt-dlp', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    if (whichOut && fs.existsSync(whichOut)) return whichOut;
  } catch (e) { }

  const candidates = [
    path.join(__dirname, '..', 'bin', 'yt-dlp'),
    path.join(__dirname, '..', 'bin', 'yt-dlp_linux'),
    '/usr/local/bin/yt-dlp',
    '/usr/bin/yt-dlp',
    path.join(process.env.HOME || '', '.local', 'bin', 'yt-dlp'),
    path.join(process.env.HOME || '', 'Library', 'Python', '3.9', 'bin', 'yt-dlp'),
    '/opt/homebrew/bin/yt-dlp'
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) {
        try { fs.accessSync(c, fs.constants.X_OK); } catch (_) { fs.chmodSync(c, 0o755); }
        return c;
      }
    } catch (e) { }
  }

  // If missing, run our installer script synchronously
  try {
    const installerScript = path.join(__dirname, '..', 'scripts', 'install-ytdlp.js');
    if (fs.existsSync(installerScript)) {
      console.log('[INIT] yt-dlp not found on system. Triggering automatic download...');
      require('child_process').execSync(`node "${installerScript}"`, { stdio: 'inherit', timeout: 30000 });
      const localBin = path.join(__dirname, '..', 'bin', 'yt-dlp');
      if (fs.existsSync(localBin)) {
        return localBin;
      }
    }
  } catch (e) {
    console.warn('[INIT] Standalone yt-dlp installation attempt error:', e.message);
  }

  return 'yt-dlp';
}
let YT_DLP = resolveYtDlp();

// Locate ffmpeg binary across common environments
function resolveFfmpeg() {
  if (process.env.FFMPEG_PATH) {
    try {
      if (fs.existsSync(process.env.FFMPEG_PATH)) return process.env.FFMPEG_PATH;
    } catch (e) { }
  }

  // Check `which ffmpeg` in PATH
  try {
    const whichOut = require('child_process').execSync('which ffmpeg', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    if (whichOut && fs.existsSync(whichOut)) return whichOut;
  } catch (e) { }

  const candidates = [
    '/usr/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
    '/opt/homebrew/bin/ffmpeg',
    path.join(process.env.HOME || '', '.local', 'bin', 'ffmpeg')
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch (e) { }
  }

  // Fallback to @ffmpeg-installer/ffmpeg if available
  try {
    const installer = require('@ffmpeg-installer/ffmpeg');
    if (installer && installer.path && fs.existsSync(installer.path)) {
      return installer.path;
    }
  } catch (e) { }

  return 'ffmpeg';
}
let FFMPEG = resolveFfmpeg();

// Helper to extract clean YouTube target (video ID or URL)
function extractYouTubeTarget(input) {
  if (!input) return null;
  input = String(input).trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(input)) {
    return { id: input, url: `https://www.youtube.com/watch?v=${input}` };
  }
  try {
    if (!input.startsWith('http://') && !input.startsWith('https://')) {
      input = 'https://' + input;
    }
    const parsed = new URL(input);
    if (parsed.hostname.includes('youtube.com')) {
      const v = parsed.searchParams.get('v');
      if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) {
        return { id: v, url: `https://www.youtube.com/watch?v=${v}` };
      }
      if (parsed.pathname.startsWith('/live/') || parsed.pathname.startsWith('/shorts/')) {
        const id = parsed.pathname.split('/')[2];
        if (id && /^[a-zA-Z0-9_-]{11}$/.test(id)) {
          return { id, url: `https://www.youtube.com/watch?v=${id}` };
        }
      }
    } else if (parsed.hostname === 'youtu.be') {
      const id = parsed.pathname.replace(/^\//, '');
      if (id && /^[a-zA-Z0-9_-]{11}$/.test(id)) {
        return { id, url: `https://www.youtube.com/watch?v=${id}` };
      }
    }
  } catch (e) { }
  return null;
}

if (!fs.existsSync(PUBLIC_DIR)) {
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });
}

app.use(express.static(PUBLIC_DIR));

// ============================================================
// PROBE: diagnostic report receiver
// ============================================================
app.post('/api/probe-report', express.json({ limit: '1mb' }), (req, res) => {
  const data = req.body || {};
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportsDir = path.join(__dirname, '..', 'probe-reports');
  const filename = path.join(reportsDir, `probe-${timestamp}.json`);
  fs.mkdirSync(reportsDir, { recursive: true });
  fs.writeFileSync(filename, JSON.stringify(data, null, 2));
  console.log(`Probe report saved: ${filename}`);
  res.json({ ok: true, file: filename });
});



// ============================================================
// HEALTH & DIAGNOSTICS
// ============================================================
app.get('/api/health', (req, res) => {
  const { execSync } = require('child_process');
  let ytdlpVer = null;
  let ffmpegVer = null;
  let ytdlpOk = false;
  let ffmpegOk = false;

  try {
    YT_DLP = resolveYtDlp();
    ytdlpVer = execSync(`"${YT_DLP}" --version`, { stdio: ['ignore', 'pipe', 'ignore'], timeout: 4000 }).toString().trim();
    ytdlpOk = true;
  } catch (e) {
    ytdlpVer = e.message;
  }

  try {
    FFMPEG = resolveFfmpeg();
    ffmpegVer = execSync(`"${FFMPEG}" -version`, { stdio: ['ignore', 'pipe', 'ignore'], timeout: 4000 }).toString().split('\n')[0].trim();
    ffmpegOk = true;
  } catch (e) {
    ffmpegVer = e.message;
  }

  res.json({
    ok: ytdlpOk && ffmpegOk,
    ytdlp: { path: YT_DLP, version: ytdlpVer, ok: ytdlpOk },
    ffmpeg: { path: FFMPEG, version: ffmpegVer, ok: ffmpegOk },
    env: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      port: PORT,
      host: HOST
    },
    uptime: Math.round(process.uptime())
  });
});

// ============================================================
// YOUTUBE: search
// ============================================================
app.get('/api/youtube/search', (req, res) => {
  const query = (req.query.q || '').replace(/["`$\\]/g, '').trim().slice(0, 100);
  const limit = Math.min(parseInt(req.query.limit) || 6, 12);
  if (!query) return res.json({ ok: false, error: 'Missing query' });

  YT_DLP = resolveYtDlp();
  console.log(`[Search] Searching YouTube for "${query}" using ${YT_DLP}...`);

  const { spawn } = require('child_process');
  const searchArg = `ytsearch${limit}:${query}`;
  const p = spawn(YT_DLP, [
    '--extractor-args', 'youtube:player_client=android',
    '--print', '%(id)s|%(title)s|%(duration_string)s|%(channel)s',
    searchArg
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  let stdout = '';
  let stderr = '';
  p.stdout.on('data', (d) => { stdout += d; });
  p.stderr.on('data', (d) => { stderr += d; });

  const timer = setTimeout(() => {
    try { p.kill(); } catch (e) { }
    console.warn(`[Search] Timeout for query "${query}"`);
    res.json({ ok: false, error: 'Search timeout' });
  }, 18000);

  p.on('close', (code) => {
    clearTimeout(timer);
    if (code !== 0 && !stdout.trim()) {
      console.error(`[Search] yt-dlp search error code ${code}:`, stderr.trim().slice(-300));
      return res.json({ ok: false, error: stderr.trim().split('\n').pop() || `yt-dlp exited with code ${code}` });
    }
    const results = [];
    const lines = stdout.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.includes('|')) continue;
      const parts = trimmed.split('|');
      if (parts[0] && parts[0].length === 11) {
        results.push({
          id: parts[0],
          title: parts[1] || 'YouTube Video',
          duration: parts[2] || '',
          channel: parts[3] || 'YouTube'
        });
      }
    }
    console.log(`[Search] Found ${results.length} results for "${query}"`);
    res.json({ ok: true, results });
  });

  p.on('error', (err) => {
    clearTimeout(timer);
    console.error(`[Search] Spawn error for ${YT_DLP}:`, err.message);
    res.json({ ok: false, error: err.message });
  });
});

// ============================================================
// YOUTUBE: video info
// ============================================================
app.get('/api/youtube/info', (req, res) => {
  const target = extractYouTubeTarget(req.query.v || req.query.url || '');
  if (!target) return res.json({ ok: false, error: 'Invalid or missing YouTube video' });

  YT_DLP = resolveYtDlp();
  console.log(`[Info] Fetching metadata for ${target.url} using ${YT_DLP}...`);

  const { spawn } = require('child_process');
  const p = spawn(YT_DLP, [
    '--extractor-args', 'youtube:player_client=android',
    '--print', '%(id)s|%(title)s|%(duration_string)s|%(channel)s|%(thumbnail)s',
    target.url
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  let stdout = '';
  let stderr = '';
  p.stdout.on('data', (d) => { stdout += d; });
  p.stderr.on('data', (d) => { stderr += d; });

  const timer = setTimeout(() => {
    try { p.kill(); } catch (e) { }
    res.json({ ok: false, error: 'Info request timeout' });
  }, 15000);

  p.on('close', (code) => {
    clearTimeout(timer);
    const line = stdout.trim().split('\n')[0];
    if (line && line.includes('|')) {
      const parts = line.split('|');
      res.json({
        ok: true,
        id: parts[0] || target.id,
        title: parts[1] || target.id,
        duration: parts[2] || '',
        channel: parts[3] || '',
        thumbnail: parts[4] || ''
      });
    } else {
      res.json({ ok: true, id: target.id, title: target.id, duration: '', channel: '' });
    }
  });

  p.on('error', (err) => {
    clearTimeout(timer);
    console.error(`[Info] Spawn error:`, err.message);
    res.json({ ok: false, error: err.message });
  });
});

// ============================================================
// AUDIO: live stream (MP3) for YouTube
// ============================================================
app.get('/api/live-audio', (req, res) => {
  const { spawn } = require('child_process');
  const ytTarget = extractYouTubeTarget(req.query.yt || req.query.v || '');
  
  if (!ytTarget) {
    return res.status(400).send('Invalid or missing YouTube target');
  }

  YT_DLP = resolveYtDlp();
  FFMPEG = resolveFfmpeg();

  console.log(`[Audio] Starting audio stream for ${ytTarget.url} (yt-dlp: ${YT_DLP}, ffmpeg: ${FFMPEG})`);

  res.writeHead(200, {
    'Content-Type': 'audio/mpeg',
    'Cache-Control': 'no-cache, no-store',
    'Access-Control-Allow-Origin': '*',
  });

  const ytdlp = spawn(YT_DLP, [
    '-f', '18/best',
    '--extractor-args', 'youtube:player_client=android',
    '-o', '-',
    ytTarget.url
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  const ffmpeg = spawn(FFMPEG, [
    '-re',
    '-i', '-',
    '-vn',
    '-fflags', 'nobuffer', '-flags', 'low_delay',
    '-c:a', 'libmp3lame', '-b:a', '48k', '-ar', '22050', '-ac', '1',
    '-f', 'mp3',
    '-'
  ], { stdio: ['pipe', 'pipe', 'pipe'] });

  let audioBytesSent = 0;
  let ytdlpStderr = '';
  let ffmpegStderr = '';

  ytdlp.stderr.on('data', (d) => {
    ytdlpStderr = (ytdlpStderr + d.toString()).slice(-800);
  });
  ffmpeg.stderr.on('data', (d) => {
    ffmpegStderr = (ffmpegStderr + d.toString()).slice(-800);
  });

  ytdlp.stdout.on('error', () => { });
  ffmpeg.stdin.on('error', () => { });
  ffmpeg.stdout.on('error', () => { });
  res.on('error', () => { });

  ytdlp.stdout.pipe(ffmpeg.stdin);
  ffmpeg.stdout.on('data', (chunk) => {
    audioBytesSent += chunk.length;
  });
  ffmpeg.stdout.pipe(res);

  const cleanup = () => {
    try { ytdlp.kill(); } catch (e) { }
    try { ffmpeg.kill(); } catch (e) { }
  };

  req.on('close', () => {
    console.log(`[Audio] Client closed connection, audio bytes sent: ${audioBytesSent}`);
    cleanup();
  });
  res.on('close', cleanup);

  ytdlp.on('error', (err) => {
    console.error(`[Audio yt-dlp error]`, err.message);
    cleanup();
  });
  ytdlp.on('close', (code) => {
    if (code !== 0 && audioBytesSent === 0) {
      console.error(`[Audio yt-dlp failure code ${code}]:`, ytdlpStderr.trim().split('\n').pop());
    }
  });

  ffmpeg.on('error', (err) => {
    console.error(`[Audio ffmpeg error]`, err.message);
    cleanup();
  });
  ffmpeg.on('exit', (code) => {
    if (code !== 0 && audioBytesSent === 0) {
      console.error(`[Audio ffmpeg exit code ${code}]:`, ffmpegStderr.trim().split('\n').pop());
    }
    try { res.end(); } catch (e) { }
  });
});

// ============================================================
// WEBSOCKET: MPEG1 stream
// ============================================================
const { WebSocketServer } = require('ws');
const wss = new WebSocketServer({ noServer: true, perMessageDeflate: true });

const server = app.listen(PORT, HOST, () => {
  const displayHost = HOST === '0.0.0.0' ? 'localhost' : HOST;
  console.log(`\n============================================================`);
  console.log(`Tesla Video Drive running on http://${displayHost}:${PORT} (bound to ${HOST})`);
  console.log(`Resolved yt-dlp: ${YT_DLP}`);
  console.log(`Resolved ffmpeg: ${FFMPEG}`);
  console.log(`Static files served from: ${PUBLIC_DIR}`);
  console.log(`============================================================\n`);
});

server.on('upgrade', (req, socket, head) => {
  const url = require('url').parse(req.url, true);
  if (url.pathname === '/ws/mpeg1') {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  } else {
    socket.destroy();
  }
});

wss.on('connection', (ws, req) => {
  const url = require('url').parse(req.url, true);
  const ytParam = url.query.yt || url.query.v || '';
  const channelOrUrl = url.query.channel || url.query.url || ytParam || '';
  const quality = parseInt(url.query.quality) || 720;
  const qualMap = { 360: '640:360', 480: '854:480', 720: '1280:720', 1080: '1920:1080' };
  const scale = qualMap[quality] || '1280:720';

  console.log(`[WS] Client connected from ${req.socket.remoteAddress} (target: "${channelOrUrl}", quality: ${quality}p)`);

  if (!channelOrUrl) {
    console.warn('[WS] Rejected connection: missing channel or yt parameter');
    ws.send(JSON.stringify({ type: 'error', message: 'Missing ?channel= or ?yt= or ?url=' }));
    ws.close();
    return;
  }

  streamMpeg1(ws, channelOrUrl, scale, ytParam);
});

function streamMpeg1(ws, channelOrUrl, scale, ytParam) {
  const { spawn } = require('child_process');
  scale = scale || '1280:720';
  const bitrate = scale.endsWith('480') ? '800k' : scale.endsWith('720') ? '1500k' : '2500k';

  YT_DLP = resolveYtDlp();
  FFMPEG = resolveFfmpeg();

  // Check if YouTube
  const ytTarget = extractYouTubeTarget(ytParam || (channelOrUrl.includes('youtu') ? channelOrUrl : ''));
  if (ytTarget) {
    console.log(`[WS Stream] Initiating YouTube MPEG1 pipeline for ${ytTarget.url}`);
    ws.send(JSON.stringify({ type: 'status', message: 'Starting YouTube stream...' }));

    const ytdlp = spawn(YT_DLP, [
      '-f', '18/best',
      '--extractor-args', 'youtube:player_client=android',
      '-o', '-',
      ytTarget.url
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    const ffmpeg = spawn(FFMPEG, [
      '-re',
      '-i', '-',
      '-an',
      '-c:v', 'mpeg1video', '-q:v', '5', '-b:v', bitrate,
      '-bf', '0',
      '-vf', 'fps=30,scale=' + scale,
      '-f', 'mpegts',
      '-muxdelay', '0.1', '-muxpreload', '0',
      '-'
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    let videoBytesSent = 0;
    let ytdlpStderr = '';
    let ffmpegStderr = '';

    ytdlp.stderr.on('data', (d) => {
      const str = d.toString();
      ytdlpStderr = (ytdlpStderr + str).slice(-1000);
      // Log informative lines only, avoiding percent spam
      if (str.includes('[youtube]') || str.includes('ERROR') || str.includes('WARNING') || str.includes('[info]')) {
        console.log(`[WS yt-dlp] ${str.trim()}`);
      }
    });

    ffmpeg.stderr.on('data', (d) => {
      const str = d.toString();
      ffmpegStderr = (ffmpegStderr + str).slice(-1000);
      if (str.includes('Error') || str.includes('Invalid') || str.includes('failed')) {
        console.warn(`[WS ffmpeg] ${str.trim()}`);
      }
    });

    ytdlp.stdout.on('error', () => { });
    ffmpeg.stdin.on('error', () => { });
    ffmpeg.stdout.on('error', () => { });

    ytdlp.stdout.pipe(ffmpeg.stdin);

    ffmpeg.stdout.on('data', (chunk) => {
      if (videoBytesSent === 0) {
        console.log(`[WS Stream] First MPEG1 video chunk produced (${chunk.length} bytes), streaming to client...`);
      }
      videoBytesSent += chunk.length;
      if (ws.readyState === 1) ws.send(chunk);
    });

    const cleanup = () => {
      try { ytdlp.kill(); } catch (e) { }
      try { ffmpeg.kill(); } catch (e) { }
    };

    ytdlp.on('error', (err) => {
      console.error(`[WS yt-dlp spawn error]:`, err.message);
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'error', message: 'yt-dlp spawn failed: ' + err.message }));
      }
      cleanup();
    });

    ytdlp.on('close', (code) => {
      console.log(`[WS yt-dlp] Process exited with code ${code}`);
      if (code !== 0 && videoBytesSent === 0) {
        const errorDetail = ytdlpStderr.trim().split('\n').pop() || `yt-dlp exited with code ${code}`;
        console.error(`[WS yt-dlp failed]: ${errorDetail}`);
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({ type: 'error', message: errorDetail }));
        }
      }
    });

    ffmpeg.on('error', (err) => {
      console.error(`[WS ffmpeg spawn error]:`, err.message);
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'error', message: 'ffmpeg transcode error: ' + err.message }));
      }
      cleanup();
    });

    ffmpeg.on('close', (code) => {
      console.log(`[WS ffmpeg] Process exited with code ${code}, total video bytes sent: ${videoBytesSent}`);
      if (code !== 0 && videoBytesSent === 0) {
        const errorDetail = ffmpegStderr.trim().split('\n').pop() || `Transcoder exited with code ${code}`;
        console.error(`[WS ffmpeg failed]: ${errorDetail}`);
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({ type: 'error', message: errorDetail }));
        }
      }
      cleanup();
      try { ws.close(); } catch (e) { }
    });

    ws.on('close', (code, reason) => {
      console.log(`[WS] Connection closed by client (code: ${code}, total video bytes sent: ${videoBytesSent})`);
      cleanup();
    });
    return;
  }

  // Direct HTTP stream
  const isDirect = channelOrUrl.startsWith('http');
  if (isDirect) {
    doStream(channelOrUrl);
  } else {
    console.warn(`[WS] Unsupported stream channel/URL: "${channelOrUrl}"`);
    ws.send(JSON.stringify({ type: 'error', message: 'Unsupported channel or URL' }));
    ws.close();
  }

  function doStream(streamUrl) {
    console.log(`[WS Stream] Starting direct stream transcoding: ${streamUrl}`);
    ws.send(JSON.stringify({ type: 'status', message: 'Starting MPEG1 stream...' }));
    try {
      const ffmpeg = spawn(FFMPEG, [
        '-re', '-reconnect', '1', '-reconnect_at_eof', '1',
        '-reconnect_streamed', '1', '-reconnect_delay_max', '30',
        '-i', streamUrl, '-an',
        '-c:v', 'mpeg1video', '-q:v', '5', '-b:v', bitrate,
        '-bf', '0',
        '-vf', 'fps=30,scale=' + scale,
        '-f', 'mpegts',
        '-muxdelay', '0.1', '-muxpreload', '0',
        '-',
      ], { stdio: ['ignore', 'pipe', 'pipe'] });

      let streamBytes = 0;
      ffmpeg.stdout.on('data', (chunk) => {
        streamBytes += chunk.length;
        if (ws.readyState === 1) ws.send(chunk);
      });

      ffmpeg.stderr.on('data', () => { });

      ffmpeg.on('close', (code) => {
        console.log(`[WS Direct Stream] ffmpeg closed with code ${code}, bytes sent: ${streamBytes}`);
        if (code !== 0 && streamBytes === 0) {
          try { ws.send(JSON.stringify({ type: 'status', message: 'Stream ended (code ' + code + ')' })); } catch (e) { }
        }
        try { ws.close(); } catch (e) { }
      });
      ffmpeg.on('error', (e) => {
        console.error(`[WS Direct Stream error]:`, e.message);
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({ type: 'error', message: e.message.slice(0, 100) }));
        }
      });

      ws.on('close', () => {
        try { ffmpeg.kill(); } catch (e) { }
      });
    } catch (e) {
      console.error(`[WS Direct Stream exception]:`, e.message);
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'error', message: e.message.slice(0, 100) }));
      }
      ws.close();
    }
  }
}
