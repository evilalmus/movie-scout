# Movie Scout — self-hosted edition

A static React frontend plus a standalone Node 24 / SQLite backend. There is no ChatGPT, Sites, Cloudflare Worker, or D1 runtime dependency.

The recommended layout matches Double Feature:

| Component | Host | Example address |
| --- | --- | --- |
| Frontend | GitHub Pages | `https://movie-scout.g33k.bar` |
| API, SQLite, collection worker and scheduler | Docker on Unraid | `https://movie-scout-api.g33k.bar` |

These are suggested addresses, not domains configured by this package.

## What's included

- Two-way review-score ranges and independently selectable content intensity/presence.
- Actor/director, US certification, genre, language, release year and runtime filters.
- Strict unknown-data handling and an optional incomplete-results view.
- Persistent movie catalog, title import, queued enrichment and source attribution.
- An internal daily popularity scheduler; no open browser, external cron or ChatGPT automation required.
- GitHub Pages build/deploy workflow, editable public API configuration and a prebuilt `dist/` frontend.
- Backend Dockerfile and Compose service. An optional Nginx frontend container is included.
- UID/GID `99:100` defaults and `/mnt/user/appdata/movie-scout` persistence for Unraid.

**Data connections are required.** TMDB, OMDb and Safe Stream are implemented. Set backend credentials in `.env`; no secrets belong in GitHub Pages. Preview values remain illustrative.

## 1. Run the backend on Unraid

Extract this folder somewhere such as `/mnt/user/appdata/movie-scout-src/`. Keep source files separate from the database directory.

From an Unraid terminal in the source folder:

```bash
cp .env.example .env
install -d -m 0770 -o 99 -g 100 /mnt/user/appdata/movie-scout
```

Edit `.env` before starting. Set at least:

```dotenv
TMDB_TOKEN=your_tmdb_api_read_access_token
ALLOWED_ORIGINS=https://movie-scout.g33k.bar
TZ=America/Los_Angeles
DAILY_ENABLED=true
DAILY_TIME=06:00
```

`TMDB_TOKEN` is the **API Read Access Token (bearer token)**, not the shorter v3 API key. Add `OMDB_API_KEY` if you want the available review scores. Leave unknown provider credentials blank.

Build and start the backend:

```bash
docker compose up -d --build api
docker compose logs -f api
```

Check it on your LAN:

```bash
curl http://YOUR_UNRAID_IP:4174/api/health
```

The expected health response is `{"status":"ok"}`. `GET /api/status` shows connection flags, catalog count and scheduler status, without exposing keys. A configured flag means a credential was supplied; the first source request verifies whether it works.

Place the API behind your existing HTTPS reverse proxy, routing the API hostname to `http://YOUR_UNRAID_IP:4174`. GitHub Pages is HTTPS, so its browser requests must use an HTTPS API URL. Do not expose `.env` or the data directory through your web server.

If using your existing Docker network `g33kdock`, select it in Unraid's Docker configuration or add that external network to Compose. Compose's default bridge network is sufficient when the reverse proxy routes through the Unraid host port.

### Unraid Docker GUI alternative

Build the local image once from the source folder:

```bash
docker build -t movie-scout-api:local .
```

Then add a container with these settings:

| Setting | Value |
| --- | --- |
| Name | `movie-scout-api` |
| Repository/image | `movie-scout-api:local` |
| Network | `bridge`, or your existing `g33kdock` |
| Host port → container port | `4174` → `4174` TCP |
| Host path → container path | `/mnt/user/appdata/movie-scout` → `/data` read/write |
| User | `99:100` (image default; `--user=99:100` also works) |
| `DATA_DIR` | `/data` |
| `PORT` | `4174` |
| `TMDB_TOKEN` | Your TMDB read-access token |
| `ALLOWED_ORIGINS` | Exact frontend origin(s), comma-separated |
| `TZ` | `America/Los_Angeles` |
| `DAILY_ENABLED` | `true` |
| `DAILY_TIME` | `06:00` |

Add optional `OMDB_API_KEY` and `SAFESTREAM_TOKEN` (or `SAFESTREAM_EMAIL` and `SAFESTREAM_PASSWORD`) as environment variables. The image runs without root and writes only to its data directory and temporary space. Create the host data directory with owner `99:100` first.

## 2. Deploy the frontend to GitHub Pages

Put this directory's contents at the root of a GitHub repository. `package.json`, `index.html`, and `.github/` should be at the repository root, not one directory below it.

