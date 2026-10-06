# Self-hosted validation

Completed in this environment with Node 24.19.0:

- Fresh `npm ci` using the included lockfile.
- Frontend and backend TypeScript checks passed.
- Backend TypeScript build and static Vite production build passed.
- 56 JavaScript/SQLite filter and sorting parity checks passed, plus input bounds, unknown values, SQL injection handling and job lease recovery.
- Real HTTP backend tests passed for allowed CORS preflight, denied origins, missing credentials, invalid filter requests and protected manual scheduling.
- With mocked external providers, the internal scheduler imported exactly ten ranked movies without a browser or manual schedule call.
- A repeat daily call returned the existing completed run without duplicate records.
- Mocked-provider import and content/score filtering passed, including requiring severe violence/nudity and excluding unknown audience scores by default.
- SQLite data and daily run state survived a server restart. A durable queued job resumed on restart without browser polling.
- Static output references relative asset paths and public runtime configuration, supporting GitHub Pages repository subpaths.

Not performed:

- Docker image build/run: Docker is not installed in this execution environment. Dockerfiles target the same Node 24 runtime used in the backend tests, but container execution and Nginx runtime have not been verified here.
- Real-provider credential testing or content-guidance integration: no credentials or authorized feed were supplied.
- Deployment to the user's Unraid server or GitHub repository: no server/repository access was supplied. This is a deployable package, not a claim of installation.
- Browser visual/interaction QA: not performed in this environment.

The preview catalog is intentionally separate from persisted data and contains illustrative scores/content guidance. It must not be treated as factual movie data.


Safe Stream update (2026-10-05): backend and frontend production builds passed.
56 SQL/JavaScript filter and sort parity checks passed. Safe Stream tests cover
login-token acquisition, top-level and legacy nested response schemas, native 0–10
scores, unknown presence, Seven/Se7en identity, mismatched-title negative caching,
concurrent deduplication, successful cache reuse, persisted request accounting and
background/user budget boundaries. Existing HTTP, scheduler, CORS and database
restart tests passed. Provider calls were mocked; no live credentials were used.
Docker execution and visual browser QA were not performed in this update.

Direct RT update: live Node search and detail collection succeeded on 2026-10-05
for Se7en (1995): 84 critics, 95 ALL audience; Top Gun: Maverick (2022): 96 critics,
99 VERIFIED audience. These are observed retrieval values, not permanent fixtures.
Automated tests cover identity mismatch, wrong-year candidates, invalid/hidden/null
scores, zero scores, external-link rejection, cache reuse and concurrent deduplication.
No Docker engine execution was performed here; deployment remains user-hosted.

## Kids-in-Mind collector — 2026-10-06

- Backend/frontend builds and TypeScript checks passed.
- Existing filter parity, Safe Stream, RT and backend lifecycle tests passed.
- Added tests for title/year and canonical identity, score corroboration, zero scores,
  search-result title suffixes, robots restrictions/delay, persisted request spacing,
  concurrent ticks, native-category preservation, caching, daily budget, Retry-After,
  challenge pauses, separately paced redirects and unmatched cooldowns.
- Low-volume live checks: robots.txt advertises Crawl-delay 30; Resident Evil (2026)
  review parsed as combined sex/nudity 2, violence 9, language 10; homepage discovery
  found its URL. Site search for Seven exposed the correct 1995 review link, which
  matched the Se7en alias. Search uses /search-desktop.htm?fwp_keyword=.
- No full-site crawl or live bulk backfill was performed. Future page layouts and
  coverage can change; unsupported pages stay unmatched. Deployment on the user's
  Unraid host remains to be performed.

## Reuse search listings — 2026-10-06

Added regression coverage for extracting all scored search listings, malformed scores,
deduplication, ambiguous identities, existing-movie enrichment, new-movie TMDB-only
imports, content-rating provenance and preserving fresh full-review scores. The complete
17-test suite passed before the final content-rating provenance addition; targeted tests
and type checking cover that addition. No live bulk harvesting was performed.

## Logging update

Added SQLite-triggered persistent movie audit events and bounded denial diagnostics.
Regression tests cover insert/update/delete, external-connection edits, rollback and
no-op suppression, header allowlisting, secret redaction and response excerpt limits.
