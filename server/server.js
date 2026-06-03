const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 8742;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const YT_DLP = process.env.YT_DLP || 'yt-dlp';

// Twitch OAuth
const TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID || '';
const TWITCH_CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET || '';
const TWITCH_REDIRECT_URI = process.env.TWITCH_REDIRECT_URI || 'http://localhost:8742/api/twitch/callback';

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
// TWITCH: live check
// ============================================================
app.get('/api/twitch/live', (req, res) => {
  var ch = (req.query.channel || '').replace(/[^a-zA-Z0-9_]/g, '');
  if (!ch) return res.json({ live: false, error: 'Missing channel' });
  const { exec } = require('child_process');
  exec(`${YT_DLP} --format 'best[height<=720]' -g 'https://www.twitch.tv/${ch}'`, {
    timeout: 15000,
  }, (err, stdout) => {
    var live = !err && stdout && stdout.trim().length > 0;
    res.json({ channel: ch, live: live });
  });
});

// ============================================================
// TWITCH: channel status (title, viewers)
// ============================================================
app.get('/api/twitch/status', (req, res) => {
  const { execSync } = require('child_process');
  const channel = (req.query.channel || '').replace(/[^a-zA-Z0-9_]/g, '');
  if (!channel) return res.json({ error: 'Missing channel' });
  try {
    const out = execSync(
      `${YT_DLP} --print "%(title)s|%(view_count)s" "https://www.twitch.tv/${channel}"`,
      { timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] }
    ).toString().trim();
    const parts = out.split('|');
    res.json({ live: true, channel, title: parts[0] || 'Live', viewers: parseInt(parts[1]) || 0 });
  } catch (e) {
    const stderr = e.stderr ? e.stderr.toString() : '';
    if (stderr.includes('not currently live') || stderr.includes('offline')) {
      res.json({ live: false, channel });
    } else {
      res.json({ live: false, channel, error: stderr.slice(0, 80) });
    }
  }
});

// ============================================================
// TWITCH: audio stream (MP3)
// ============================================================
app.get('/api/live-audio', (req, res) => {
  const { spawn, execSync } = require('child_process');
  const channel = (req.query.channel || '').replace(/[^a-zA-Z0-9_]/g, '');
  res.writeHead(200, {
    'Content-Type': 'audio/mpeg',
    'Cache-Control': 'no-cache, no-store',
    'Access-Control-Allow-Origin': '*',
  });
  try {
    const streamUrl = execSync(
      `${YT_DLP} -g --format "best[height<=720]" "https://www.twitch.tv/${channel}"`,
      { timeout: 20000 }
    ).toString().trim().split('\n')[0];
    if (streamUrl && streamUrl.startsWith('http')) {
      const ffmpeg = spawn('ffmpeg', [
        '-re', '-reconnect', '1', '-reconnect_at_eof', '1',
        '-reconnect_streamed', '1', '-reconnect_delay_max', '30',
        '-i', streamUrl, '-vn',
        '-fflags', 'nobuffer', '-flags', 'low_delay',
        '-analyzeduration', '0', '-probesize', '32',
        '-c:a', 'libmp3lame', '-b:a', '48k', '-ar', '22050', '-ac', '1',
        '-f', 'mp3', '-',
      ], { stdio: ['ignore', 'pipe', 'pipe'] });
      ffmpeg.stdout.pipe(res);
      ffmpeg.stderr.on('data', () => {});
      ffmpeg.on('exit', () => { try { res.end(); } catch (e) {} });
      req.on('close', () => ffmpeg.kill());
    } else {
      res.end();
    }
  } catch (e) {
    res.status(500).end();
  }
});

// ============================================================
// TWITCH: OAuth login
// ============================================================
app.get('/api/twitch/login', (req, res) => {
  if (!TWITCH_CLIENT_ID) {
    return res.send(`<html><body style="background:#0a0a0f;color:#e0e0e0;font-family:sans-serif;padding:20px;">
      <h1 style="color:#9146ff;">Twitch Login</h1>
      <p>Set <b>TWITCH_CLIENT_ID</b> and <b>TWITCH_CLIENT_SECRET</b> in your .env file.</p>
      <ol>
        <li>Go to <a href="https://dev.twitch.tv/console/apps" style="color:#9146ff;">dev.twitch.tv</a></li>
        <li>Register an Application (redirect URI: <b>${TWITCH_REDIRECT_URI}</b>)</li>
        <li>Copy Client ID and Client Secret into .env</li>
      </ol>
      <p style="color:#888;">No payment info required — it's free.</p>
    </body></html>`);
  }
  var url = 'https://id.twitch.tv/oauth2/authorize'
    + '?client_id=' + TWITCH_CLIENT_ID
    + '&redirect_uri=' + encodeURIComponent(TWITCH_REDIRECT_URI)
    + '&response_type=code'
    + '&scope=user:read:follows';
  res.redirect(url);
});

