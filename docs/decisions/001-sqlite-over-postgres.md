# ADR 001: SQLite over Postgres

**Date**: 2026-06-25  
**Status**: Accepted  
**Deciders**: Project maintainer

---

## Context

Edgewise is a single-tenant trading journal SaaS. The database stores user accounts, trade logs, risk settings, and violations. At launch, the expected load is:

- **Users**: < 1,000 accounts
- **Trades**: < 500,000 rows total
- **Concurrency**: single web process, one request at a time per user
- **Deployment**: one VPS or a single Render/Railway/Fly instance

The data is relational, append-heavy, and read-mostly (users read their own history far more than they write).

---

## Decision

Use **SQLite via `better-sqlite3`** as the primary database.

---

## Rationale

### Why SQLite wins at this scale

| Factor | SQLite | Postgres |
|--------|--------|---------|
| Setup complexity | Zero — file on disk | Managed service or self-hosted server |
| Operational cost | $0 | $7–25/mo (managed) |
| Latency | Sub-millisecond (in-process) | Network round-trip per query |
| Backup | `cp edgewise.db backup.db` | pg_dump, WAL archiving |
| Dependencies | None beyond Node | Connection pool, SSL certs, migrations |
| Max throughput | ~50k writes/sec (WAL mode) | Horizontally scalable |

SQLite in WAL mode handles read concurrency well. `better-sqlite3` is synchronous, which means no connection pool, no async deadlocks, and no "max connections exceeded" errors.

### What we lose

- **Horizontal scaling**: SQLite is a single file. Multiple app instances cannot safely write to the same file over a network share. If Edgewise ever needs more than one server (>~10k daily active users), we need Postgres.
- **Postgres-specific features**: `LISTEN/NOTIFY`, partial indexes on expressions, advanced JSON operators.

### When to revisit

Switch to Postgres when **any** of the following is true:

1. The app needs to run on more than one process/instance simultaneously
2. The database file exceeds **10 GB** (SQLite works fine larger, but Postgres tooling is better at that scale)
3. A feature requires `LISTEN/NOTIFY` or real-time pub/sub
4. The deployment host cannot provide a persistent volume for the SQLite file

---

## Migration path

The database layer is isolated to `src/db.js`. All queries use `better-sqlite3`'s prepared statement API. To migrate:

1. Replace `better-sqlite3` with a `pg` connection pool
2. Swap synchronous `.get()` / `.all()` / `.run()` calls for `await pool.query()`
3. Translate SQLite-specific SQL (`strftime`, `julianday`, `PRAGMA`) to Postgres equivalents
4. Set `DATABASE_URL` in the environment

The route files and business logic are database-agnostic — they receive plain JS objects from `db.js` and don't know (or care) what's underneath.

---

## Alternatives considered

| Option | Rejected because |
|--------|-----------------|
| Postgres from day one | Adds operational cost and complexity before there's evidence it's needed |
| PlanetScale / Neon (serverless) | `better-sqlite3` can't run on edge runtimes; schema migration story is different |
| MongoDB | Schema-less storage is a regression for relational trade data with strict CHECK constraints |
| Turso (distributed SQLite) | Interesting, but adds a vendor dependency; revisit when horizontal scale is required |
