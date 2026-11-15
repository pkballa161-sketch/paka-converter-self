#!/usr/bin/env node
/**
 * Tube2MP3 conversion service.
 *
 * A tiny HTTP server that turns a video link into a file using yt-dlp + ffmpeg,
 * and can transcode it to almost any container on request.
 *
 *   node server/server.mjs          # listens on http://localhost:8080
 *   PORT=9000 node server/server.mjs
 *
 * Requirements: yt-dlp and ffmpeg on your PATH.
 *   macOS:  brew install yt-dlp ffmpeg
 *   Ubuntu: sudo apt install ffmpeg && pipx install yt-dlp
 *   Windows: winget install yt-dlp ffmpeg
 */

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

const PORT = Number(process.env.PORT || 8080);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DOWNLOADS = process.env.DOWNLOAD_DIR || path.join(HERE, "downloads");
const TTL_MS = 15 * 60 * 1000;
const YTDLP = process.env.YTDLP_BIN || "yt-dlp";
const FFMPEG = process.env.FFMPEG_BIN || "ffmpeg";
const REQUIRED_KEY = process.env.CONVERT_API_KEY || "";
const MAX_CONCURRENT_JOBS = Number(process.env.MAX_CONCURRENT_JOBS || 2);
let activeJobs = 0;

/* Cookies let yt-dlp look like a signed-in visitor, which is what gets past the
 * "are you a bot?" walls on TikTok and Instagram. Raw text or base64 both work. */
const COOKIES_TXT = process.env.COOKIES_TXT || "";
const COOKIES_B64 = process.env.COOKIES_B64 || "";
const COOKIES_FILE = process.env.COOKIES_FILE || path.join(HERE, "cookies.txt");
const EXTRA_ARGS = (process.env.YTDLP_EXTRA_ARGS || "").trim();
let cookiesReady = false;

async function prepareCookies() {
  const raw = (COOKIES_B64
    ? Buffer.from(COOKIES_B64.trim(), "base64").toString("utf8")
    : COOKIES_TXT
  ).trim();
  if (!raw) return false;
  const body = /^#\s*(Netscape|HTTP Cookie File)/i.test(raw)
    ? raw
    : `# Netscape HTTP Cookie File\n${raw}`;
  try {
    await writeFile(COOKIES_FILE, body.endsWith("\n") ? body : `${body}\n`, { mode: 0o600 });
    cookiesReady = true;
  } catch {
    cookiesReady = false;
  }
  return cookiesReady;
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type,accept",
};

const SUPPORTED_HOSTS = [
  "instagram.com",
  "instagr.am",
  "tiktok.com",
  "facebook.com",
  "fb.watch",
  "fb.com",
  "x.com",
  "twitter.com",
  "t.co",
  "vimeo.com",
  "reddit.com",
  "twitch.tv",
  "dailymotion.com",
  "soundcloud.com",
  "pinterest.com",
  "twitch.tv",
];

/* Audio containers we can genuinely encode. */
const AUDIO_CODECS = {
  mp3: ["-c:a", "libmp3lame", "-b:a", "192k"],
  m4a: ["-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart"],
  aac: ["-c:a", "aac", "-b:a", "192k"],
  ogg: ["-c:a", "libvorbis", "-q:a", "5"],
  opus: ["-c:a", "libopus", "-b:a", "128k"],
  flac: ["-c:a", "flac", "-compression_level", "5"],
  wav: ["-c:a", "pcm_s16le"],
  aiff: ["-c:a", "pcm_s16be"],
};

/* Video containers we can genuinely produce. */
const VIDEO_CODECS = {
  mp4: ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart"],
  mkv: ["-c:v", "copy", "-c:a", "copy"],
  webm: ["-c:v", "libvpx-vp9", "-crf", "32", "-b:v", "0", "-row-mt", "1", "-c:a", "libopus", "-b:a", "128k"],
  mov: ["-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart"],
  avi: ["-c:v", "mpeg4", "-q:v", "5", "-c:a", "libmp3lame", "-b:a", "160k"],
  gif: ["-vf", "fps=12,scale=480:-1:flags=lanczos", "-an"],
};

