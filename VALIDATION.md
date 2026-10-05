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
