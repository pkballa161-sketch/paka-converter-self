import { status } from "../lib/core.js";

export default function handler(req, res) {
  res.setHeader("cache-control", "no-store");
  const result = status(process.env);
  res.status(result.status).json(result.body);
}
