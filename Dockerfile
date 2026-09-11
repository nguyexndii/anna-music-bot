# Base image with Node.js 20 on Debian Bookworm Slim
FROM node:20-bookworm-slim

# Install system dependencies: FFmpeg, Python3 (for yt-dlp audio extraction), build-essential (for native opus), CA certificates, curl
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 \
    python-is-python3 \
    build-essential \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files and install production dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy application source code
COPY . .

# Set default HTTP port
ENV PORT=3000
EXPOSE 3000

# Start the music bot
CMD ["node", "src/index.js"]
