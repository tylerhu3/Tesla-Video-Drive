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
  if (process.env.YT_DLP) return process.env.YT_DLP;
  const candidates = [
    'yt-dlp',
    path.join(process.env.HOME || '', '.local', 'bin', 'yt-dlp'),
    path.join(process.env.HOME || '', 'Library', 'Python', '3.9', 'bin', 'yt-dlp'),
    '/opt/homebrew/bin/yt-dlp',
    '/usr/local/bin/yt-dlp',
    '/usr/bin/yt-dlp'
  ];
  for (const c of candidates) {
    try {
      if (c === 'yt-dlp' || fs.existsSync(c)) return c;
    } catch (e) { }
  }
  return 'yt-dlp';
}
const YT_DLP = resolveYtDlp();

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
// YOUTUBE: search
// ============================================================
app.get('/api/youtube/search', (req, res) => {
  const query = (req.query.q || '').replace(/["`$\\]/g, '').trim().slice(0, 100);
  const limit = Math.min(parseInt(req.query.limit) || 6, 12);
  if (!query) return res.json({ ok: false, error: 'Missing query' });

  const { spawn } = require('child_process');
  const searchArg = `ytsearch${limit}:${query}`;
  const p = spawn(YT_DLP, [
    '--extractor-args', 'youtube:player_client=android',
    '--print', '%(id)s|%(title)s|%(duration_string)s|%(channel)s',
    searchArg
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  let stdout = '';
  p.stdout.on('data', (d) => { stdout += d; });

  const timer = setTimeout(() => {
    try { p.kill(); } catch (e) { }
    res.json({ ok: false, error: 'Search timeout' });
  }, 18000);

  p.on('close', () => {
    clearTimeout(timer);
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
    res.json({ ok: true, results });
  });

  p.on('error', (err) => {
    clearTimeout(timer);
    res.json({ ok: false, error: err.message });
  });
});

// ============================================================
// YOUTUBE: video info
// ============================================================
app.get('/api/youtube/info', (req, res) => {
  const target = extractYouTubeTarget(req.query.v || req.query.url || '');
  if (!target) return res.json({ ok: false, error: 'Invalid or missing YouTube video' });

  const { spawn } = require('child_process');
  const p = spawn(YT_DLP, [
    '--extractor-args', 'youtube:player_client=android',
    '--print', '%(id)s|%(title)s|%(duration_string)s|%(channel)s|%(thumbnail)s',
    target.url
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  let stdout = '';
  p.stdout.on('data', (d) => { stdout += d; });

  const timer = setTimeout(() => {
    try { p.kill(); } catch (e) { }
    res.json({ ok: false, error: 'Info request timeout' });
  }, 15000);

  p.on('close', () => {
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
    res.json({ ok: false, error: err.message });
  });
});

// ============================================================
// AUDIO: live stream (MP3) for YouTube
// ============================================================
app.get('/api/live-audio', (req, res) => {
  const { spawn } = require('child_process');
  res.writeHead(200, {
    'Content-Type': 'audio/mpeg',
    'Cache-Control': 'no-cache, no-store',
    'Access-Control-Allow-Origin': '*',
  });

  const ytTarget = extractYouTubeTarget(req.query.yt || req.query.v || '');
  if (ytTarget) {
    const ytdlp = spawn(YT_DLP, [
      '-f', '18/best',
      '--extractor-args', 'youtube:player_client=android',
      '-o', '-',
      ytTarget.url
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    const ffmpeg = spawn('ffmpeg', [
      '-re',
      '-i', '-',
      '-vn',
      '-fflags', 'nobuffer', '-flags', 'low_delay',
      '-c:a', 'libmp3lame', '-b:a', '48k', '-ar', '22050', '-ac', '1',
      '-f', 'mp3',
      '-'
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    ytdlp.stdout.on('error', () => { });
    ffmpeg.stdin.on('error', () => { });
    ffmpeg.stdout.on('error', () => { });
    res.on('error', () => { });

    ytdlp.stdout.pipe(ffmpeg.stdin);
    ffmpeg.stdout.pipe(res);

    const cleanup = () => {
      try { ytdlp.kill(); } catch (e) { }
      try { ffmpeg.kill(); } catch (e) { }
    };

    req.on('close', cleanup);
    res.on('close', cleanup);
    ytdlp.on('error', cleanup);
    ffmpeg.on('error', cleanup);
    ffmpeg.on('exit', () => { try { res.end(); } catch (e) { } });
    return;
  }

  res.end();
});

// ============================================================
// WEBSOCKET: MPEG1 stream
// ============================================================
const { WebSocketServer } = require('ws');
const wss = new WebSocketServer({ noServer: true, perMessageDeflate: true });

const server = app.listen(PORT, HOST, () => {
  const displayHost = HOST === '0.0.0.0' ? 'localhost' : HOST;
  console.log(`Tesla Browser Bypass running on http://${displayHost}:${PORT} (bound to ${HOST})`);
  console.log(`Static files served from: ${PUBLIC_DIR}`);
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
  var ytParam = url.query.yt || url.query.v || '';
  var channelOrUrl = url.query.channel || url.query.url || ytParam || '';
  var quality = parseInt(url.query.quality) || 720;
  var qualMap = { 360: '640:360', 480: '854:480', 720: '1280:720', 1080: '1920:1080' };
  var scale = qualMap[quality] || '1280:720';

  if (!channelOrUrl) {
    ws.send(JSON.stringify({ type: 'error', message: 'Missing ?channel= or ?yt= or ?url=' }));
    ws.close();
    return;
  }

  streamMpeg1(ws, channelOrUrl, scale, ytParam);
});

function streamMpeg1(ws, channelOrUrl, scale, ytParam) {
  const { spawn, exec } = require('child_process');
  scale = scale || '1280:720';
  var bitrate = scale.endsWith('480') ? '800k' : scale.endsWith('720') ? '1500k' : '2500k';

  // Check if YouTube
  const ytTarget = extractYouTubeTarget(ytParam || (channelOrUrl.includes('youtu') ? channelOrUrl : ''));
  if (ytTarget) {
    ws.send(JSON.stringify({ type: 'status', message: 'Starting YouTube stream...' }));
    const ytdlp = spawn(YT_DLP, [
      '-f', '18/best',
      '--extractor-args', 'youtube:player_client=android',
      '-o', '-',
      ytTarget.url
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    const ffmpeg = spawn('ffmpeg', [
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

    ytdlp.stdout.on('error', () => { });
    ffmpeg.stdin.on('error', () => { });
    ffmpeg.stdout.on('error', () => { });

    ytdlp.stdout.pipe(ffmpeg.stdin);

    ffmpeg.stdout.on('data', (chunk) => {
      if (ws.readyState === 1) ws.send(chunk);
    });

    const cleanup = () => {
      try { ytdlp.kill(); } catch (e) { }
      try { ffmpeg.kill(); } catch (e) { }
    };

    ffmpeg.on('close', (code) => {
      cleanup();
      try { ws.close(); } catch (e) { }
    });

    ffmpeg.on('error', (e) => {
      try { ws.send(JSON.stringify({ type: 'error', message: 'Transcode error' })); } catch (err) { }
      cleanup();
    });

    ytdlp.on('error', (e) => {
      try { ws.send(JSON.stringify({ type: 'error', message: 'Download error' })); } catch (err) { }
      cleanup();
    });

    ws.on('close', cleanup);
    return;
  }

  // Direct HTTP stream
  var isDirect = channelOrUrl.startsWith('http');
  if (isDirect) {
    doStream(channelOrUrl);
  } else {
    ws.send(JSON.stringify({ type: 'error', message: 'Unsupported channel or URL' }));
    ws.close();
  }

  function doStream(streamUrl) {
    ws.send(JSON.stringify({ type: 'status', message: 'Starting MPEG1 stream...' }));
    try {
      const ffmpeg = spawn('ffmpeg', [
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

      ffmpeg.stdout.on('data', (chunk) => {
        if (ws.readyState === 1) ws.send(chunk);
      });

      ffmpeg.stderr.on('data', () => { });

      ffmpeg.on('close', (code) => {
        if (code !== 0) {
          try { ws.send(JSON.stringify({ type: 'status', message: 'Stream ended (code ' + code + ')' })); } catch (e) { }
        }
        try { ws.close(); } catch (e) { }
      });
      ffmpeg.on('error', (e) => {
        ws.send(JSON.stringify({ type: 'error', message: e.message.slice(0, 100) }));
      });

      ws.on('close', () => {
        try { ffmpeg.kill(); } catch (e) { }
      });
    } catch (e) {
      ws.send(JSON.stringify({ type: 'error', message: e.message.slice(0, 100) }));
      ws.close();
    }
  }
}
