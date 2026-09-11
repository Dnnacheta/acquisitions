# Acquisitions

A customer and sales lead workspace with an Express API, NGN sales pipeline,
and account management.

## User CRUD and administrator access

Public registration remains `POST /api/auth/sign-up` with name, email, and
password. It defaults to a `user` account. Admin signup requires `role: "admin"` and
a valid `X-Admin-Signup-Key` header. Send `Authorization: Bearer <token>` for user-management routes.

| Method | Endpoint                     | Access and behavior                                                     |
| ------ | ---------------------------- | ----------------------------------------------------------------------- |
| POST   | `/api/users`                 | Admin: create a user or admin with name, email, password, optional role |
| GET    | `/api/users?page=1&limit=20` | Admin: paginated users, sorted by ID; limit at most 100                 |
| GET    | `/api/users/me`              | Any signed-in user: read own profile                                    |
| GET    | `/api/users/:id`             | Own account or admin                                                    |
| PATCH  | `/api/users/:id`             | Update selected fields on own account, or any account as admin          |
| PUT    | `/api/users/:id`             | Set name and email; optional password and admin-only role               |
| DELETE | `/api/users/:id`             | Permanently delete own account, or any account as admin                 |

Use `me` instead of `:id` for your own account. Regular users cannot list other
users, create accounts through the admin endpoint, or change roles. Roles are
read from the database on each user-management request, so demotion and account
deletion take effect with existing bearer tokens. Deleted accounts receive 401;
admins requesting a missing target receive 404. Passwords/hashes are never
returned. Admin account creation does not replace the administrator's session.

Changing your own email or password requires `currentPassword` in the request.
Admins may reset another user's password without knowing the old password.
Duplicate email conflicts return 409 and invalid input returns 400. The database
restricts roles to `user` and `admin`. Existing accounts default to `user`.
User-management routes retain Arcjet protection.

Controllers in `src/controllers/user.controller.js` expose `createUser`,
`listUsers`, `getUserById`, `updateUser`, and `deleteUser`. Zod schemas in
`src/validations/user.validation.js` validate bodies, IDs, and pagination,
rejecting unexpected fields. Unexpected database failures are logged with the
operation and error type and return a generic 500 response; passwords, tokens,
and database error details are excluded from these logs.

### Migrate and bootstrap the first administrator

Apply the new role migration before using these endpoints. For Docker development:

```sh
./scripts/docker-dev.sh up
./scripts/docker-dev.sh migrate
# Register the intended account through /api/auth/sign-up, then:
docker compose --env-file .env.docker.dev -f compose.dev.yaml exec app npm run user:promote-admin -- admin@example.com
```

For production, build the release, run `./scripts/docker-prod.sh migrate`, and
start it with `./scripts/docker-prod.sh up`. An operator can then run:

```sh
docker compose --env-file .env.docker.prod -f compose.prod.yaml exec app npm run user:promote-admin -- admin@example.com
```

Without Docker, use `npm run db:migrate` then
`npm run user:promote-admin -- admin@example.com` with the intended environment.
The promotion command requires database credentials and promotes an existing
account only; it is not exposed as a public HTTP endpoint. No account is
promoted automatically. Additional role changes can use the authenticated API:

```http
PATCH /api/users/123
Authorization: Bearer <admin-token>
Content-Type: application/json

{"role":"admin"}
```

Profile updates use the same route with fields such as `{"name":"Updated Name"}`.
Password changes do not revoke existing stateless tokens before their expiry;
role checks and account-existence checks still apply on every user route.

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

You can also invoke them through npm:

```sh
npm run docker:dev                 # Build and start development
npm run docker:dev -- status       # Also accepts logs, down, init, build, test
npm run docker:dev:migrate
npm run docker:prod                # Build and start production
npm run docker:prod -- status
npm run docker:prod:migrate
```

The admin promotion script is available as
`npm run user:promote-admin -- admin@example.com`. It uses the environment of
the process where it runs; use the Compose exec command above to run it inside
the configured application container.

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

### Sign up as an administrator with HTTPie

Set `ADMIN_SIGNUP_KEY` to a long random secret in `.env.docker.dev` (or
`.env.docker.prod` for production), then recreate the app using
`npm run docker:dev` (or `npm run docker:prod`). For running without Docker,
set it in `.env.local` and restart the server. A blank or unset key disables
admin signup. Keep this key private; anyone with it can register as an admin.

