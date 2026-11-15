# pake / converter

**pake / converter** is a self-hosted web tool for converting supported social-media video links into downloadable audio or video files.

Paste a supported link, choose an output type and quality, and let the connected conversion server prepare the file. The project uses a lightweight web frontend with a separate Node.js conversion service powered by `yt-dlp` and `ffmpeg`.

## Supported platforms

- TikTok
- Instagram
- Facebook
- X (formerly Twitter)

Platform availability can vary depending on the source post and the platform's access restrictions. Private, restricted, deleted or otherwise unavailable content may not be accessible.

## Features

- Audio export in supported formats such as MP3, M4A, AAC, FLAC, WAV, OGG and Opus.
- Video export in supported resolutions and formats.
- Self-hosted conversion backend.
- Browser-based interface with no user account system.
- Temporary download files that are automatically cleaned up by the conversion server.
- API bridge between the website and the conversion server.

The exact formats offered by the interface are determined by the conversion service configuration.

## How it is built

- **Frontend:** HTML, CSS and JavaScript
- **Web/API layer:** Vercel serverless functions
- **Conversion service:** Node.js
- **Media processing:** `yt-dlp` and `ffmpeg`

## Repository layout

- `public/` — website assets and the conversion server
- `api/` — Vercel API endpoints
- `lib/` — request validation and conversion-service communication
- `vercel.json` — Vercel function configuration

## Privacy and security

This repository is intended to contain application source code only. Deployment credentials and private configuration should be stored in the environment-variable settings of the hosting provider, never committed to Git.

The conversion service may temporarily process and store files while preparing downloads. Files are configured to be removed automatically after a short retention period.

## Responsible use

Use this tool only for content you own or are authorized to download. Respect the terms of service of the relevant platforms and applicable copyright laws.

---

Made with ❤️ by Paka.
