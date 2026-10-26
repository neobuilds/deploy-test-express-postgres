# Express + PostgreSQL Notes

A small MIT-licensed Node 22 / Express app for trying xCloud's managed PostgreSQL site option. It uses `pg` directly, with server-rendered notes and add/delete forms. No build step, ORM, extensions or superuser permissions are needed.

## Deploy on xCloud

1. Create a **Node.js** site from this repository (`https://github.com/neobuilds/deploy-test-express-postgres`, branch `main`).
2. Select **Node 22**. In the **Database** section, pick **PostgreSQL**. xCloud provisions one database and role and writes the site's `.env` automatically.
3. Install with `npm ci --omit=dev` (no build command). Set the start command to **`npm start`**.
4. Keep xCloud's `PORT` and database variables. The process binds only to `127.0.0.1`; nginx proxies traffic to it. Visit `/`, `/health` and `/ready`.

`dotenv` loads `.env` from the application working directory, without overwriting existing environment variables. `DATABASE_URL` takes priority over `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD`. `DB_CONNECTION=pgsql` is accepted as platform metadata; this app always uses PostgreSQL. The fallback host/port are `127.0.0.1:5432`. Database, username and password must be supplied (an explicitly empty local password is allowed).

URL credentials are percent-decoded. Only the URL host, port, database and credentials are used; URL query options are ignored. SSL is explicitly disabled for the local managed database. Configuration failures and database errors never print the URL, password or raw driver error.

## Local run

Use Node 22 and an already running, throwaway PostgreSQL instance. From an existing PostgreSQL admin connection (no sudo required), create a dedicated database/role:

```sh
psql postgres
```

```sql
CREATE ROLE notes_demo LOGIN;
\password notes_demo
CREATE DATABASE notes_demo OWNER notes_demo;
\q
```

Choose a disposable password at the prompt, then from this app directory:

```sh
cp .env.example .env
# Set DB_PASSWORD in .env to the password you just chose.
npm ci
npm test
npm start
```

Open `http://127.0.0.1:3000`. Override `PORT` if needed. Never commit `.env`. To remove the local fixture afterward, use your existing admin connection to drop `notes_demo` database and role once the app is stopped.

## Behavior and persistence

- Startup creates `notes` idempotently inside a transaction, before accepting requests. Startup failure exits with a generic diagnostic and nonzero status. The database role only needs ownership of its database and normal schema/table privileges.
- Notes live in PostgreSQL, outside the app's release directory, and survive restart/redeploy when the same database credentials are retained. Deleting the database deletes the notes.
- `/` lists the newest 100 notes. Notes contain 1–2000 characters; the demo caps stored notes at 1000. Delete notes to make room. Writes use parameters, HTML is escaped, and forms carry an in-memory CSRF token. Reload forms after restarting the app.
- `GET /health` returns process liveness and release `1.0.0`, without a DB query. `GET /ready` runs `SELECT 1`, then reports server version, current database and user. DB failure returns HTTP 503 with no raw error details. Protect access at nginx if these deployment diagnostics should be private.
- SIGINT/SIGTERM stop the listener and drain the database pool, with a ten-second shutdown limit. Process logs go to stdout/stderr.

This is a shared, unauthenticated compatibility demo: anyone who can reach it can add or delete notes. Use disposable data.

## Verification

`npm test` uses `node --test` for URL precedence/decoding, DB_* fallback, invalid configuration, password/URL redaction and port validation. It needs no PostgreSQL server. Run `npm audit --omit=dev` for dependency advisories.

For lab qualification: start with a fresh owned database; verify `/health` and `/ready`; add a note and confirm it renders; reject blank/oversized notes, missing CSRF tokens and invalid delete IDs; restart twice with the same DB to exercise idempotent setup and persistence; delete the note and verify a second delete returns 404. Interrupt the owned DB and confirm readiness returns 503 while liveness stays 200, then verify recovery. Repeat after redeploy with unchanged credentials. Live xCloud qualification is pending; local tests do not establish it.
