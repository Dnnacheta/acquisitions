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

## Docker development with Neon Local

### Bash shortcuts

Two scripts wrap the Compose commands below and work from any directory:

```sh
./scripts/docker-dev.sh init       # Preserves an existing environment file
# Fill in .env.docker.dev, then:
./scripts/docker-dev.sh up
./scripts/docker-dev.sh migrate
./scripts/docker-dev.sh status
./scripts/docker-dev.sh logs
./scripts/docker-dev.sh test
./scripts/docker-dev.sh down
```

For production with Neon Cloud:

```sh
./scripts/docker-prod.sh init
# Fill in .env.docker.prod, then:
./scripts/docker-prod.sh build
./scripts/docker-prod.sh migrate   # Explicitly applies production migrations
./scripts/docker-prod.sh up
./scripts/docker-prod.sh status
./scripts/docker-prod.sh logs
```

Both scripts default to `up`. Run either with `help` for all commands.
They validate Compose configuration without printing credentials, preserve
existing environment files, and ignore exported shell values for the settings
they read from their environment file. Optional `DOCKER_DEV_ENV_FILE` and
`DOCKER_PROD_ENV_FILE` overrides select another file; relative paths are resolved
from the repository root. Startup never runs migrations automatically.

### Manual Compose commands

Install Docker with the Compose plugin. On Windows, enable Docker Desktop's
WSL integration for this distribution. Host Node.js is not required for Docker.

```sh
cp .env.docker.dev.example .env.docker.dev
```

Set `NEON_API_KEY`, `NEON_PROJECT_ID`, and `BRANCH_ID` for an existing dedicated
development branch, plus `JWT_SECRET` (at least 32 bytes) and `ARCJET_KEY`.
Set `NEON_DATABASE_NAME` to the database on that branch. Do not select your
production branch. Neon Local is a proxy to Neon Cloud, so internet access is
required; the database is not stored in a Docker volume.

```sh
docker compose --env-file .env.docker.dev -f compose.dev.yaml up --build -d
docker compose --env-file .env.docker.dev -f compose.dev.yaml logs -f app
```

The app is available at `http://localhost:3000` by default; set `APP_PORT` to
another host port if 3000 is already occupied. Source changes in `src/`
restart Node automatically. Dependencies are installed inside the image;
rebuild after changing `package.json` or `package-lock.json`. Only `src/` is
mounted, so local `node_modules` and `.env.local` cannot override the container.
The app connects to `db:5432`; the database proxy has no published host port.
Only the proxy receives your Neon API key. `BRANCH_ID` and `DELETE_BRANCH=false`
preserve the existing development branch when Compose stops.

Apply committed migrations explicitly, then verify liveness:

```sh
docker compose --env-file .env.docker.dev -f compose.dev.yaml run --rm migrate
curl http://localhost:3000/health
docker compose --env-file .env.docker.dev -f compose.dev.yaml down
```

The development connection uses `sslmode=no-verify` for Neon Local's self-signed
certificate on the internal Docker network. Do not reuse this URL in production.
For branch provisioning or temporary branch workflows, configure a separate
development environment rather than replacing the production connection.

## Docker Compose production with Neon Cloud

Copy `.env.docker.prod.example` to `.env.docker.prod` on the production host.
Use a pooled Neon Cloud URL for `DATABASE_URL` and a direct URL for
`DATABASE_URL_UNPOOLED`. Both must refer to the same production database and
retain TLS certificate verification (`sslmode=verify-full` in the template).
Provide production JWT and Arcjet secrets. Environment files are ignored by
Git and excluded from Docker builds; protect their host file permissions.

```sh
docker compose --env-file .env.docker.prod -f compose.prod.yaml build
# Run once per release, after reviewing/testing migrations on development.
docker compose --env-file .env.docker.prod -f compose.prod.yaml run --rm --build migrate
docker compose --env-file .env.docker.prod -f compose.prod.yaml up -d --no-build app
docker compose --env-file .env.docker.prod -f compose.prod.yaml ps
docker compose --env-file .env.docker.prod -f compose.prod.yaml logs -f app
```

The production image includes runtime dependencies and `src/`, runs as the
non-root `node` user, and runs Node directly. There are no source mounts or
Neon Local service. The direct migration URL is passed only to the migration
container. Migration tooling has its own image target and is excluded from the
production application image. Migrations never run automatically on app startup.

The app binds to host loopback by default. Place a TLS reverse proxy in front
of it for public access; HTTPS is required for production authentication cookies.
For a separate ingress setup, configure `APP_BIND_ADDRESS` and
`ARCJET_TRUSTED_PROXIES` to match your network. Do not expose the origin through
an alternate path that bypasses the trusted proxy. The production Compose file
does not inject `ARCJET_ENV`, so local development IP behavior is disabled.

Docker captures stdout/stderr and rotates its logs; `LOG_TO_FILE=false` avoids
writes to the read-only application filesystem. SIGTERM/SIGINT stop accepting
requests, drain HTTP connections, close the database pool, and flush logs.
Shutdown has a ten-second deadline within Compose's fifteen-second grace period.

`/health` is an unprotected liveness check. It does not query Neon or Arcjet;
a healthy container alone does not prove database connectivity. Authentication
requires the database schema to have been migrated. Docker health status is
diagnostic; the restart policy restarts exited containers, not merely unhealthy
ones.

## Container tests

```sh
docker build --target test -t acquisitions:test .
docker run --rm acquisitions:test
docker run --rm acquisitions:test npm run lint
```

These tests do not need Neon or Arcjet credentials. They include HTTP startup
and graceful shutdown checks. Application images are pinned to Node 24.20.0;
update that image tag deliberately for maintenance. Neon Local is pinned to a
tested digest in Compose; `NEON_LOCAL_IMAGE` can override it for upgrades.