// ============================================================
// TWITCH: OAuth callback
// ============================================================
app.get('/api/twitch/callback', (req, res) => {
  var code = req.query.code;
  if (!code) return res.status(400).send('Missing code');
  const https = require('https');
  var data = 'client_id=' + TWITCH_CLIENT_ID
    + '&client_secret=' + TWITCH_CLIENT_SECRET
    + '&code=' + encodeURIComponent(code)
    + '&grant_type=authorization_code'
    + '&redirect_uri=' + encodeURIComponent(TWITCH_REDIRECT_URI);
  var req2 = https.request({
    hostname: 'id.twitch.tv',
    method: 'POST',
    path: '/oauth2/token',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  }, (res2) => {
    var body = '';
    res2.on('data', (chunk) => body += chunk);
    res2.on('end', () => {
      try {
        var token = JSON.parse(body);
        if (token.access_token) {
          res.redirect('/twitch-client/?token=' + token.access_token + '&login=success');
        } else {
          res.send('OAuth error: ' + JSON.stringify(token));
        }
      } catch (e) {
        res.send('Parse error: ' + body);
      }
    });
  });
  req2.write(data);
  req2.end();
});

// ============================================================
// TWITCH: followed channels
// ============================================================
app.get('/api/twitch/follows', (req, res) => {
  var token = req.query.token;
  if (!token) return res.json({ error: 'Missing token' });
  const https = require('https');
  https.get({
    hostname: 'api.twitch.tv',
    path: '/helix/users',
    headers: {
      'Client-ID': TWITCH_CLIENT_ID,
      'Authorization': 'Bearer ' + token,
    },
  }, (res2) => {
    var body = '';
    res2.on('data', (c) => body += c);
    res2.on('end', () => {
      try {
        var user = JSON.parse(body);
        if (!user.data || !user.data[0]) return res.json({ error: 'No user' });
        var userId = user.data[0].id;
        https.get({
          hostname: 'api.twitch.tv',
          path: '/helix/channels/followed?user_id=' + userId + '&first=100',
          headers: {
            'Client-ID': TWITCH_CLIENT_ID,
            'Authorization': 'Bearer ' + token,
          },
        }, (res3) => {
          var body2 = '';
          res3.on('data', (c) => body2 += c);
          res3.on('end', () => {
            try {
              var follows = JSON.parse(body2);
              var channels = (follows.data || []).map(function (f) {
                return f.broadcaster_name ? f.broadcaster_name.toLowerCase() : null;
              }).filter(Boolean);
              res.json({ ok: true, channels: channels, total: follows.total || channels.length });
            } catch (e) {
              res.json({ error: 'Parse error', data: body2.slice(0, 200) });
            }
          });
        });
      } catch (e) {
        res.json({ error: 'Parse error', data: body.slice(0, 200) });
      }
    });
  });
});

// ============================================================
// WEBSOCKET: MPEG1 stream
// ============================================================
const { WebSocketServer } = require('ws');
const wss = new WebSocketServer({ noServer: true, perMessageDeflate: true });

const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`Tesla Browser Bypass running on http://127.0.0.1:${PORT}`);
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
  var channelOrUrl = url.query.channel || url.query.url || '';
  var quality = parseInt(url.query.quality) || 720;
  var qualMap = { 360: '640:360', 480: '854:480', 720: '1280:720', 1080: '1920:1080' };
  var scale = qualMap[quality] || '1280:720';

  if (!channelOrUrl) {
    ws.send(JSON.stringify({ type: 'error', message: 'Missing ?channel= or ?url=' }));
    ws.close();
    return;
  }

  streamMpeg1(ws, channelOrUrl, scale);
});

function streamMpeg1(ws, channelOrUrl, scale) {
  const { spawn, exec } = require('child_process');
  scale = scale || '1280:720';
  var bitrate = scale.endsWith('480') ? '800k' : scale.endsWith('720') ? '1500k' : '2500k';

  var isDirect = channelOrUrl.startsWith('http');
  if (isDirect) {
    doStream(channelOrUrl);
  } else {
    var channel = channelOrUrl.replace(/[^a-zA-Z0-9_]/g, '');
    ws.send(JSON.stringify({ type: 'status', message: 'Resolving ' + channel + '...' }));
    var cmd = `${YT_DLP} --format "best[height<=720]" -g "https://www.twitch.tv/${channel}"`;
    exec(cmd, { timeout: 20000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err || !stdout || !stdout.trim()) {
        ws.send(JSON.stringify({ type: 'error', message: 'Channel offline or not found' }));
        ws.close();
        return;
      }
      doStream(stdout.trim().split('\n')[0]);
    });
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

      ffmpeg.stderr.on('data', () => {});

      ffmpeg.on('close', (code) => {
        if (code !== 0) {
          try { ws.send(JSON.stringify({ type: 'status', message: 'Stream ended (code ' + code + ')' })); } catch (e) {}
        }
        try { ws.close(); } catch (e) {}
      });
      ffmpeg.on('error', (e) => {
        ws.send(JSON.stringify({ type: 'error', message: e.message.slice(0, 100) }));
      });

      ws.on('close', () => {
        try { ffmpeg.kill(); } catch (e) {}
      });
    } catch (e) {
      ws.send(JSON.stringify({ type: 'error', message: e.message.slice(0, 100) }));
      ws.close();
    }
  }
}
