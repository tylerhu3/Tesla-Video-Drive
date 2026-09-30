#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const binDir = path.join(__dirname, '..', 'bin');
const targetFile = path.join(binDir, 'yt-dlp');

function checkSystemYtDlp() {
  try {
    const which = execSync('which yt-dlp', { stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).toString().trim();
    if (which && fs.existsSync(which)) {
      console.log(`[install-ytdlp] Found system yt-dlp at: ${which}`);
      return which;
    }
  } catch (e) {}

  const commonPaths = [
    '/usr/local/bin/yt-dlp',
    '/usr/bin/yt-dlp',
    path.join(process.env.HOME || '', '.local', 'bin', 'yt-dlp'),
    path.join(process.env.HOME || '', 'Library', 'Python', '3.9', 'bin', 'yt-dlp'),
    '/opt/homebrew/bin/yt-dlp'
  ];
  for (const p of commonPaths) {
    if (fs.existsSync(p)) {
      console.log(`[install-ytdlp] Found system yt-dlp at: ${p}`);
      return p;
    }
  }
  return null;
}

function hasPython3() {
  try {
    const out = execSync('python3 --version', { stdio: ['ignore', 'pipe', 'ignore'], timeout: 4000 }).toString();
    return out.toLowerCase().includes('python 3');
  } catch (e) {
    return false;
  }
}

function downloadBinary(url, destPath) {
  return new Promise((resolve, reject) => {
    console.log(`[install-ytdlp] Fetching ${url}...`);
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Node.js/install-ytdlp)'
      }
    };
    https.get(url, options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return downloadBinary(res.headers.location, destPath).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`Failed to download yt-dlp: HTTP ${res.statusCode}`));
      }
      const file = fs.createWriteStream(destPath);
      res.pipe(file);
      file.on('finish', () => {
        file.close(() => {
          try { fs.chmodSync(destPath, 0o755); } catch (_) {}
          console.log(`[install-ytdlp] Download completed: ${destPath}`);
          resolve(destPath);
        });
      });
      file.on('error', (err) => {
        fs.unlink(destPath, () => {});
        reject(err);
      });
    }).on('error', reject);
  });
}

async function main() {
  console.log('[install-ytdlp] Checking yt-dlp availability...');
  
  if (fs.existsSync(targetFile)) {
    try {
      fs.chmodSync(targetFile, 0o755);
      const ver = execSync(`"${targetFile}" --version`, { stdio: ['ignore', 'pipe', 'ignore'], timeout: 20000 }).toString().trim();
      console.log(`[install-ytdlp] Local bin/yt-dlp already exists (version ${ver})`);
      return;
    } catch (e) {
      console.warn(`[install-ytdlp] Existing bin/yt-dlp check failed (${e.message}), will re-verify or redownload.`);
    }
  }

  const systemYtDlp = checkSystemYtDlp();
  if (systemYtDlp) {
    try {
      const ver = execSync(`"${systemYtDlp}" --version`, { stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000 }).toString().trim();
      console.log(`[install-ytdlp] System yt-dlp is functional (version ${ver}). Skipping standalone download.`);
      return;
    } catch (e) {
      console.warn(`[install-ytdlp] System yt-dlp check failed: ${e.message}`);
    }
  }

  // Not found in system, download binary
  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true });
  }

  // If system has python3, universal zipapp is 2.5MB and starts 10x faster
  const python3Available = hasPython3();
  let downloadUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';

  if (!python3Available) {
    if (process.platform === 'darwin') {
      downloadUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos';
    } else if (process.platform === 'linux') {
      if (process.arch === 'arm64') {
        downloadUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux_aarch64';
      } else {
        downloadUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux';
      }
    }
  }

  try {
    await downloadBinary(downloadUrl, targetFile);
    const ver = execSync(`"${targetFile}" --version`, { stdio: ['ignore', 'pipe', 'ignore'], timeout: 20000 }).toString().trim();
    console.log(`[install-ytdlp] yt-dlp verified! Version: ${ver}`);
  } catch (err) {
    console.error(`[install-ytdlp] Error downloading or verifying: ${err.message}`);
    // If specific architecture binary fails, try generic POSIX yt-dlp binary
    if (downloadUrl !== 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp') {
      console.log('[install-ytdlp] Falling back to generic POSIX yt-dlp binary...');
      try {
        await downloadBinary('https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp', targetFile);
        console.log('[install-ytdlp] Generic yt-dlp downloaded.');
      } catch (err2) {
        console.error(`[install-ytdlp] Fallback also failed: ${err2.message}`);
      }
    }
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error('[install-ytdlp] Fatal error:', err);
  });
}

module.exports = { main, checkSystemYtDlp, targetFile };

