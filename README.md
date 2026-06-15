# Edgewise — Trading Journal & Edge Analytics

Full-stack SaaS: marketing landing page + working product behind it.
Express 5 + SQLite backend, JWT cookie auth, per-user trade journal with
real analytics, and an admin panel.

## Quick start

```bash
npm install
cp .env.example .env        # then edit .env — set JWT_SECRET and admin credentials
npm start                   # http://localhost:3000
```

`npm run dev` restarts the server on file changes (Node 18+ `--watch`).

On first run the server creates `data/edgewise.db` and seeds the admin
account from `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `.env`.

| Route       | What it is                                        |
|-------------|---------------------------------------------------|
| `/`         | Landing page (interactive Equity Lab)             |
| `/register` | Create account                                    |
| `/login`    | Sign in                                           |
| `/app`      | Journal: log trades, equity curve, expectancy     |
| `/admin`    | Admin panel: platform stats, user management      |

## Project structure

```
edgewise/
├── server.js                  # Express entry point, page guards
├── src/
│   ├── db.js                  # SQLite schema + admin seeding
│   ├── auth.js                # JWT cookie sessions, middleware, validators
│   └── routes/
│       ├── auth.routes.js     # register / login / logout / me
│       ├── settings.routes.js # risk guard rules
│       ├── trades.routes.js   # trade CRUD, stats, CSV export
│       └── admin.routes.js    # platform stats, user management
├── public/
│   ├── index.html             # landing page
│   ├── login.html / register.html
│   ├── app.html               # journal dashboard
│   ├── admin.html             # admin panel
│   ├── app.css                # shared design system
│   └── shared.js              # fetch wrapper, toast, helpers
├── data/                      # SQLite database (created at runtime, gitignored)
├── .env.example
└── package.json
```

## How the journal math works

Every trade stores the money you risked (`risk_amount` = 1R). The server
computes:

- `pnl` = (exit − entry) × quantity × direction (long = +1, short = −1)
- `r_multiple` = pnl / risk_amount

The stats endpoint derives the equity curve (cumulative R), win rate,
expectancy (mean R per trade), max drawdown in R, profit factor, and
expectancy sliced by setup tag and by mood at entry. All math is
server-side; the client only renders.

## API reference

All endpoints are JSON. Auth is an httpOnly cookie (`ew_token`, 7-day JWT).

### Auth
| Method | Path                 | Body                      | Notes                       |
|--------|----------------------|---------------------------|-----------------------------|
| POST   | `/api/auth/register` | `email, name, password`   | Sets session cookie         |
| POST   | `/api/auth/login`    | `email, password`         | Rate-limited: 10 / 15 min   |
| POST   | `/api/auth/logout`   | —                         | Clears cookie               |
| GET    | `/api/auth/me`       | —                         | Current user                |

### Trades (authenticated)
| Method | Path                      | Notes                                  |
|--------|---------------------------|----------------------------------------|
| GET    | `/api/trades`             | All trades, chronological              |
| POST   | `/api/trades`             | Create — returns any rule `violations` |
| PUT    | `/api/trades/:id`         | Update own trade                       |
| DELETE | `/api/trades/:id`         | Delete own trade                       |
| GET    | `/api/trades/stats`       | Curve + all derived metrics            |
| GET    | `/api/trades/violations`  | Last 50 risk-rule violations           |
| GET    | `/api/trades/debrief`     | 7-day review + one action item         |
| GET    | `/api/trades/export.csv`  | Full journal as CSV                    |

Trade fields: `trade_date` (YYYY-MM-DD), `symbol`, `side` (long|short),
`entry_price`, `exit_price`, `quantity`, `risk_amount`, `setup_tag`,
`mood` (calm|neutral|fomo|revenge|fear|overconfident), `notes`.

### Risk guard settings (authenticated)
| Method | Path            | Notes                                            |
|--------|-----------------|--------------------------------------------------|
| GET    | `/api/settings` | Current rules (null = disabled)                  |
| PUT    | `/api/settings` | `daily_loss_limit_r, max_risk_amount, cooldown_minutes` |

Three rules, checked on every trade log: **daily loss limit** (day closes
below −limit R), **max risk per trade** (risk_amount above your cap), and
**post-loss cooldown** (logging within N minutes of a logged loss —
measured by logging time, so backfilled journals won't false-positive
meaningfully). Violations never block the log; the journal records reality.
They are stored permanently and surface in the journal and weekly debrief.

The **weekly debrief** summarizes the last 7 days — net R, win rate, worst
setup, costliest emotional state, rule breaks — and produces exactly one
action item, chosen by priority: revenge-window logging first, then a
losing mood, then a losing setup, then untagged trades.

### Admin (admin role only)
| Method | Path                          | Notes                                |
|--------|-------------------------------|--------------------------------------|
| GET    | `/api/admin/stats`            | Accounts, trades, last-7-day volume  |
| GET    | `/api/admin/users`            | Users + journal activity             |
| PATCH  | `/api/admin/users/:id/active` | `{ is_active: bool }` — deactivate   |
| DELETE | `/api/admin/users/:id`        | Delete user + their journal          |

Admins can't deactivate/delete themselves or other admins from the panel.

## Deploying

The app is hardened for hosting: it trusts one proxy hop, sends Secure cookies
and HSTS and redirects HTTP→HTTPS when `NODE_ENV=production`, sets baseline
security headers, and keeps SQLite on a configurable path.

**1. Set these environment variables on your host** (Render/Railway/Fly
dashboard, or `docker run --env-file`). The repo's `.env` is gitignored and is
not shipped to the host:

| Variable         | Value                                                                          |
|------------------|--------------------------------------------------------------------------------|
| `NODE_ENV`       | `production` (the Dockerfile sets this automatically)                           |
| `JWT_SECRET`     | long random string — `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `ADMIN_EMAIL`    | your admin login email                                                         |
| `ADMIN_PASSWORD` | a strong password (seeded into a fresh DB on first boot)                        |
| `APP_URL`        | your public `https://` URL (used in email links)                               |
| `DATA_DIR`       | path to a **persistent volume**, e.g. `/data`                                  |
| `SMTP_*`         | SMTP creds so password-reset / verification emails actually send               |

