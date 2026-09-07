import { config } from "dotenv";
import arcjet, { detectBot, shield, slidingWindow } from "@arcjet/node";

config({ path: [".env.local", ".env"], quiet: true });

if (!process.env.ARCJET_KEY) {
  throw new Error("ARCJET_KEY must be set in the environment or .env.local");
}

const aj = arcjet({
  key: process.env.ARCJET_KEY,
  proxies: (process.env.ARCJET_TRUSTED_PROXIES || "")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean),
  rules: [
    shield({ mode: "LIVE" }),
    detectBot({
      mode: "LIVE",
      allow: ["CATEGORY:SEARCH_ENGINE", "CATEGORY:MONITOR", "CATEGORY:PREVIEW"],
    }),
  ],
});

// Each request uses one derived client; rate limits default to client IP.
const publicProtection = aj.withRule(
  slidingWindow({ mode: "LIVE", interval: "1m", max: 100 }),
);
const signInProtection = aj.withRule(
  slidingWindow({ mode: "LIVE", interval: "1m", max: 10 }),
);
const signUpProtection = aj.withRule(
  slidingWindow({ mode: "LIVE", interval: "10m", max: 5 }),
);

export default { publicProtection, signInProtection, signUpProtection };
