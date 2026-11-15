FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg python3 python3-pip ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN pip3 install --no-cache-dir --break-system-packages -U "yt-dlp[default]" curl_cffi

WORKDIR /app
COPY public/server.mjs ./server.mjs

ENV DOWNLOAD_DIR=/tmp/downloads \
    NODE_ENV=production

# The host supplies PORT; the script falls back to 8080 on its own.
EXPOSE 8080

CMD ["node", "server.mjs"]
