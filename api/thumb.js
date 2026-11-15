export default async function handler(req, res) {
  const { url } = req.query || {};
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) {
    res.status(400).end("bad url");
    return;
  }
  try {
    const upstream = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      },
      redirect: "follow",
    });
    if (!upstream.ok) {
      res.status(upstream.status).end();
      return;
    }
    const type = upstream.headers.get("content-type") || "image/jpeg";
    if (!/^image\//i.test(type)) {
      res.status(415).end("not an image");
      return;
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.setHeader("content-type", type);
    res.setHeader("cache-control", "public, max-age=86400, s-maxage=86400, immutable");
    res.status(200).send(buf);
  } catch {
    res.status(502).end("thumbnail fetch failed");
  }
}
