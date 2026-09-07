# Acquisitions

Express API with account registration, sign-in, and sign-out.

## Local setup

```sh
nvm install
nvm use
npm install
```

Create `.env.local` using `.env.example`, then set your database URL, JWT secret,
and Arcjet site key. Keep credentials out of Git. Node 24.5 or newer in the Node 24
release line is required.

```sh
npm run dev
```

## Request protection

Arcjet Shield and bot detection run in each public and authentication route
before business logic. Search engines, uptime monitors, and link preview bots
are allowed; other detected bots (including curl) are blocked.

Rate limits are per client IP:

| Routes                            | Limit                     |
| --------------------------------- | ------------------------- |
| `/`, `/api`, `/api/auth/sign-out` | 100 requests per minute   |
| `/api/auth/sign-in`               | 10 requests per minute    |
| `/api/auth/sign-up`               | 5 requests per 10 minutes |

Blocked bots and attacks receive 403. Rate-limited requests receive 429, with
`Retry-After` when Arcjet supplies a reset time. `/health` remains unprotected
for liveness checks. Arcjet service/evaluation failures are logged and fail open
so an Arcjet outage does not prevent access to the app. A missing `ARCJET_KEY`
stops startup instead of silently disabling protection.

Use `ARCJET_ENV=development` only locally. In production, set
`NODE_ENV=production`, omit `ARCJET_ENV`, and configure
`ARCJET_TRUSTED_PROXIES` with your ingress proxy IPs/CIDRs if applicable. The
origin must only be reachable through those proxies, and the ingress must
overwrite or safely append forwarding headers. Do not trust arbitrary
client-supplied forwarding headers.

For a live check, run `curl -i http://localhost:3000/api`; bot detection should
return 403. Check the matching decision in your Arcjet Console. A browser
request should be allowed unless another rule blocks it.

## Tests

```sh
npm test
npm run lint
```

Tests use an isolated PGlite database and mocked Arcjet decisions; they never
send test credentials to the database service or Arcjet. Protection tests cover
allow/deny/error handling and ensure denied routes do not access the database.
