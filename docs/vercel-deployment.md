# Deploying Acquisitions to Vercel

Vercel runs the Express API directly from source. The GitHub Container Registry
image is still useful for Docker deployments, but is not used for this deployment.
Local development continues to use Docker Compose, Neon Local, and Mailpit.

## Repository setup

- Framework preset: **Express**.
- Root directory: repository root (`.`).
- Node.js: **24.x**, matching `package.json`.
- Install command: default (`npm install` or Vercel's lockfile-based equivalent).
- Build command and output directory: leave at their Express defaults.
- Enable Fluid compute. Choose a function region near the production Neon branch.
- `index.js` exports the API without opening a listener. Docker starts `src/index.js`.
- `vercel.json` includes email form HTML in the function and permits requests up
  to 60 seconds. `public/account-assets/account.js` and `public/crm-assets/` are served by Vercel's CDN.
- Logs go to the console, and the database pool uses Vercel's lifecycle helper.

## Environment variables

Set these in the Vercel project's **Settings → Environment Variables**, selecting
Production. Do not upload an existing development environment file.

| Variable           | Production value                                                   |
| ------------------ | ------------------------------------------------------------------ |
| `DATABASE_URL`     | Pooled Neon Cloud URL for the production branch, with TLS          |
| `JWT_SECRET`       | Independent random secret of at least 32 bytes                     |
| `JWT_EXPIRES_IN`   | `1h` or your desired session lifetime                              |
| `ARCJET_KEY`       | Production Arcjet site key                                         |
| `APP_BASE_URL`     | Stable HTTPS app origin, such as `https://your-project.vercel.app` |
| `SMTP_HOST`        | Your email provider's SMTP hostname                                |
| `SMTP_PORT`        | `587` for STARTTLS or `465` for implicit TLS                       |
| `SMTP_SECURE`      | `false` for port 587; `true` for port 465                          |
| `SMTP_USER`        | SMTP username                                                      |
| `SMTP_PASSWORD`    | SMTP password                                                      |
| `MAIL_FROM`        | Sender verified by the email provider                              |
| `LOG_LEVEL`        | `info`                                                             |
| `LOG_TO_FILE`      | `false` (Vercel also disables file logging in code)                |
| `ADMIN_SIGNUP_KEY` | Optional private key; leave unset to disable admin signup          |

Do not set `ARCJET_ENV=development` in production. Configure trusted proxies only
if you add a proxy in front of Vercel, using the actual trusted infrastructure.
`APP_BASE_URL` must be an origin without a path or trailing query parameters.
Set it to the real project domain before testing email links; changing environment
variables requires a new deployment.

Preview deployments need their own Neon branch, JWT secret, Arcjet site, and
email sandbox. Do not give pull-request previews production credentials. Keep
preview deployment protection enabled; HTTPie requests and email links will need
to pass that protection. A stable preview domain makes email-link configuration
simpler than changing `APP_BASE_URL` for every deployment.

## Database migration before deployment

The email verification/reset migration has been applied only in development.
Apply the committed migrations to the production branch before deploying the
new code. Use its **direct** Neon URL as `DATABASE_URL_UNPOOLED` from a trusted
operator environment; it is not needed by the running Vercel application.

The existing production migration command remains available:

```bash
npm run docker:prod:migrate
```

Configure `.env.docker.prod` for the intended production branch first. Never copy
the development branch URL into production. Test migrations on an isolated branch
before applying them to production. Do not run migrations inside a Vercel build:
preview builds and concurrent deployments must not modify production schema.

## First deployment

1. Commit and push the prepared code, including the email feature and migrations.
2. In Vercel, add a project and import `Dnnacheta/acquisitions` from GitHub.
3. Confirm the settings above and provide Production environment variables.
4. Apply production migrations from the trusted operator environment.
5. Deploy, then confirm `GET /health` returns HTTP 200.
6. Test signup, signin, authenticated user access, email verification, and password
   reset using disposable accounts. Confirm an old bearer token stops working
   after a password reset.
7. Configure your custom domain and update `APP_BASE_URL` if needed, then redeploy.

GitHub's existing CI and Docker publishing remain enabled. Vercel's Git integration
runs independently of those workflows; use branch protection and review before
merging to `main` rather than assuming GitHub test failures block Vercel deployment.
No Vercel project has been created and no production deployment has been performed
as part of this repository preparation.

References: [Express on Vercel](https://vercel.com/docs/frameworks/backend/express),
[database pool management](https://vercel.com/kb/guide/efficiently-manage-database-connection-pools-with-fluid-compute).