const send = (res, status, body, type = "application/json; charset=utf-8") => {
  res.writeHead(status, { ...CORS, "content-type": type, "cache-control": "no-store" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
};

function readBody(req, limit = 16 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("Body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function isSupportedUrl(value) {
  try {
    const host = new URL(value).hostname.replace(/^www\./, "").replace(/^m\./, "");
    return SUPPORTED_HOSTS.some((h) => host === h || host.endsWith("." + h));
  } catch {
    return false;
  }
}

function run(bin, args, timeoutMs = 10 * 60 * 1000) {
  return new Promise((resolve) => {
    let stderr = "";
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", () => {});
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-4000);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, stderr: String(error.message) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, stderr });
    });
  });
}

async function findFile(token, ext) {
  const files = await readdir(DOWNLOADS);
  const mine = files.filter((name) => name.startsWith(token + "."));
  if (ext) {
    const exact = mine.find((name) => name.toLowerCase() === `${token}.${ext}`.toLowerCase());
    if (exact) return exact;
  }
  return mine.sort()[0] || null;
}

async function handleConvert(req, res) {
  if (activeJobs >= MAX_CONCURRENT_JOBS) {
    return send(res, 503, { message: "Server is busy. Please try again in a moment." });
  }

  activeJobs++;
  try {
    let body;
    try {
      body = await readBody(req);
    } catch (error) {
      return send(res, 400, { message: error.message });
    }

    const url = typeof body.url === "string" ? body.url.trim() : "";
    if (!isSupportedUrl(url)) return send(res, 400, { message: "That link isn't supported." });

    const wantsVideo = body.format === "mp4" || body.format === "video";
    const requestedExt = String(body.ext || "").toLowerCase().replace(".", "");
    const ext =
      requestedExt && (wantsVideo ? VIDEO_CODECS[requestedExt] : AUDIO_CODECS[requestedExt])
        ? requestedExt
        : null;

    const quality = String(body.quality || "").replace(/[^0-9]/g, "");
    const height = ["1080", "720", "480", "360", "240", "144"].includes(quality)
      ? quality
      : "1080";

    const token = randomUUID();
    const output = path.join(DOWNLOADS, `${token}.%(ext)s`);

    const downloadArgs = [
      "--no-playlist",
      "--no-warnings",
      "--no-part",
      "--newline",
      ...(cookiesReady ? ["--cookies", COOKIES_FILE] : []),
      ...(EXTRA_ARGS ? EXTRA_ARGS.split(/\s+/).filter(Boolean) : []),
      "-o",
      output,
      ...(wantsVideo
        ? [
            "-f",
            `bestvideo[height<=${height}]+bestaudio/best[height<=${height}]/best`,
            "--merge-output-format",
            "mkv",
          ]
        : ["-f", "bestaudio/best"]),
      url,
    ];

    const download = await run(YTDLP, downloadArgs);
    if (!download.ok) {
      const refused = /Unexpected response from webpage request|confirm you.re not a bot|Login required|login required|rate.?limit|429/i.test(
        download.stderr,
      );
      const reason = /is not recognized|ENOENT/i.test(download.stderr)
        ? "yt-dlp isn't installed on this machine."
        : refused
          ? cookiesReady
            ? "TikTok or Instagram is still refusing this server. The cookies value may have expired — export a fresh one and paste it into your host's settings."
            : "This site is refusing the server's address because it looks like a bot. Add a cookies value in your host's settings — the setup guide explains how."
          : /Private video|confirm your age|unavailable|Sign in|login/i.test(download.stderr)
            ? "This post can't be downloaded — it may be private, age-restricted or login-only."
            : "yt-dlp could not download this post.";
      return send(res, 502, {
        message: reason,
        detail: download.stderr.split("\n").filter(Boolean).slice(-3).join(" "),
      });
    }

    const source = await findFile(token);
    if (!source) return send(res, 502, { message: "Download finished without producing a file." });

    // Already in the right container? Leave it alone.
        if (!ext || path.extname(source).slice(1).toLowerCase() === ext) {
        return send(res, 200, {
          downloadUrl: `${publicOrigin(req)}/files/${encodeURIComponent(source)}`,
        filename: source,
        ext: path.extname(source).slice(1),
      });
    }

    const target = `${token}.${ext}`;
    const codecArgs = wantsVideo ? VIDEO_CODECS[ext] : AUDIO_CODECS[ext];
    const encode = await run(FFMPEG, [
      "-y",
      "-i",
      path.join(DOWNLOADS, source),
      ...codecArgs,
      path.join(DOWNLOADS, target),
    ]);

    if (!encode.ok) {
      const missing = /Unknown encoder|Encoder .* not found/i.test(encode.stderr);
      return send(res, 502, {
        message: missing
          ? `This ffmpeg build can't encode ${ext.toUpperCase()}. Try MP4 or MP3.`
          : `Converting to ${ext.toUpperCase()} failed.`,
        detail: encode.stderr.split("\n").filter(Boolean).slice(-3).join(" "),
      });
    }

    await unlink(path.join(DOWNLOADS, source)).catch(() => {});

    return send(res, 200, {
      downloadUrl: `${publicOrigin(req)}/files/${encodeURIComponent(target)}`,
      filename: target,
      ext,
    });
  } finally {
    activeJobs--;
  }
}

