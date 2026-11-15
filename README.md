# pake / converter

A self-hosted video and audio converter. Paste a supported YouTube, TikTok,
Instagram, Facebook or X link, choose an output format, and download the result.

This repository contains the website and a Vercel API bridge. The actual media
processing runs on a separate Node.js server using `yt-dlp` and `ffmpeg`.

## Project structure

- `public/` — website, styling, setup guide, converter server and Dockerfile
- `api/convert.js` — Vercel endpoint that forwards conversion requests
- `api/status.js` — reports whether the conversion server is configured
- `lib/core.js` — validates requests and communicates with the conversion server
- `vercel.json` — Vercel routing configuration

## Deploy the website to Vercel

1. Create a new GitHub repository.
2. Upload **all files and folders in this project** to the repository root. The
   `api`, `lib`, and `public` folders must remain at the root level.
3. In Vercel, select **Add New → Project** and import the GitHub repository.
4. Choose **Other** as the framework preset. No build command or install command
   is required.
5. Deploy the project.

The website will load, but conversions will not work until you deploy and connect
the separate conversion server below.

## Deploy the conversion server

The conversion server is `public/server.mjs`. It requires Node.js, `yt-dlp`, and
`ffmpeg`, so it cannot run inside a standard Vercel serverless function.

You can host it on a service that supports a Docker web service (for example,
Render), or on a server you manage.

For a Docker host, use the supplied `public/Dockerfile` and
`public/server.mjs`. Follow the host's instructions for deploying a Docker
service. Configure these environment variables on the conversion server:

- `CONVERT_API_KEY` — a private key used to protect your conversion server.
  Choose your own value and keep it secret.

The server listens on the port supplied by the hosting platform (or port 8080
when running locally). Its health endpoint is `/health`.

## Connect Vercel to the conversion server

In your Vercel project, open **Settings → Environment Variables** and add:

- `CONVERT_API_URL` — the full conversion endpoint, ending in `/api/convert`
- `CONVERT_API_KEY` — exactly the same private key configured on the conversion
  server

Redeploy the Vercel project after adding or changing environment variables.

If `CONVERT_API_URL` is missing, the website will show that the converter has
not been connected. If the URL or key is incorrect, conversion requests will
fail until the configuration is corrected.

## Supported output formats

The website offers the formats reported by the self-hosted conversion service.
Audio and video are transcoded by `ffmpeg`; actual source quality and platform
availability can still vary.

## Security and responsible use

- Never commit API keys, cookies, or other credentials to this repository.
- Keep `CONVERT_API_KEY` in your hosting provider's environment variables.
- Only download content you own or have permission to use, and follow the
  relevant platform terms and copyright laws.

## Local development

Use Node.js 20 or later. Install `yt-dlp` and `ffmpeg` on the machine that will
run the conversion server, then start the server with:

```sh
CONVERT_API_KEY=your-private-key node public/server.mjs
```

The server defaults to port `8080`. Configure the Vercel API environment
variables as described above when deploying the website.
