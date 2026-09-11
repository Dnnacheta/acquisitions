import { verifyToken } from "#utils/jwt.js";

export default function authenticate(req, res, next) {
  const match = req.get("Authorization")?.match(/^Bearer\s+(\S+)$/i);

  if (!match) {
    res.set("WWW-Authenticate", "Bearer");
    return res.status(401).json({ message: "Authentication required" });
  }

  try {
    const payload = verifyToken(match[1]);
    req.user = { id: Number(payload.sub) };
    req.sessionVersion = payload.sessionVersion ?? 0;
  } catch {
    res.set("WWW-Authenticate", "Bearer");
    return res.status(401).json({ message: "Invalid or expired token" });
  }

  next();
}
