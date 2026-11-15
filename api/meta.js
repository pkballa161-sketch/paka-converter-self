import { meta } from "../lib/core.js";

export default async function handler(req, res) {
  res.setHeader("cache-control", "no-store");
  if (req.method !== "POST") {
    res.status(405).json({ message: "Use POST." });
    return;
  }
  const body = req.body && typeof req.body === "object" ? req.body : {};
  try {
    const result = await meta(body, process.env);
    res.status(result.status).json(result.body);
  } catch {
    res.status(502).json({ message: "Couldn't read that post's details." });
  }
}
