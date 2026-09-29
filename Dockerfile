FROM node:20-bookworm-slim

# Install system dependencies: ffmpeg, python3, and yt-dlp
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 \
    python3-pip \
    ca-certificates \
    curl \
 && pip3 install --break-system-packages --no-cache-dir yt-dlp \
 && ln -sf $(which yt-dlp || echo /usr/local/bin/yt-dlp) /usr/bin/yt-dlp \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package descriptors and install production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application files
COPY . .

# Set default environment variables
ENV HOST=0.0.0.0
ENV PORT=10000

EXPOSE 10000

CMD ["node", "server/server.js"]
