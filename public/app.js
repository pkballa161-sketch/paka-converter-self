const $ = (sel) => document.querySelector(sel);

const form = $("#form");
const urlInput = $("#url");
const goBtn = $("#go");
const qualitySel = $("#quality");
const qualityLabelEl = $(".quality span");
const hintEl = $("#hint");
const resultEl = $("#result");
const segWrap = $("#format");
const thumbEl = $(".thumb");
const pasteBtn = $("#paste");
const brandIcon = $("#brandIcon");
const platformTabs = $("#platforms");

const FULL_AUDIO = [
  ["mp3", "MP3 · plays anywhere"],
  ["m4a", "M4A · AAC in a bottle"],
  ["aac", "AAC · raw stream"],
  ["flac", "FLAC · lossless"],
  ["wav", "WAV · uncompressed"],
  ["ogg", "OGG · Vorbis"],
  ["opus", "Opus · tiny, excellent"],
  ["vorbis", "Vorbis · raw stream"],
];
const FULL_VIDEO = [
  ["1080", "1080p · MP4"],
  ["720", "720p · MP4"],
  ["480", "480p · MP4"],
  ["360", "360p · MP4"],
  ["240", "240p · MP4"],
  ["144", "144p · MP4"],
  ["mov1080", "1080p · MOV"],
  ["mov720", "720p · MOV"],
  ["mov480", "480p · MOV"],
  ["mov360", "360p · MOV"],
  ["mkv", "MKV · Copy"],
  ["webm", "WebM · VP9"],
  ["avi", "AVI · MPEG4"],
  ["gif", "GIF · 480p"],
];

// Trimmed to whatever the connected service can genuinely produce.
let AUDIO = FULL_AUDIO.slice();
let VIDEO = FULL_VIDEO.slice();

const videoServerKey = (value) =>
  value.startsWith("mov") ? `MOV${value.slice(3)}` : value;

const VIDEO_KEY_LABELS = {
  "144": "144p",
  "240": "240p",
  "360": "360p",
  "480": "480p",
  "720": "720p",
  "1080": "1080p",
  MOV360: "360p MOV",
  MOV480: "480p MOV",
  MOV720: "720p MOV",
  MOV1080: "1080p MOV",
};

async function loadCapabilities() {
  try {
    const res = await fetch("/api/status");
    const data = await res.json();
    const audio = data?.available?.audio;
    const video = data?.available?.video;
    if (Array.isArray(audio) && audio.length) {
      const keep = FULL_AUDIO.filter(([value]) => audio.includes(value));
      if (keep.length) AUDIO = keep;
    }
    if (Array.isArray(video) && video.length) {
      const keep = FULL_VIDEO.filter(([value]) => video.includes(videoServerKey(value)));
      if (keep.length) VIDEO = keep;
    }
    setFormat(state.format);
  } catch {
    /* keep the full list and let the server refuse politely */
  }
}

const PLATFORMS = [
  { key: "instagram", name: "Instagram", hosts: ["instagram.com", "instagr.am", "ig.me"] },
  { key: "tiktok", name: "TikTok", hosts: ["tiktok.com"] },
  { key: "facebook", name: "Facebook", hosts: ["facebook.com", "fb.watch", "fb.com"] },
  { key: "x", name: "X", hosts: ["x.com", "twitter.com", "t.co"] },
];

const BRAND = {
  tiktok: {
    color: "#25f4ee",
    placeholder: "Paste a TikTok link…",
    icon: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M15 3c.5 2.3 2 3.6 4.2 3.8v3c-1.7 0-3.1-.5-4.2-1.4v6.3a5 5 0 1 1-5-5c.3 0 .7 0 1 .1v3.2a1.8 1.8 0 1 0 1.6 1.8V3h2.4Z"/></svg>`,
  },
  instagram: {
    color: "#e1306c",
    placeholder: "Paste an Instagram link…",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="5.4"/><circle cx="12" cy="12" r="4.1"/><circle cx="17.4" cy="6.6" r="1.1" fill="currentColor" stroke="none"/></svg>`,
  },
  facebook: {
    color: "#1877f2",
    placeholder: "Paste a Facebook link…",
    icon: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13.6 22v-8.2h2.7l.4-3.2h-3.1V8.6c0-.9.3-1.5 1.6-1.5h1.7V4.2c-.3 0-1.4-.1-2.6-.1-2.6 0-4.3 1.6-4.3 4.5v2h-2.7v3.2H10V22h3.6Z"/></svg>`,
  },
  x: {
    color: "#ffffff",
    placeholder: "Paste an X link…",
    icon: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.5 3h3.2l-7 8 8.2 10h-6.4l-5-6.1-5.7 6.1H1.6l7.5-8.6L1.2 3h6.6l4.5 5.6L17.5 3Zm-1.1 16.1h1.8L7.7 4.8H5.8l10.6 14.3Z"/></svg>`,
  },
};

const state = { format: "mp3", platform: "tiktok", url: null, meta: null, busy: false };

/* ---------------- parsing ---------------- */

