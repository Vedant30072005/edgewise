# Contributing to Edgewise

Thanks for your interest. This document covers how to set up a local dev environment, run tests, and submit changes.

---

## Local setup

```bash
git clone <repo-url>
cd edgewise
npm install
cp .env.example .env   # edit .env — set JWT_SECRET at minimum
npm run dev            # http://localhost:3000
```

Node 18+ required. The server auto-restarts on file changes via `--watch`.

On first boot, `data/edgewise.db` is created and an admin account is seeded from `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `.env`.

### Optional env vars

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | AI-powered weekly debrief (falls back to algorithmic if unset) |
| `SMTP_*` | Email delivery (dev mode prints links to console instead) |

---

## Running tests

```bash
npm test
```

Runs three suites in order:

| Suite | File | What it tests |
|-------|------|---------------|
| Unit | `test/unit.test.js` | `tradeValidator`, `analytics`, `rateLimiter` — no DB, no network |
| CSV | `test/csv.test.js` | CSV escaping and formula-injection guarding |
| Integration | `test/integration.test.js` | Full HTTP flows against a real in-memory server and a temp SQLite DB |

Integration tests use `DATA_DIR=data-test/` (a gitignored directory). They create fresh accounts with timestamped emails so reruns don't conflict.

---

## Project structure

```
edgewise/
├── server.js                  # Express entry point, security headers, page guards
├── src/
│   ├── db.js                  # SQLite schema, migrations, admin seeding
│   ├── auth.js                # JWT sessions, middleware, field validators
│   ├── tradeValidator.js      # computePnl + validateTrade (pure, no DB)
│   ├── analytics.js           # groupByKey helper (pure, no DB)
│   ├── rateLimiter.js         # Pluggable in-memory rate limiter
│   ├── csv.js                 # CSV cell escaping with formula-injection guard
│   ├── mailer.js              # Nodemailer wrapper (dev mode logs to console)
│   ├── logger.js              # Structured JSON logger
│   └── routes/
│       ├── auth.routes.js     # register / login / logout / verify / reset
│       ├── trades.routes.js   # trade CRUD, stats, debrief, CSV export
│       ├── settings.routes.js # risk guard rules
│       ├── admin.routes.js    # platform stats, user management
│       └── import.routes.js   # CSV import
├── public/
│   ├── index.html             # Landing page (interactive Equity Lab)
│   ├── app.html / app.js      # Journal dashboard (ES module orchestrator)
│   ├── modules/               # Frontend ES modules
│   │   ├── api.js             # fetch wrapper
│   │   ├── ui.js              # toast, dark mode, mobile nav, formatters
│   │   ├── trades.js          # table, form, filters, import
│   │   ├── stats.js           # stats grid, debrief, slices, risk guard
│   │   └── charts.js          # equity curve + monthly bars canvas
│   ├── admin.html             # Admin panel
│   ├── app.css                # Shared design system
│   └── shared.js              # Global api/toast/fmtR helpers (auth pages)
├── test/
│   ├── unit.test.js           # Pure unit tests
│   ├── csv.test.js            # CSV tests
│   └── integration.test.js    # HTTP integration tests
└── docs/
    └── decisions/             # Architecture Decision Records (ADRs)
```

---

## Making changes

1. **Branch** from `main`: `git checkout -b feat/your-feature`
2. **Write tests first** for any new business logic in `src/`
3. **Run `npm test`** — all 72 tests must pass
4. **Open a PR** with a clear description of what and why

### Code conventions

- Server: CommonJS (`require`), Express 5, better-sqlite3 (synchronous)
- Frontend: ES modules (`import/export`), no build step, no framework
- SQL: parameterised queries only — never string-interpolate user input
- No new dependencies without a clear reason — keep `package.json` lean

### Scaling notes

See [`docs/decisions/001-sqlite-over-postgres.md`](docs/decisions/001-sqlite-over-postgres.md) before proposing a database change.

The rate limiter (`src/rateLimiter.js`) is pluggable — see the comment at the top for how to swap in a Redis store for multi-instance deployments.

---

## Security

Found a vulnerability? **Do not open a public issue.** Email the maintainer directly (address in the package.json or repo settings). We aim to respond within 48 hours.