/** Behind a proxy or a host like Hugging Face Spaces, the public address is the forwarded one. */
function publicOrigin(req) {
  const proto =
    String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() || "http";
  const host = String(
    req.headers["x-forwarded-host"] || req.headers.host || `localhost:${PORT}`,
  )
    .split(",")[0]
    .trim();
  return `${proto}://${host}`;
}

async function serveFile(res, name) {
  const safe = path.basename(decodeURIComponent(name));
  const full = path.join(DOWNLOADS, safe);
  try {
    const info = await stat(full);
    if (!info.isFile()) throw new Error("not a file");
    const type = safe.endsWith(".mp3")
      ? "audio/mpeg"
      : safe.endsWith(".m4a")
        ? "audio/mp4"
        : /\.(ogg|opus)$/.test(safe)
          ? "audio/ogg"
          : safe.endsWith(".flac")
            ? "audio/flac"
            : safe.endsWith(".wav")
              ? "audio/wav"
              : safe.endsWith(".mp4")
                ? "video/mp4"
                : safe.endsWith(".webm")
                  ? "video/webm"
                  : safe.endsWith(".mkv")
                    ? "video/x-matroska"
                    : "application/octet-stream";
    res.writeHead(200, {
      ...CORS,
      "content-type": type,
      "content-length": info.size,
      "content-disposition": `attachment; filename="${safe.replace(/^[0-9a-f-]{36}\./, "")}"`,
    });
    createReadStream(full).pipe(res);
  } catch {
    send(res, 404, { message: "File not found or already expired." });
  }
}

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    return res.end();
  }
  if (pathname === "/health")
    return send(res, 200, { ok: true, service: "pake-converter", cookies: cookiesReady });
  if (pathname === "/") {
    return send(res, 200, {
      ok: true,
      service: "pake-converter",
      usage: "POST /api/convert with { url, format, quality, ext }",
      health: "/health",
      cookies: cookiesReady,
    });
  }

  // Only the conversion call is gated: download links are unguessable, short-lived paths that
  // the visitor's browser fetches without any headers.
  if (REQUIRED_KEY && pathname === "/api/convert") {
    const given = String(req.headers.authorization || "").replace(/^Api-Key\s+/i, "").trim();
    if (given !== REQUIRED_KEY) return send(res, 401, { message: "Wrong or missing converter key." });
  }

  if (pathname === "/api/convert" && req.method === "POST") return handleConvert(req, res);
  if (pathname.startsWith("/files/")) return serveFile(res, pathname.slice("/files/".length));
  return send(res, 404, { message: "Not found" });
});

async function sweep() {
  try {
    const now = Date.now();
    for (const name of await readdir(DOWNLOADS)) {
      const full = path.join(DOWNLOADS, name);
      const info = await stat(full).catch(() => null);
      if (info?.isFile() && now - info.mtimeMs > TTL_MS) await unlink(full).catch(() => {});
    }
  } catch {
    /* the folder may not exist yet */
  }
}

await mkdir(DOWNLOADS, { recursive: true });
setInterval(sweep, 5 * 60 * 1000).unref();

const usingCookies = await prepareCookies();

server.listen(PORT, () => {
  console.log(`Pake converter running on http://localhost:${PORT}`);
  console.log(
    usingCookies
      ? "Cookies loaded — TikTok and Instagram should accept this server."
      : "No cookies set — TikTok and Instagram may refuse this server.",
  );
  console.log(`Point the site at it with CONVERT_API_URL=http://localhost:${PORT}`);
  console.log(`Audio: ${Object.keys(AUDIO_CODECS).join(", ")}`);
  console.log(`Video: ${Object.keys(VIDEO_CODECS).join(", ")}`);
  console.log(`Files are deleted automatically after ${Math.round(TTL_MS / 60000)} minutes.`);
});