function parseLink(input) {
  if (!input) return null;

  let url;
  try {
    url = new URL(/^https?:\/\//i.test(input.trim()) ? input.trim() : "https://" + input.trim());
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");
  const match = PLATFORMS.find((p) => p.hosts.some((h) => host === h || host.endsWith("." + h)));
  if (!match) return null;

  return { platform: match.key, name: match.name, id: null, url: url.toString() };
}

/* ---------------- metadata ---------------- */

async function loadMeta(link) {
  return {
    title: null,
    author: null,
    thumbnail: null,
    platformName: link.name,
    host: new URL(link.url).hostname,
  };
}

/* ---------------- ui ---------------- */

function setHint(text, tone) {
  hintEl.textContent = text;
  hintEl.className = "hint" + (tone ? " " + tone : "");
}

function isAudio() {
  return state.format === "mp3";
}

function setFormat(format) {
  state.format = format;
  segWrap.querySelectorAll(".seg").forEach((btn) => {
    const active = btn.dataset.format === format;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-checked", String(active));
  });
  thumbEl.classList.toggle("right", format === "mp4");
  qualityLabelEl.textContent = isAudio() ? "Audio" : "Quality";
  qualitySel.innerHTML = (isAudio() ? AUDIO : VIDEO)
    .map(([value, label]) => `<option value="${value}">${label}</option>`)
    .join("");
  if (state.meta) renderCard();
  updateButton();
}

function setPlatform(key) {
  const brand = BRAND[key] || BRAND.tiktok;
  state.platform = key;
  platformTabs?.querySelectorAll(".ptab").forEach((tab) => {
    tab.setAttribute("aria-selected", String(tab.dataset.platform === key));
  });
  if (brandIcon) {
    brandIcon.innerHTML = brand.icon;
    brandIcon.style.color = brand.color;
  }
  urlInput.placeholder = brand.placeholder;
}

function updateButton() {
  goBtn.disabled = state.busy || !parseLink(urlInput.value);
}

function refreshPasteButton() {
  if (pasteBtn) pasteBtn.hidden = Boolean(urlInput.value.trim());
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

function currentChoice() {
  const list = isAudio() ? AUDIO : VIDEO;
  const value = qualitySel.value;
  if (value && list.some(([v]) => v === value)) return value;
  // Never invent a substitute: pass the odd value through and let the server refuse it.
  return value || list[0][0];
}

function choiceLabel() {
  const choice = currentChoice();
  if (isAudio()) return choice.toUpperCase();
  if (choice.startsWith("mov")) return `${choice.slice(3)}p MOV`;
  return `${choice}p MP4`;
}

/* ---------------- card ---------------- */

function renderCard(extra = "") {
  if (!state.meta) return;
  const link = state.url;
  const art = state.meta.thumbnail
    ? `<img src="${escapeHtml(state.meta.thumbnail)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`
    : `<div class="art-fallback">${escapeHtml((state.meta.platformName || "Link").slice(0, 1))}</div>`;

  const title = state.meta.title || `${state.meta.platformName || "Post"} link ready`;
  const by = state.meta.author || state.meta.host || "";

  resultEl.innerHTML = `
    <div class="card">
      <div class="art">${art}</div>
      <div class="meta">
        <h3>${escapeHtml(title)}</h3>
        <p class="by">${escapeHtml(by)}</p>
        <div class="pills">
          <span class="pill hot">${escapeHtml(state.meta.platformName || "")}</span>
          <span class="pill">${escapeHtml(isAudio() ? choiceLabel() : choiceLabel())}</span>
        </div>
        ${extra}
      </div>
    </div>`;
}

function renderError(message) {
  resultEl.innerHTML = `
    <div class="panel">
      <h3>That didn't work</h3>
      <p>${escapeHtml(message)}</p>
    </div>`;
}

function renderUnavailable(message, available) {
  const chips = available
    .map((key) => `<span class="pill">${escapeHtml(VIDEO_KEY_LABELS[key] || key.toUpperCase())}</span>`)
    .join("");
  resultEl.innerHTML = `
    <div class="panel">
      <h3>That format isn't available</h3>
      <p>${escapeHtml(message)}</p>
      ${chips ? `<p style="margin-bottom:6px">Pick one of these instead:</p><div class="pills">${chips}</div>` : ""}
    </div>`;
}

function renderSetup() {
  resultEl.innerHTML = `
    <div class="panel">
      <h3>Your converter isn't connected yet</h3>
      <p>The conversion service is not connected or is temporarily unavailable. Please try again later.</p>
    </div>`;
}

/* ---------------- convert ---------------- */

async function convert() {
  const link = parseLink(urlInput.value);
  if (!link) {
    setHint("That link isn't supported yet.", "err");
    return;
  }

  state.busy = true;
  state.url = link;
  updateButton();
  setHint("Reading the post…");

  if (!state.meta || state.meta.sourceUrl !== link.url) {
    state.meta = { ...(await loadMeta(link)), sourceUrl: link.url };
  }
  renderCard();

  const choice = currentChoice();
  const actions = document.createElement("div");
  actions.className = "actions";
  actions.innerHTML = `
    <div class="progress"><i></i></div>
    <span class="status">Preparing your ${choiceLabel()}…</span>`;
  resultEl.querySelector(".meta")?.appendChild(actions);

  setHint(`Converting ${choiceLabel()}…`);

  try {
    const res = await fetch("/api/convert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: link.url,
        videoId: link.id,
        platform: link.platform,
        format: isAudio() ? "audio" : "mp4",
        quality: choice,
      }),
    });

    const data = await res.json().catch(() => ({}));

    if (res.status === 501 || data.code === "not_configured") {
      renderSetup();
      setHint("Your converter isn't connected — see the note below.", "warn");
      return;
    }
    if (data.code === "format_unavailable") {
      renderUnavailable(data.message, data.available || []);
      setHint("That format isn't available right now.", "warn");
      return;
    }
    if (!res.ok) {
      renderError(data.message || "That post couldn't be prepared. It may be private or unavailable.");
      setHint("Conversion failed.", "err");
      return;
    }

    const fileUrl = data.downloadUrl || data.url;
    if (!fileUrl) {
      renderError("The converter replied without a file link.");
      return;
    }

    if (data.title && !state.meta.title) {
      state.meta = {
        ...state.meta,
        title: data.title,
        author: data.author || state.meta.author,
        thumbnail: data.thumbnail || state.meta.thumbnail,
      };
      renderCard();
    } else {
      resultEl.querySelector(".actions")?.remove();
    }

    const ext = (data.ext || (isAudio() ? choice : "mp4")).toUpperCase();
    const done = document.createElement("div");
    done.className = "actions";
    done.innerHTML = `
      <a class="btn primary" href="${escapeHtml(fileUrl)}" download target="_blank" rel="noopener">
        Download ${escapeHtml(ext)}
      </a>
      <span class="status ok">Ready · ${escapeHtml(ext)}</span>`;
    resultEl.querySelector(".meta")?.appendChild(done);
    setHint("Done. Your file is ready.");
    remember(state.meta, link, ext);
  } catch {
    renderError("Couldn't reach the converter. Check your connection and try again.");
    setHint("Network error.", "err");
  } finally {
    state.busy = false;
    updateButton();
  }
}

