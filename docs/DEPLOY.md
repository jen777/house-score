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

## Long-running streaming endpoints (HOA validator) & Traefik timeouts

The **HOA validator** (`POST /api/properties/[id]/hoa`) runs a web-search +
multi-step LLM pipeline and **streams progress** over a single long-lived
response. To stop a reverse proxy from idle-timing-out that connection during
the quiet web-search stretches, the server emits a heartbeat (`{"type":"ping"}`)
every 10 s. The client also recovers gracefully: if the connection drops before
the final `done` event, it refreshes and loads whatever the server saved.

The 10 s heartbeat defeats Traefik's **`idleTimeout`** (default **180 s**), so
the default Coolify/Traefik setup should work without changes. If you still see
the request cut off mid-run, the cause is almost always an entrypoint-level
timeout on Traefik:

- **`respondingTimeouts.writeTimeout`** — total time allowed to write a
  response. Default is `0` (unlimited); if it's been set to a finite value, it
  caps the whole stream regardless of the heartbeat. Set it to `0` (or large).
- **`respondingTimeouts.idleTimeout`** — max idle time on a connection
  (default `180s`). The heartbeat keeps us well under this; raise it only if you
  also raise the heartbeat interval.

These are **static entrypoint flags on the Traefik proxy**, not per-app labels.
In Coolify: **Server → Proxy → Configuration**, add (entrypoint name is usually
`http`/`https` — match your install):

```
--entrypoints.https.transport.respondingTimeouts.writeTimeout=0
--entrypoints.https.transport.respondingTimeouts.idleTimeout=600s
--entrypoints.http.transport.respondingTimeouts.writeTimeout=0
--entrypoints.http.transport.respondingTimeouts.idleTimeout=600s
```

Restart the proxy for the change to take effect. (Per-app `traefik.*` labels
can't set `respondingTimeouts` — it's entrypoint-global.)

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
