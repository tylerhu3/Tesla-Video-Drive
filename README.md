# Tesla Video Drive

Stream live video in your Tesla while driving — bypassing the Drive Mode browser restriction.

A diagnostic **probe** to map Tesla browser capabilities + a fully-functional **Twitch live stream client** using only what the embedded Chromium provides.

**Disclaimer**: This is a technical exploration of the Tesla browser's limitations. It is not intended to encourage watching video while driving. The driver remains responsible for their attention on the road.

---

## Background

The Tesla browser runs on **QtWebEngine** (embedded Chromium). It is accessible in both Park and Drive modes — but with restrictions:

- `<video>` elements are **paused** immediately in Drive (last frame frozen, audio continues)
- `getUserMedia` returns an error (microphone blocked at compile time)
- Certain Chromium APIs are limited or missing

This project demonstrates how to work around these limitations using only what the browser provides.

## Architecture

```
                     ┌──────────────────────┐
                     │    Tesla Browser      │
                     │  (QtWebEngine)        │
                     │                       │
                     │  ┌─────────────────┐  │
                     │  │  JSMpeg (WebGL)  │  │
                     │  │  render → canvas │  │
                     │  └────────┬────────┘  │
                     │           │           │
                     │  ┌────────┴────────┐  │
                     │  │  <audio> MP3    │  │
                     │  └────────┬────────┘  │
                     └───────────┼───────────┘
                                 │ WSS / HTTP
                                 │
                    ┌────────────┴────────────┐
                    │    Node.js (Express)     │
                    │                         │
                    │  ┌───────────────────┐  │
                    │  │ yt-dlp → Twitch   │  │
                    │  │ ffmpeg → MPEG1-TS │──┼──→ WSS
                    │  │ ffmpeg → MP3 audio│──┼──→ HTTP
                    │  └───────────────────┘  │
                    └─────────────────────────┘
```

Pages:

| URL | Description |
|-----|-------------|
| `/probe/` | Browser capability diagnostic — tests APIs, codecs, WebGL, mic |
| `/twitch-client/` | Full Twitch client — JSMpeg 30fps, OAuth, audio sync |

## Requirements

- Node.js 18+
- ffmpeg (with libmp3lame and mpeg1video support)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) (install via `pip install yt-dlp`)

## Installation

```bash
git clone https://github.com/madpowah/tesla-video-drive.git
cd tesla-video-drive
npm install
cp .env.example .env
```

Edit `.env` with your Twitch app credentials (see [Configuration](#configuration)).

```bash
npm start
```

The server starts on `http://localhost:8742`.

### Apache reverse proxy (optional)

If you want HTTPS (required for WebSocket on Tesla):

```
ProxyPass / http://127.0.0.1:8742/
RewriteCond %{HTTP:Upgrade} =websocket [NC]
RewriteCond %{HTTP:Connection} =upgrade [NC]
RewriteRule /(.*) ws://127.0.0.1:8742/$1 [P,L]
ProxyTimeout 300
```

## Configuration

| Variable | Description |
|----------|-------------|
| `PORT` | Server port (default: 8742) |
| `TWITCH_CLIENT_ID` | Twitch app client ID |
| `TWITCH_CLIENT_SECRET` | Twitch app client secret |
| `TWITCH_REDIRECT_URI` | OAuth redirect URI (default: `http://localhost:8742/api/twitch/callback`) |
| `YT_DLP` | yt-dlp binary path (default: `yt-dlp`) |

### Setting up Twitch OAuth

1. Go to [dev.twitch.tv/console/apps](https://dev.twitch.tv/console/apps)
2. Click **Register Your Application**
3. Name: anything (e.g. "Tesla Browser")
4. OAuth Redirect URL: `http://YOUR_SERVER:8742/api/twitch/callback`
5. Category: **Application Integration**
6. Copy **Client ID** and **Client Secret** into `.env`

## API Endpoints

### Probe

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/probe-report` | Receive browser diagnostic data (JSON body) |

### Twitch

| Method | Endpoint | Description |
|--------|----------|-------------|
| `WS` | `/ws/mpeg1?channel=X&quality=720` | MPEG1-TS video stream via WebSocket |
| `GET` | `/api/live-audio?channel=X` | MP3 audio stream |
| `GET` | `/api/twitch/live?channel=X` | Check if channel is live |
| `GET` | `/api/twitch/status?channel=X` | Channel title and viewer count |
| `GET` | `/api/twitch/login` | OAuth login redirect |
| `GET` | `/api/twitch/callback` | OAuth callback |
| `GET` | `/api/twitch/follows?token=X` | Fetch followed channels |

### Quality presets

`?quality=360|480|720|1080` maps to ffmpeg scale `640:360|854:480|1280:720|1920:1080`.

## How it works

### Probe (`/probe/`)

A standalone diagnostic page that systematically tests the Tesla browser's capabilities:

- User-Agent, Chromium/WebKit version
- WebSocket, WebGL, Canvas 2D, createImageBitmap
- MediaSource Extensions, VideoDecoder (WebCodecs)
- WebAssembly, ServiceWorker, AudioContext
- H.264, H.265, VP8, VP9 codec support
- Microphone access (getUserMedia)
- Auto-submits a report to the server via `sendBeacon`

### Twitch Client (`/twitch-client/`)

Uses a two-pipe architecture to bypass the `<video>` restriction:

**Video**: `yt-dlp` resolves the Twitch stream URL → `ffmpeg` encodes to MPEG1-TS → WebSocket binary → **JSMpeg** (pure JS + WebGL decoder) → canvas at 30fps

**Audio**: Separate HTTP stream → `ffmpeg` encodes to low-bitrate MP3 → native `<audio>` element (Tesla doesn't block audio)

The video waits for audio to start playing before launching, then compensates for the audio endpoint's ~5s buffer delay by seeking forward.

### Why MPEG1?

MPEG1 with inter-frame compression (P-frames) is ~5x more efficient than sending full JPEG/WebP frames:

| Metric | JPEG frames | MPEG1 + JSMpeg |
|--------|:-----------:|:--------------:|
| FPS | 25 | **30** |
| Bandwidth | ~1.4 Mbps | **~0.8 Mbps** |
| Inter-frame compression | No | Yes |
| GPU acceleration | No | WebGL |

### Key bypass insight

The `<video>` element is hooked by Tesla's system — they call `video.pause()` at the OS level, and `drawImage(video, canvas)` produces a black frame when the source is paused. The solution: **never use `<video>`**. Send individual frames (or MPEG1 transport stream) over WebSocket, decode client-side, and render on a `<canvas>`.

## Probe results (Tesla Chromium)

| API | Status |
|-----|:------:|
| WebSocket | Available |
| Canvas 2D | Available |
| WebGL | Available |
| createImageBitmap | Available |
| MediaSource (MSE) | Limited codecs |
| WebCodecs | Not available |
| WebRTC | Not available |
| getUserMedia | Blocked (compile-time) |
| WebAssembly | Available |

## Known limitations

- **Microphone**: `getUserMedia` is blocked at the Chromium compilation level. Not bypassable from JavaScript.
- **Audio latency**: ~5s delay between video and audio (separate HTTP endpoint buffering)
- **No native controls**: Volume, playback, and sync must be controlled via the custom UI
- **ffmpeg dependency**: The server requires ffmpeg on the path with mpeg1video and libmp3lame support

## License

MIT
