# Tesla Video Drive

Stream video and audio in your Tesla while driving — bypassing the vehicle's Drive Mode browser video restriction.

This repository provides:
1. **Browser Probe (`/probe/`)**: A diagnostic suite to audit Tesla's embedded Chromium browser capabilities, media codecs, hardware acceleration, and security sandboxing.
2. **YouTube Player (`/youtube-client/`)**: A standalone client that streams YouTube videos and live broadcasts at 30 FPS using client-side WebGL canvas decoding and low-latency audio streaming.

> [!WARNING]
> **Disclaimer**: Watching video while operating a motor vehicle is **extremely dangerous and illegal** in most jurisdictions. This project is created strictly as a technical research demonstration exploring embedded browser limitations. Do not use while driving. The author assumes no responsibility or liability for misuse.

---

## Background & Technical Bypass

The Tesla in-car browser is built on **QtWebEngine** (embedded Chromium). While the browser remains interactive in both **Park** and **Drive** modes, Tesla implements specific restrictions once the vehicle shifts into gear:

- **`<video>` element suppression**: Native HTML5 `<video>` playback is paused at the OS/compositor level when shifting into Drive (the audio track continues or pauses depending on vehicle firmware, but video frames immediately freeze).
- **Canvas copying blocked**: Attempting to draw an active or paused `<video>` element to a `<canvas>` via `ctx.drawImage(video, ...)` produces a black frame once Drive mode is engaged.
- **`getUserMedia` restricted**: Audio input (microphone) is disabled at compile time.
- **WebCodecs / WebRTC**: Advanced hardware decoders and WebRTC streaming are unavailable or restricted.

### The Bypass Architecture

Instead of relying on the native video player pipeline, this project bypasses the restriction entirely:

1. **Video Pipe (WebSocket + MPEG1 + WebGL Canvas)**:
   - Server runs `yt-dlp` to extract the stream.
   - Server pipes the video stream to `ffmpeg` to encode into an **MPEG1 transport stream (TS)** at 30 FPS.
   - Server sends raw binary chunks over a WebSocket (`/ws/mpeg1`).
   - The browser uses **JSMpeg** (a JavaScript MPEG1 decoder) with WebGL acceleration to decode and render frames directly into an HTML5 `<canvas>`.
   - Because the browser is rendering to a standard `<canvas>` element and never creates a `<video>` tag, the vehicle's Drive Mode restriction is never triggered.

2. **Audio Pipe (HTTP MP3 + Native `<audio>`)**:
   - In parallel, the server extracts and transcodes audio to a lightweight MP3 stream (`libmp3lame`, 48 kbps, 22.05 kHz mono) served over HTTP (`/api/live-audio`).
   - The client plays this stream using a standard `<audio>` element (which Tesla does not block while driving).
   - The player automatically coordinates video startup with audio buffering, with manual sync offset buttons (`-1s` / `+1s`) to account for varying network latency.

```
                    ┌───────────────────────────────────┐
                    │       Tesla Browser (Drive)       │
                    │          (QtWebEngine)            │
                    │                                   │
                    │   ┌───────────────────────────┐   │
                    │   │       JSMpeg Player       │   │
                    │   │  WebGL Decode → <canvas>  │   │
                    │   └─────────────▲─────────────┘   │
                    │                 │                 │
                    │   ┌─────────────┴─────────────┐   │
                    │   │      <audio> Element      │   │
                    │   │       MP3 Playback        │   │
                    │   └─────────────▲─────────────┘   │
                    └─────────────────┼─────────────────┘
                                      │ WSS / HTTPS
                                      │
                   ┌──────────────────┴──────────────────┐
                   │          Node.js Server             │
                   │                                     │
                   │   ┌─────────────────────────────┐   │
                   │   │   yt-dlp (YouTube Extract)  │   │
                   │   │   ffmpeg → MPEG1-TS (WSS)   │───┼──→ WebSocket
                   │   │   ffmpeg → MP3 Audio (HTTP) │───┼──→ /api/live-audio
                   │   └─────────────────────────────┘   │
                   └─────────────────────────────────────┘
```

### Why MPEG1 & JSMpeg?

MPEG1 video with inter-frame motion compression (I-frames and P-frames) provides significant efficiency advantages over streaming individual JPEG or WebP images:

| Metric | JPEG over WebSocket | MPEG1 + JSMpeg (WebGL) |
|--------|:-------------------:|:----------------------:|
| Frame Rate | ~20–25 FPS | **30 FPS steady** |
| Bandwidth | ~1.5–2.5 Mbps | **~0.8–1.5 Mbps** |
| Inter-frame compression | No (100% full keyframes) | Yes (P-frame compression) |
| Decoding overhead | CPU-bound `Image` parsing | **GPU-accelerated WebGL shader** |

---

## Features