1. In **Settings → Secrets and variables → Actions → Variables**, add:
   - `MOVIE_SCOUT_API_BASE` = your API's HTTPS origin, e.g. `https://movie-scout-api.g33k.bar`. Do not append `/api`.
   - Optional `MOVIE_SCOUT_CUSTOM_DOMAIN` = your frontend hostname, e.g. `movie-scout.g33k.bar`.
2. In **Settings → Pages**, choose **GitHub Actions** as the build source.
3. Push to `main`, or manually run **Deploy frontend to GitHub Pages** in Actions.
4. If using a custom domain, configure its DNS and GitHub Pages domain/HTTPS settings.
5. Ensure the frontend origin is listed in the backend's `ALLOWED_ORIGINS`, then recreate the API container if you changed `.env`:

```bash
docker compose up -d --force-recreate api
```

For a repository URL such as `https://USERNAME.github.io/movie-scout/`, the CORS origin is **`https://USERNAME.github.io`**, with no repository path. Relative assets work both at `/` and under `/movie-scout/`; no special build base is needed.

These GitHub variables are public configuration, not API secrets. TMDB, OMDb and guidance credentials belong only on the Docker backend.

### Deploy the prebuilt frontend without rebuilding

The included `dist/` directory is ready for static hosting. Edit `dist/config.js`:

```js
window.MOVIE_SCOUT_CONFIG = {
  apiBase: "https://movie-scout-api.g33k.bar",
  demo: false
};
```

Publish **the contents** of `dist/`, preserving `.nojekyll`, `assets/`, and `config.js`. If using GitHub's branch-based Pages deployment, put those contents at the selected branch root or `/docs`, not an arbitrary `dist` directory. For normal source-based deployments, use the included Actions workflow instead.

For future builds, edit `public/config.js` or use the repository variables. Changes made only to `dist/config.js` are replaced by a rebuild.

## Alternative: host the frontend in Docker too

Add your actual frontend LAN/domain origins to `.env`, for example:

```dotenv
ALLOWED_ORIGINS=http://192.168.1.50:8087,https://movie-scout.g33k.bar
```

Start both containers:

```bash
docker compose --profile frontend up -d --build
```

Open `http://YOUR_UNRAID_IP:8087`. The Nginx container serves the static frontend and proxies `/api` to the API container. Its public runtime configuration is generated at startup; `API_BASE=""` means same-origin `/api`, and `DEMO=false` enables the live catalog.

The optional container uses an unprivileged Nginx configuration with UID/GID `99:100`. If you run it outside Compose, either give the backend the network alias `api`, or set `API_BASE` to its HTTPS origin. Both containers must share a Docker network for the internal `/api` proxy.

## Persistence, scheduling and updates

- Database: `/data/movie-scout.sqlite`, including its `-wal` and `-shm` sidecars while active.
- Schema migrations apply automatically on startup, transactionally and once each.
- New imports are queued and processed independently of the frontend. Up to two queued jobs are processed per worker pass. Failed requests back off, and interrupted jobs can be reclaimed after their lease expires.
- The daily scheduler checks each minute. At or after `DAILY_TIME` in `TZ`, it fetches TMDB's top ten popularity-ranked movies (US region), adds missing entries and refreshes stale ones.
- It stores a calendar-day run record. A restart after the scheduled time performs today's catch-up if it has not completed. It does not backfill every missed day.
- Already-completed daily runs are not repeated. Repeated popular titles mean fewer than ten new movies may be added.
- Missing credentials leave the scheduler waiting for TMDB. It does not populate the catalog with preview data.
- No user page needs to be open for jobs, retries, or daily updates.

To update code:

```bash
docker compose up -d --build api
```

For both containers:

```bash
docker compose --profile frontend up -d --build
```

To take a consistent backup, stop the API, back up the entire host data directory, then restart it. Retain `.env` separately in a secure location. Do not copy only the SQLite main file while writes are active.

### Optional manual daily run

Set a random `JOB_TOKEN` on the backend to enable `POST /api/daily` with `Authorization: Bearer <JOB_TOKEN>`. The internal timer does not need this token. Never put it in browser configuration. Manual calls remain subject to the same per-day deduplication.

## Content-guidance adapter

`GUIDANCE_FEED_URL` is an HTTPS endpoint for a chosen authorized data supplier or your own adapter. It is **not a built-in subscription or a promise that an existing vendor exposes this schema**. Safe Stream is built in and does not need this alternative adapter.

The backend adds `tmdb_id` and, when known, `imdb_id` query parameters. `GUIDANCE_FEED_TOKEN`, if set, is sent as a bearer token only to that configured endpoint.

Response example (synthetic values):

