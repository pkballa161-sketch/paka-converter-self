const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

const json = (body, status = 200) => ({ status, body });

const HOSTS = {
  instagram: ["instagram.com", "instagr.am", "ig.me"],
  tiktok: ["tiktok.com"],
  facebook: ["facebook.com", "fb.watch", "fb.com", "m.facebook.com"],
  x: ["x.com", "twitter.com", "t.co"],
};

const PLATFORM_NAMES = {
  instagram: "Instagram",
  tiktok: "TikTok",
  facebook: "Facebook",
  x: "X",
};

/* What server.mjs can genuinely build. */
const AUDIO_OUT = ["mp3", "m4a", "aac", "ogg", "opus", "flac", "wav", "aiff"];
const VIDEO_OUT = [
  "144", "240", "360", "480", "720", "1080",
  "MOV360", "MOV480", "MOV720", "MOV1080",
];

function detectPlatform(value) {
  let host;
  try {
    host = new URL(value).hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");
  } catch {
    return null;
  }
  for (const [platform, hosts] of Object.entries(HOSTS)) {
    if (hosts.some((h) => host === h || host.endsWith("." + h))) return platform;
  }
  return null;
}

/** Returns null for anything that isn't a real video format, so nothing is guessed. */
function videoKeyOf(quality) {
  const raw = String(quality || "").toLowerCase().trim();
  if (/^mov\d{3,4}$/.test(raw)) return `MOV${raw.slice(3)}`;
  if (/^\d{3,4}$/.test(raw)) return raw;
  return null;
}

function labelOfVideo(key) {
  if (key.startsWith("MOV")) return `${key.slice(3)}p MOV`;
  return `${key}p MP4`;
}

/** Translate a UI choice into what server.mjs expects. */
function toServerJob(wantsAudio, audioExt, videoKey) {
  if (wantsAudio) {
    return { quality: "", ext: audioExt === "source" ? "" : audioExt };
  }
  if (videoKey.startsWith("MOV")) return { quality: videoKey.slice(3), ext: "mov" };
  return { quality: videoKey, ext: "mp4" };
}

async function handleConvert(body, env) {

  const url = typeof body?.url === "string" ? body.url.trim() : "";
  const platform = detectPlatform(url);
  if (!platform) {
    return json({ message: "That isn't a TikTok, Instagram, Facebook or X link." }, 400);
  }

  if (!env.CONVERT_API_URL) {
    return json({ code: "not_configured", message: "No converter address is set for this site." }, 501);
  }

  const wantsAudio = body.format !== "mp4" && body.format !== "video";
  const requested = String(body.quality ?? "").toLowerCase();
  const audioExt = AUDIO_OUT.includes(requested) ? requested : "mp3";
  const videoKey = wantsAudio ? null : videoKeyOf(requested);

  if (!wantsAudio && !videoKey) {
    return json(
      { code: "format_unavailable", message: "That isn't a video format this service offers.", available: VIDEO_OUT },
      409,
    );
  }
  if (wantsAudio && !AUDIO_OUT.includes(audioExt)) {
    return json(
      {
        code: "format_unavailable",
        message: `${audioExt.toUpperCase()} isn't one of the formats this converter builds.`,
        available: AUDIO_OUT,
      },
      409,
    );
  }
  if (!wantsAudio && !VIDEO_OUT.includes(videoKey)) {
    return json(
      {
        code: "format_unavailable",
        message: `${labelOfVideo(videoKey)} isn't one of the formats this converter builds.`,
        available: VIDEO_OUT,
      },
      409,
    );
  }

  const job = toServerJob(wantsAudio, audioExt, videoKey);
  const headers = { "content-type": "application/json", accept: "application/json" };
  if (env.CONVERT_API_KEY) {
    headers.authorization = `${env.CONVERT_API_AUTH_SCHEME || "Api-Key"} ${env.CONVERT_API_KEY}`;
  }

  let upstream;
  try {
    upstream = await fetch(env.CONVERT_API_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({
        url,
        format: wantsAudio ? "audio" : "mp4",
        quality: job.quality,
        ext: job.ext,
      }),
      signal: AbortSignal.timeout(110000),
    });
  } catch (error) {
    const timedOut = error?.name === "TimeoutError";
    return json(
      { message: timedOut ? "Your converter took too long to answer." : "Your converter couldn't be reached." },
      timedOut ? 504 : 502,
    );
  }

  const data = await upstream.json().catch(() => null);

  if (!upstream.ok || !data) {
    return json(
      {
        message: data?.message || `Your converter returned ${upstream.status}.`,
        ...(data?.detail ? { detail: data.detail } : {}),
        ...(data?.code ? { code: data.code } : {}),
       },
      upstream.status >= 400 ? upstream.status : 502,
    );
  }

  const link = data.downloadUrl || data.url || data.file || data.link;
  if (!link) return json({ message: "Your converter replied without a file link." }, 502);

  // Never hand back a container that wasn't asked for.
  const got = String(data.ext || "").toLowerCase();
  const expected = wantsAudio ? (audioExt === "source" ? null : audioExt) : (videoKey.startsWith("MOV") ? "mov" : "mp4");
  if (expected && got && got !== expected) {
    return json(
      {
        code: "format_unavailable",
        message: `Your converter produced ${got.toUpperCase()}, so ${wantsAudio ? audioExt.toUpperCase() : labelOfVideo(videoKey)} wasn't handed over.`,
        available: wantsAudio ? AUDIO_OUT : VIDEO_OUT,
      },
      409,
    );
  }

  return json({
    downloadUrl: link,
    filename: data.filename || null,
    ext: got || expected || null,
    platform,
    platformName: PLATFORM_NAMES[platform],
    provider: "self-hosted",
  });
}

/* ---- Vercel entry points: plain functions instead of a Worker fetch handler ---- */

export async function convert(body, env) {
  if (!body || typeof body !== "object") return json({ message: "Expected a JSON body." }, 400);
  return handleConvert(body, env);
}

export function status(env) {
  return json({
    configured: Boolean(env.CONVERT_API_URL),
    provider: env.CONVERT_API_URL ? "self-hosted" : null,
    available: { audio: AUDIO_OUT, video: VIDEO_OUT },
  });
}
