# Changelog

All notable changes to Edgewise are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Edgewise uses [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Added
- **Content Security Policy** — `script-src 'self'`, `object-src 'none'`, `form-action 'self'` and related directives on every response
- **`npm audit` in CI** — dedicated `security` job blocks merges on high/critical vulnerabilities
- **Per-panel error boundary** — individual panel failures show inline error + refresh link instead of crashing the whole page
- **Loading skeleton** — stat grid and trade count pulse while data fetches
- **Unit tests** — 42 isolated tests for `tradeValidator`, `analytics`, `rateLimiter` (no DB, no network)
- **GitHub Actions CI** — full test suite runs on Node 20 and 22 for every push and PR
- **Rate limiter memory fix** — expired entries pruned on every `hit()` call; Map stays bounded
- **Frontend module split** — `app.js` (548 lines) split into `public/modules/api.js`, `ui.js`, `trades.js`, `stats.js`, `charts.js`

---

## [1.0.0] — 2026-06-25

### Added
- Trading journal — log trades with R-multiple math (server-side), equity curve, win rate, expectancy, max drawdown, profit factor, current streak
- Mood and setup tag analytics — expectancy sliced by `setup_tag` and `mood`
- Risk guard rules — daily loss limit, max risk per trade, post-loss cooldown; violations recorded and surfaced
- **AI-powered weekly debrief** via Anthropic Claude (optional; falls back to algorithmic if `ANTHROPIC_API_KEY` not set)
- CSV export and CSV import with plan-limit enforcement and formula-injection guarding
- Auth — JWT httpOnly cookie sessions, bcrypt cost 12, email verification, password reset
- Admin panel — platform stats, user management, activate/deactivate accounts
- Rate limiting — login (10 req/15 min), password reset, trade create (100/hr), trade update (200/hr)
- Free vs Pro plan tier — free accounts limited to 30 trades per calendar month
- Security headers — HSTS, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, referrer policy, HTTP→HTTPS redirect in production
- SQLite with WAL mode, foreign keys, parameterised queries throughout
- Docker support, Render/Railway `render.yaml`, `Procfile` for buildpack hosts
- Health check endpoint at `/health` with DB ping
- Swagger/OpenAPI docs at `/api/docs`
- Graceful SIGTERM shutdown