**2. Mount a persistent disk** at whatever `DATA_DIR` points to. SQLite is a
file — without a persistent volume your data is wiped on every deploy/restart.
On Fly/Railway add a volume; on Render add a disk; with Docker use
`-v edgewise-data:/data`.

**3. Deploy.** With Docker:

```bash
docker build -t edgewise .
docker run -p 3000:3000 --env-file .env -v edgewise-data:/data edgewise
```

On a buildpack host, `npm start` is auto-detected (a `Procfile` is included).
Use a host with a real filesystem (Render/Railway/Fly/a VPS) — serverless and
edge platforms (Vercel/Netlify/Cloudflare) can't run the native `better-sqlite3`
module and have no persistent disk.

## Security notes

Hardened in this build: parameterized SQL, bcrypt (cost 12), httpOnly + Secure
JWT cookies, `trust proxy`, HSTS + HTTP→HTTPS redirect, `nosniff` / `DENY` /
referrer headers, login and password-reset rate limiting, upload size/type
limits, and CSV-export formula-injection guarding.

Still your responsibility:

1. **Keep secrets secret** — never commit `.env`; rotate `JWT_SECRET` if it
   leaks (rotating invalidates all existing sessions).
2. **Change the seeded admin password** after first login, or set a strong
   `ADMIN_PASSWORD` before the first boot that creates the database.
3. **Configure SMTP** — without it, password-reset and verification links only
   print to the server log, so users can't self-serve account recovery.
4. **Add CSRF protection** if you move off `SameSite=Lax` or add cross-origin
   clients.
5. The login rate limiter is in-memory — it resets on restart and isn't shared
   across instances. For multi-instance, back it with Redis (the limiter is
   pluggable — see `src/rateLimiter.js`).
6. SQLite suits one box and modest traffic. Multiple app servers need
   Postgres/MySQL.

## License

MIT
