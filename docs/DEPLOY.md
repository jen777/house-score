# Deployment (Docker Compose + Coolify)

HouseScore ships as a self-contained Docker Compose stack: the Next.js app plus
its own Postgres. Coolify provides the reverse proxy, domain, and TLS — the
compose file deliberately does **not** publish host ports or run its own proxy.

## What's in the box

- `Dockerfile` — multi-stage build producing a Next.js **standalone** runtime
  image (small; only `server.js` + minimal deps + static assets).
- `docker-compose.yml` — two services:
  - `app` — the Next.js server, listening on container port **3000** (declared
    via `expose`, not `ports`).
  - `db` — `postgres:16-alpine` with a named volume `db_data` (private; no host
    port).
- The schema is created automatically at app startup (see
  `src/db/ensure-schema.ts`), so there is no separate migration step.

## Required environment variables

Set these in Coolify → your service → **Environment Variables** (see
`.env.example` for the full list):

| Variable            | Required | Notes |
| ------------------- | -------- | ----- |
| `APP_PASSWORD`      | yes      | Single-user login password. |
| `AUTH_SECRET`       | yes      | Long random string; signs the auth cookie. `openssl rand -hex 32`. |
| `ANTHROPIC_API_KEY` | for AI   | Enables listing extraction. App runs without it; extraction button errors clearly. |
| `ANTHROPIC_MODEL`   | no       | Defaults to `claude-sonnet-4-6`. |
| `POSTGRES_PASSWORD` | yes      | DB password (also used to build `DATABASE_URL`). |
| `POSTGRES_USER`     | no       | Defaults to `housescore`. |
| `POSTGRES_DB`       | no       | Defaults to `housescore`. |

`DATABASE_URL` is assembled automatically inside compose from the `POSTGRES_*`
values and points at the internal `db` service — you don't set it by hand in
compose.

## Deploy on Coolify

1. **New Resource → Docker Compose**, pointing at this repository/branch.
2. Coolify reads `docker-compose.yml`. Set the environment variables above in
   the UI (mark `APP_PASSWORD`, `AUTH_SECRET`, `ANTHROPIC_API_KEY`,
   `POSTGRES_PASSWORD` as secrets).
3. Assign your **domain** to the `app` service. Coolify routes it through its
   proxy to the container's internal port **3000** and handles TLS. (Domain
   redirects are configured in Coolify, not here.)
4. Deploy. On first boot the app creates its schema and seeds default scoring
   weights; the healthcheck hits `/api/health`.

> **TLS note:** the auth cookie is set with `Secure`, so the app must be served
> over HTTPS (Coolify does this for you). For plain-HTTP local testing, sign-in
> won't persist until you're behind TLS.

## Long-running work (HOA validator) — background job + polling

The **HOA validator** runs a web-search + multi-step LLM pipeline that can take
a while. To stay immune to reverse-proxy response timeouts (Traefik, nginx,
etc.), it does **not** hold a long-lived connection:

- `POST /api/properties/[id]/hoa` starts the job in the background and returns
  immediately (`202`).
- The job keeps running in the persistent Node server; its current stage lives
  in an in-memory store (`src/lib/hoa-jobs.ts`).
- The browser polls `GET /api/properties/[id]/hoa` every ~2 s to show the stage
  (searching → reading → writing → saving) and, on completion, refreshes to
  render the findings (which are saved to `hoa_details`).

Because every request is short, **no special Traefik/Coolify timeout
configuration is required**. Notes:

- This relies on the app being a **single long-lived container** (as deployed
  here) so the background promise and the in-memory progress survive between the
  POST and the polls. If you ever scale `app` to multiple replicas or a
  serverless platform, move the job state to the database (or a queue) since the
  POST and a later GET could hit different instances.
- A container restart mid-run loses the in-progress job; the client then reads
  `idle` and refreshes (the result is shown only if it had already been saved).

## Persistence & backups

- All data lives in the `db_data` volume. Back it up via Coolify's volume
  backups or `pg_dump` against the `db` service.
- Rebuilding/redeploying the `app` service does not touch `db_data`.

## Local development

```bash
cp .env.example .env          # fill in APP_PASSWORD, AUTH_SECRET, ANTHROPIC_API_KEY
# point DATABASE_URL at a local Postgres, then:
npm install
npm run dev                   # http://localhost:3000
```

Or run the whole stack the way Coolify will:

```bash
docker compose up --build
```