### YouTube Player (`/youtube-client/`)
- **Built-in Search**: Search YouTube directly from the car's browser without leaving the interface.
- **Direct Playback**: Paste any YouTube URL (`youtube.com/watch?v=...`, `youtu.be/...`, shorts, or live stream) or an 11-character video ID.
- **Quick Presets**: One-click pills for popular topics (*Tesla News*, *Lofi Live*, *Car Reviews*, *Synthwave*).
- **Recent Watch History**: Automatically saves played videos in browser `localStorage` for easy resume.
- **Quality Selector**: Switch between 360p, 480p, 720p (default), and 1080p transcoding profiles.
- **Audio Sync & Volume Controls**: On-screen volume slider and manual `-1s` / `+1s` time alignment buttons to ensure synchronization.
- **Live Diagnostics**: On-screen real-time FPS counter and connection status monitor.
- **Direct Stream Support**: Can transcode direct HTTP video streams.

### Browser Diagnostic Probe (`/probe/`)
- System & Engine detection (User-Agent, Chromium, WebKit).
- Graphic & Rendering checks (Canvas 2D, WebGL, `createImageBitmap`).
- Media API tests (MediaSource Extensions, WebCodecs, WebRTC, AudioContext).
- Video codec checks (H.264, H.265, VP8, VP9, AV1).
- Hardware and input tests (`getUserMedia` microphone capability).
- One-click automatic reporting to server via `navigator.sendBeacon`.

---

## Project Structure

```
tesla-video-drive/
├── .env.example              # Sample environment configuration
├── package.json              # Node dependencies and npm scripts
├── server/
│   └── server.js             # Express API, WebSocket handler, yt-dlp & ffmpeg pipelines
└── public/
    ├── index.html            # Landing / navigation hub
    ├── probe/
    │   └── index.html        # Browser capability diagnostic suite
    └── youtube-client/
        ├── index.html        # YouTube player client interface
        └── jsmpeg.min.js     # WebGL MPEG1 decoder library
```

---

## Requirements

- **Node.js**: v18.0.0+ (Node 20+ recommended for native `.env` loading)
- **ffmpeg**: Compiled with `libmp3lame` (MP3 audio) and `mpeg1video` (MPEG1 transcode) support
- **yt-dlp**: Required to extract YouTube stream manifests

---

## Installation

### 1. Install System Dependencies

#### macOS
```bash
brew install ffmpeg yt-dlp
```

#### Debian / Ubuntu
```bash
sudo apt update
sudo apt install ffmpeg python3-pip
pip install yt-dlp
```

#### Windows (via Scoop)
```bash
scoop install ffmpeg yt-dlp
```

Verify that both utilities are executable on your path:
```bash
ffmpeg -version | head -n 1
yt-dlp --version
```

### 2. Clone and Install Node Packages

```bash
git clone https://github.com/tylerhu3/Tesla-Video-Drive.git
cd Tesla-Video-Drive
npm install
```

### 3. Environment Configuration

Copy the example configuration:
```bash
cp .env.example .env
```

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Local port the HTTP and WebSocket server listens on | `8742` |
| `HOST` | Host address to bind the server to (`0.0.0.0` binds to all network interfaces, required for Render/Docker) | `0.0.0.0` |
| `YT_DLP` | Explicit path to `yt-dlp` binary | Auto-detected (`yt-dlp`, `/opt/homebrew/bin/yt-dlp`, `~/.local/bin/yt-dlp`, etc.) |

---

## Running the Application

### Start Locally

```bash
npm start
```

The server binds to `0.0.0.0:8742` by default (accessible via `http://localhost:8742/`):
- Landing Page: `http://localhost:8742/`
- Diagnostic Probe: `http://localhost:8742/probe/`
- YouTube Player: `http://localhost:8742/youtube-client/`

---

## Connecting from Your Tesla

The Tesla browser requires **HTTPS** and secure WebSockets (**WSS**) for reliable streaming over external connections. You can expose your local server securely using one of the following methods:

### Option A: Cloudflare Tunnel (Recommended for Local Running — No port forwarding required)

1. Install `cloudflared`:
   ```bash
   brew install cloudflared       # macOS
   # or follow https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/
   ```
2. Start an ad-hoc tunnel to your local server:
   ```bash
   cloudflared tunnel --url http://127.0.0.1:8742
   ```
3. Copy the generated `https://*.trycloudflare.com` URL into your Tesla's browser and bookmark it.

### Option B: Cloud Hosting (Render / Railway / Docker)

When deploying to **Render**:
1. **Bind Address**: Render requires services to listen on `0.0.0.0` and uses the `PORT` environment variable (defaults to `10000`). The server binds to `HOST` (default `0.0.0.0`) and `PORT` automatically.
2. **System Dependencies (`ffmpeg` & `yt-dlp`)**: The project requires both `ffmpeg` and `yt-dlp` at runtime.
   - **Recommended (Docker)**: Render automatically detects the included `Dockerfile` when creating a Web Service. This packages Node 20, `ffmpeg`, and `yt-dlp` in a single container.
   - **Native Node Environment**: If using Render's native Node.js runtime instead of Docker, configure the **Build Command** to install system tools:
     ```bash
     npm install && pip3 install yt-dlp
     ```
     *(Note: If `ffmpeg` is not present in the native environment, Docker deployment is strongly recommended.)*

### Option C: Nginx Reverse Proxy