/* ---------------- recent (local only) ---------------- */

function remember(meta, link, ext) {
  try {
    const key = "tube2mp3.recent";
    const list = JSON.parse(localStorage.getItem(key) || "[]").filter((item) => item.url !== link.url);
    list.unshift({ url: link.url, title: meta.title || link.name, ext, at: Date.now() });
    localStorage.setItem(key, JSON.stringify(list.slice(0, 6)));
  } catch {
    /* storage is optional */
  }
}

/* ---------------- wiring ---------------- */

segWrap.addEventListener("click", (event) => {
  const btn = event.target.closest(".seg");
  if (btn) setFormat(btn.dataset.format);
});

qualitySel.addEventListener("change", () => {
  if (state.meta) renderCard();
});

urlInput.addEventListener("input", () => {
  const link = parseLink(urlInput.value);
  updateButton();
  refreshPasteButton();
  if (link && link.platform !== state.platform) setPlatform(link.platform);
  if (!urlInput.value.trim()) {
    setHint("TikTok, Instagram, Facebook and X links are supported.");
  } else if (link) {
    setHint(`${link.name} link looks good.`);
  } else {
    setHint("That link isn't supported yet.", "err");
  }
});

urlInput.addEventListener("paste", () => {
  setTimeout(() => {
    urlInput.dispatchEvent(new Event("input"));
    if (parseLink(urlInput.value)) form.requestSubmit();
  }, 10);
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!state.busy) convert();
});

function askToLongPress() {
  urlInput.focus({ preventScroll: true });
  setHint("Long-press the box, then tap Paste.", "warn");
}

async function pasteFromClipboard() {
  if (!navigator.clipboard || !navigator.clipboard.readText) return askToLongPress();
  try {
    const text = (await navigator.clipboard.readText()) || "";
    if (!text.trim()) {
      urlInput.focus({ preventScroll: true });
      setHint("Your clipboard is empty — copy a link first.", "warn");
      return;
    }
    urlInput.value = text.trim();
    urlInput.dispatchEvent(new Event("input"));
    if (parseLink(urlInput.value)) convert();
    else setHint("That clipboard text isn't a supported link.", "err");
  } catch {
    askToLongPress();
  }
}

platformTabs?.addEventListener("click", (event) => {
  const tab = event.target.closest(".ptab");
  if (!tab) return;
  setPlatform(tab.dataset.platform);
  urlInput.focus({ preventScroll: true });
});

pasteBtn?.addEventListener("click", pasteFromClipboard);

setPlatform("tiktok");
setFormat("mp3");
loadCapabilities();
updateButton();
refreshPasteButton();
if (window.matchMedia("(pointer: fine)").matches) urlInput.focus({ preventScroll: true });