```json
{
  "tmdbId": 123,
  "guidance": {
    "violence": {
      "scaleMax": 10, "level": 3,
      "present": true,
      "source": "Your authorized provider",
      "url": "https://provider.example/movie/123",
      "checkedAt": "2026-10-05T00:00:00.000Z",
      "description": "Optional sourced description, behind a spoiler disclosure."
    }
  },
  "scores": { "audience": 85 },
  "scoreEvidence": {
    "audience": {
      "source": "Your authorized provider",
      "url": "https://provider.example/movie/123",
      "checkedAt": "2026-10-05T00:00:00.000Z"
    }
  }
}
```

Supported categories: `violence`, `nudity`, `sex`, `profanity`, `substances`, `frightening`. Scores use the native `0–10` numeric scale and require `scaleMax: 10`. `null` means unknown. Presence is `true`, `false`, or `null`. Nudity and sexual activity are independent; do not infer either from a combined category. Each supplied score needs matching evidence.

The optional OMDb integration supplies available IMDb and RT critic scores. It does not invent an RT audience score or detailed content guidance. Check provider terms for your intended deployment, especially commercial use. Previously collected evidence remains dated when a source refresh fails.

## Public API limits

The API is intended to allow visitors to search and add movies. CORS restricts browser origins; it is not authentication. The backend includes per-IP and global request limits, bounded candidate imports, timeouts and durable provider request budgets.

`ENABLE_PUBLIC_IMPORTS=false` disables unauthenticated import/expansion writes; ordinary catalog searches remain available. A reverse proxy can add authentication if the whole site should be private. Avoid putting any administrator token into the frontend to work around this setting.

`TRUST_PROXY=false` is the default. If enabled, the backend uses the last `X-Forwarded-For` address. Enable it only when direct access is restricted to your proxy and the proxy overwrites/appends that header correctly. Otherwise leave it false; rate limits may then apply collectively to traffic from the proxy.

Daily request budgets reset at UTC midnight and count attempted upstream requests. Defaults: TMDB 2000, OMDb 900, guidance 2000. Adjust them to your actual provider plan using `.env`. Provider keys are never returned to the browser.

## Development and tests

Requires Node 24 and npm:

```bash
npm ci
cp .env.example .env
npm run build:backend
npm start
```

In another terminal:

```bash
npm run dev
```

Set `public/config.js` to `{ apiBase: "", demo: false }` for Vite's local `/api` proxy. Allow `http://localhost:5173` in `.env`.

Build and test:

```bash
npm run typecheck
npm run build
npm test
```

The backend uses native Node SQLite plus Zod, with no native add-on compilation or separate database server. The frontend is a Vite static build and contains no server runtime.

The automated tests use synthetic provider fixtures; they do not contact real movie providers. See `VALIDATION.md` for verified behavior and limitations.


## Safe Stream setup and upgrade

Copy the new SAFESTREAM entries from `.env.example` into your existing backend `.env`.
Use SAFESTREAM_TOKEN for an existing bearer token, or set SAFESTREAM_EMAIL and
SAFESTREAM_PASSWORD for automatic token acquisition. Do not send credentials to
ChatGPT or put them in public/config.js. Keep any special password characters quoted
according to your env-file format. Then rebuild: `docker compose up -d --build api`.
Rebuild/redeploy the frontend too for numeric range controls.

The adapter supports top-level scores from current responses and the documented
content_rating object. It matches normalized title and year, rejects ambiguous
matches, and recognizes Seven/Se7en. Other alternate titles may remain unmatched.
Scores stay native 0–10. Missing scores are unknown; presence is never inferred from
nudity scores, which may include sexual references. Only violence, nudity and
language (stored as profanity) are supplied. Source identity and comments are kept.

Successful guidance is cached persistently without automatic expiry. Missing or
ambiguous matches are cached seven days. Duplicate concurrent lookups share one
request sequence. Daily popularity skips existing movies. Manual imports can retry
missing guidance after the metadata cache's 24-hour window.

All Safe Stream HTTP attempts, including authentication and retries, count toward
SAFESTREAM_MONTHLY_LIMIT (default 1000). Counters persist in SQLite and reset by UTC
calendar month. Background work stops at limit minus SAFESTREAM_USER_RESERVE
(default 300); user lookups may use the full allowance and get queue priority.
If you use the same account elsewhere, lower this limit to leave headroom. Align it
with your provider's actual billing period if it is not a UTC calendar month.
Source status displays usage. No automatic refresh consumes the allowance.

Migration 003 preserves old four-level guidance in each movie's legacyGuidance field
and clears it from active numeric filters; it is not converted to invented 10-point
scores. Existing movies can be reimported after 24 hours to obtain Safe Stream data.
Back up movie-scout.sqlite before upgrading (stop the container before copying it).