If hosting on a remote VPS or dedicated domain with SSL (e.g., Let's Encrypt):

```nginx
server {
    listen 443 ssl http2;
    server_name tesla.yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/tesla.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/tesla.yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8742;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
```

### Option D: Apache Reverse Proxy

```apache
<VirtualHost *:443>
    ServerName tesla.yourdomain.com

    SSLEngine on
    SSLCertificateFile /path/to/cert.pem
    SSLCertificateKeyFile /path/to/privkey.pem

    ProxyPass / http://127.0.0.1:8742/
    RewriteEngine On
    RewriteCond %{HTTP:Upgrade} =websocket [NC]
    RewriteCond %{HTTP:Connection} =upgrade [NC]
    RewriteRule /(.*) ws://127.0.0.1:8742/$1 [P,L]
    ProxyTimeout 3600
</VirtualHost>
```

---

## API Reference

### Diagnostic Endpoints

#### `POST /api/probe-report`
Receives diagnostic telemetry submitted by `/probe/` and saves it locally in `probe-reports/probe-<timestamp>.json`.
- **Content-Type**: `application/json`
- **Response**: `{ "ok": true, "file": "<path>" }`

---

### YouTube & Streaming Endpoints

#### `GET /api/youtube/search`
Searches YouTube videos using `yt-dlp`'s Android client extractor.
- **Query Parameters**:
  - `q`: Search keyword or phrase (string, up to 100 characters)
  - `limit`: Number of results (number, 1–12, default `6`)
- **Response**:
  ```json
  {
    "ok": true,
    "results": [
      {
        "id": "dQw4w9WgXcQ",
        "title": "Rick Astley - Never Gonna Give You Up",
        "duration": "3:33",
        "channel": "Rick Astley"
      }
    ]
  }
  ```

#### `GET /api/youtube/info`
Fetches metadata and thumbnail information for a given video.
- **Query Parameters**:
  - `v` or `url`: YouTube Video ID or full URL
- **Response**:
  ```json
  {
    "ok": true,
    "id": "dQw4w9WgXcQ",
    "title": "Rick Astley - Never Gonna Give You Up",
    "duration": "3:33",
    "channel": "Rick Astley",
    "thumbnail": "https://..."
  }
  ```

#### `GET /api/live-audio`
Streams live audio transcoded on-the-fly to MP3 (`libmp3lame`, 48 kbps, 22.05 kHz mono) for consumption by HTML5 `<audio>`.
- **Query Parameters**:
  - `yt` or `v`: YouTube Video ID or URL

#### `WS /ws/mpeg1`
WebSocket endpoint providing real-time MPEG1-TS video stream encoded by `ffmpeg` at 30 FPS.
- **Query Parameters**:
  - `yt` or `v`: YouTube Video ID or URL
  - `channel` or `url`: Direct HTTP video stream URL
  - `quality`: Video resolution (`360`, `480`, `720`, `1080` — default `720`)

##### Quality Presets & Bitrate Mapping:
| Quality | Output Scale | Video Bitrate |
|---------|:------------:|:-------------:|
| `360`   | 640x360      | 800 kbps      |
| `480`   | 854x480      | 800 kbps      |
| `720`   | 1280x720     | 1500 kbps     |
| `1080`  | 1920x1080    | 2500 kbps     |

---

## Diagnostic Probe Findings (Tesla QtWebEngine Chromium)

Tested across Tesla firmware versions 2024.x–2026.x:

| Capability / API | Status in Tesla Browser | Notes |
|------------------|:-----------------------:|-------|
| **HTML5 `<video>`** | Blocked in Drive | Pauses on gear shift; `drawImage` turns black |
| **HTML5 `<canvas>` (2D & WebGL)** | **Fully Available** | Smooth rendering in both Park & Drive |
| **WebSocket (`ws://`, `wss://`)** | **Fully Available** | Handles binary video streams with low latency |
| **HTML5 `<audio>`** | **Fully Available** | Audio continues playing in Drive Mode |
| **`createImageBitmap`** | Available | Fast image decoding |
| **MediaSource Extensions (MSE)** | Limited | Codec support is restricted |
| **WebCodecs (`VideoDecoder`)** | Not Available | Modern hardware decoding API disabled |
| **WebAssembly (Wasm)** | **Available** | Fast client-side computation |
| **`getUserMedia` (Microphone)** | Blocked | Disabled at Chromium build compile-time |

---

## Known Limitations & Tips

- **Initial Audio/Video Synchronization**: The separate audio HTTP stream and WebSocket MPEG1 stream initiate independently. The player waits for audio to buffer before starting JSMpeg, but network variations can introduce a slight offset. Use the **`-1s`** and **`+1s`** sync buttons in the player toolbar to adjust if necessary.
- **Microphone Access**: Blocked at the compile level by Tesla. Voice control via the browser's web microphone is impossible without vehicle firmware modification.
- **Network Bandwidth**: While MPEG1 is lightweight (~1–2 Mbps), streaming over the vehicle's built-in cellular connection requires a stable signal. If stuttering occurs, drop the quality selector to `480p` or `360p`.

---

## License

MIT
