import { config } from "dotenv";

config({ path: [".env.local", ".env"], quiet: true });

function cookieOptions(options = {}) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    ...options,
  };
}

// Session cookie by default; pass maxAge in milliseconds for persistence.
export function setCookie(res, name, value, options = {}) {
  return res.cookie(name, value, cookieOptions(options));
}

export function getCookie(req, name) {
  return req.cookies?.[name];
}

// Use the same path and domain options that were used when setting the cookie.
export function clearCookie(res, name, options = {}) {
  const clearOptions = cookieOptions(options);
  delete clearOptions.maxAge;
  delete clearOptions.expires;
  return res.clearCookie(name, clearOptions);
}