In HTTPie, send `POST http://localhost:3001/api/auth/sign-up` with the header
`X-Admin-Signup-Key: <your configured key>` and this JSON body:

```json
{
  "name": "Administrator",
  "email": "admin@example.com",
  "password": "your-long-password",
  "role": "admin"
}
```

Use your configured app port if different. The response includes an admin user
and a bearer token for authenticated requests. Missing or incorrect signup keys
return 403. Remove the configured key and recreate the app to disable further
admin signups; existing admin accounts continue working.

## GitHub Actions

`.github/workflows/ci.yml` runs on pull requests, pushes to `main`, version tags
(`v*`), and manual dispatch. It calls `checks.yml` to run lint/format checks and
API tests in parallel, using Node from `.nvmrc` and `npm ci`.
Tests use PGlite and mocked Arcjet clients; no Neon or Arcjet secrets are needed.

Only after both checks pass, Docker builds the production and migration targets.
Pull requests build without publishing. Main and version-tag runs publish the
production image to `ghcr.io/dnnacheta/acquisitions` using GitHub's automatic
`GITHUB_TOKEN` with package write permission. No Docker Hub account is required.
Main publishes `latest`; version tags publish their exact tag (for example,
`v1.0.0`). Published builds also receive a `sha-<full-commit-sha>` tag.

Push these workflow files to activate the pipeline. View results in the GitHub
Actions tab and images in the repository's Packages section. Enable the lint and
API test checks in branch protection if you want to require them before merging.
For private packages, the deployment host needs registry read access.

This pipeline publishes images; it does not deploy to a server or run production
migrations. Server deployment automation requires the target host and access
configuration. Keep production database credentials and admin signup keys on the
deployment host, outside the image and repository.

## Email verification and password reset

Signups (including accounts created by admins) receive a verification email.
User responses include `emailVerifiedAt`: `null` until the address is confirmed.
Existing accounts and unverified users can still sign in; verification is recorded
without introducing an access requirement for the existing CRUD routes.
Changing an email address clears verification and sends a new verification link.

| Method | Endpoint                               | JSON body                                                     |
| ------ | -------------------------------------- | ------------------------------------------------------------- |
| POST   | `/api/auth/request-email-verification` | `{"email":"you@example.com"}`                                 |
| POST   | `/api/auth/verify-email`               | `{"token":"token-from-email"}`                                |
| POST   | `/api/auth/forgot-password`            | `{"email":"you@example.com"}`                                 |
| POST   | `/api/auth/reset-password`             | `{"token":"token-from-email","password":"your-new-password"}` |

These endpoints do not require a bearer token. Email requests return the same
202 message for unknown accounts, ineligible accounts, cooldowns, and delivery
failures. Failures are logged without email contents or credentials. Delivery is
synchronous; response times can vary with SMTP latency. Request another link if
an email does not arrive after checking the application logs and mail provider.

Verification links expire after 24 hours; password reset links after 30 minutes.
Each is single-use, with only its SHA-256 hash stored in the database. Resending
after the 60-second per-account cooldown replaces the previous link. The recovery
endpoints also share an Arcjet limit of five requests per IP per ten minutes,
using the existing Shield, bot protection, and error-decision behavior.

Email links open built-in `/verify-email` and `/reset-password` pages. The action
only happens after submitting the form, so a mail scanner opening a link does
not consume it. Tokens travel in URL fragments and are sent to the API in POST
bodies; access logs exclude query strings. In HTTPie, copy the value after
`#token=` from the email link into the JSON `token` field.

A successful reset clears the session cookie and invalidates previously issued
bearer tokens for user management. Sign in again with the new password. Changing
an email or password through user management invalidates outstanding reset links.

### Development email inbox

Apply the new migration, then rebuild the app with the new mail dependency:

```bash
npm run docker:dev:migrate
npm run docker:dev
```

Docker development uses Mailpit at `http://localhost:8025`. It captures mail
locally rather than delivering to real recipients. Sign up or request a reset,
open the inbox, and follow the link. The app URL defaults to localhost with your
configured `APP_PORT` (currently 3001 in your development environment).
Set `APP_BASE_URL` in `.env.docker.dev` if you access the app through another origin.

