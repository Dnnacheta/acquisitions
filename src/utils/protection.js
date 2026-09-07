import logger from "#config/logger.js";

// Called inside route handlers, before hashing passwords or accessing data.
export async function allowRequest(client, req, res) {
  try {
    const decision = await client.protect(req);

    if (decision.isDenied()) {
      res.set("Cache-Control", "no-store");
      if (decision.reason.isRateLimit()) {
        const resetTime = decision.reason.resetTime?.getTime();
        if (Number.isFinite(resetTime)) {
          res.set(
            "Retry-After",
            String(Math.max(1, Math.ceil((resetTime - Date.now()) / 1000))),
          );
        }
        res
          .status(429)
          .json({ message: "Too many requests. Try again later." });
      } else {
        res.status(403).json({ message: "Forbidden" });
      }
      return false;
    }

    // Follow Arcjet's fail-open policy for evaluation/service errors.
    if (decision.isErrored()) {
      logger.warn("Arcjet protection unavailable", { decisionId: decision.id });
    }
  } catch (error) {
    logger.warn("Arcjet protection failed", { errorName: error.name });
  }

  return true;
}