For host development, configure an SMTP server with `SMTP_HOST`, `SMTP_PORT`,
`MAIL_FROM`, and `APP_BASE_URL` in `.env.local`. Docker's Mailpit SMTP port is
internal to its network; only its inbox UI is published to localhost.

### Production email delivery

Configure these values in `.env.docker.prod` before rebuilding/recreating the app:

```dotenv
APP_BASE_URL=https://api.your-domain.com
SMTP_HOST=smtp.your-provider.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-smtp-username
SMTP_PASSWORD=your-smtp-password
MAIL_FROM=Acquisitions <noreply@your-domain.com>
```

Use the sender address verified with your mail provider. Port 587 uses STARTTLS;
for port 465 set `SMTP_SECURE=true`. TLS is required in production, and
`APP_BASE_URL` must be an HTTPS origin without a path, query, or credentials.
See [Nodemailer's SMTP configuration](https://nodemailer.com/smtp).

Run `npm run docker:prod:migrate` against the intended production database before
starting the new image. The migration adds nullable verification/recovery fields
and a session version default of zero, preserving existing accounts. No live
production migration is run by tests or GitHub Actions.

## Vercel deployment

The API is prepared for Vercel's native Express hosting, with Neon Cloud and SMTP.
See [the deployment guide](docs/vercel-deployment.md) for project settings,
production/preview environment variables, migrations, and first-deployment checks.
Docker Compose remains the local development environment.

## Customer and lead workspace

Open `/` in your browser for the CRM frontend. Sign in with an existing account
or create an account from the sign-in screen. The workspace includes an overview,
customer and lead lists, search and filtering, create/edit/delete dialogs, and a
six-stage sales pipeline. Lead stages can be changed from each pipeline card.
Values are recorded and displayed in **NGN**; amounts must be non-negative and
have at most two decimal places. No sample customers or leads are inserted into
real databases.

The frontend also supports profile updates, verification email requests, password
reset requests, and admin role changes. Bearer tokens are kept in sessionStorage
for the current tab and cleared on sign-out or session rejection. The API still
supports HTTPie. Email confirmation and reset links use the existing action pages.

### CRM API

All routes below require `Authorization: Bearer <token>`:

| Method               | Endpoint                 | Purpose                                                        |
| -------------------- | ------------------------ | -------------------------------------------------------------- |
| GET                  | `/api/crm/overview`      | Customer count, pipeline totals, recent leads, next follow-ups |
| GET / POST           | `/api/crm/customers`     | List or create customers                                       |
| GET / PATCH / DELETE | `/api/crm/customers/:id` | Read, update, or delete a customer                             |
| GET / POST           | `/api/crm/leads`         | List or create leads                                           |
| GET / PATCH / DELETE | `/api/crm/leads/:id`     | Read, update, or delete a lead                                 |

Lists support `page`, `limit` (1–100), and `search`. Customers also accept `status`
(`active`, `inactive`); leads accept `stage` (`new`, `contacted`, `qualified`,
`proposal`, `won`, `lost`). Responses contain the resource array, total, page,
limit, and hasMore. Individual create/read/update responses contain `record`.
PATCH only changes supplied fields, and unexpected fields are rejected.

Customer creation requires `name` and `email`; optional fields are `company`,
`phone`, `status`, and `notes`. Lead creation requires `title`; optional fields
are `contactName`, `email`, `company`, `source`, `value` (a JSON number in NGN),
`stage`, `customerId`, `followUpDate` (`YYYY-MM-DD`), and `notes`.

Records belong to their creator. Regular users can only manage their own records;
admins can manage all team records. Ownership is server-assigned and cannot be
changed through these endpoints. Linked customers must have the same owner as
the lead. Deleting a customer preserves its leads and removes their customer link.
Deleting a user preserves CRM records with no owner so administrators can still
manage them. Password resets and role changes take effect on CRM access too.

Follow-ups are dates on leads, shown in the overview; automatic reminder emails,
activity history, lead conversion, and reassignment are not part of this version.
The pipeline loads up to 100 cards per page, with a Load more control; its column
counts describe loaded records. Overview totals cover all accessible records.

Apply the CRM migration and rebuild local development:

```bash
npm run docker:dev:migrate
npm run docker:dev
```

For Vercel, commit the `public/crm-assets` files and `src/public/crm.html` along
with the APIs and migration. The existing configuration includes the HTML in the
function bundle and serves assets from the public directory. Apply migrations
to the production database before deploying the new code.
