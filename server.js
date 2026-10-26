import 'dotenv/config';
import express from 'express';
import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { databaseConfig, portNumber } from './config.js';

const escape = (value) => String(value).replace(/[&<>"']/g, (char) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

async function migrate(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`CREATE TABLE IF NOT EXISTS notes (
      id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

function createApp(pool) {
  const app = express();
  const csrf = randomBytes(32).toString('hex');
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'" });
    next();
  });
  app.get('/health', (_req, res) => res.json({ status: 'ok', release: '1.0.0' }));
  app.get('/ready', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      const { rows } = await pool.query(`SELECT current_setting('server_version') AS version,
        current_database() AS database, current_user AS "user"`);
      res.json({ status: 'ready', ...rows[0] });
    } catch { res.status(503).json({ status: 'unavailable' }); }
  });
  app.use(express.urlencoded({ extended: false, limit: '12kb' }));
  app.use((req, res, next) => {
    if (req.method === 'POST' && req.body?.csrf !== csrf) return res.status(403).send('Reload the form and try again.');
    next();
  });
  app.get('/', async (_req, res) => {
    const { rows } = await pool.query('SELECT id, body FROM notes ORDER BY id DESC LIMIT 100');
    res.type('html').send(`<!doctype html><html lang="en"><meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1"><title>PostgreSQL Notes</title>
      <body><main><h1>PostgreSQL Notes</h1><p>Latest 100 notes · release 1.0.0</p>
      <form method="post" action="/notes"><input type="hidden" name="csrf" value="${csrf}">
      <label>New note <textarea name="body" required maxlength="2000"></textarea></label>
      <button>Add note</button></form><ul>${rows.map((note) => `<li><p>${escape(note.body)}</p>
      <form method="post" action="/notes/${note.id}/delete"><input type="hidden" name="csrf" value="${csrf}">
      <button>Delete note ${note.id}</button></form></li>`).join('')}</ul></main></body></html>`);
  });
  app.post('/notes', async (req, res) => {
    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
    if (!body || body.includes('\0') || [...body].length > 2000) return res.status(400).send('Enter a note of 1–2000 characters without null bytes.');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('LOCK TABLE notes IN SHARE ROW EXCLUSIVE MODE');
      const { rows } = await client.query('SELECT count(*)::int AS count FROM notes');
      if (rows[0].count >= 1000) {
        await client.query('ROLLBACK');
        return res.status(409).send('The demo is full. Delete a note first.');
      }
      await client.query('INSERT INTO notes (body) VALUES ($1)', [body]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
    res.redirect(303, '/');
  });
  app.post('/notes/:id/delete', async (req, res) => {
    if (!/^[1-9]\d{0,9}$/.test(req.params.id) || Number(req.params.id) > 2147483647) {
      return res.status(400).send('Invalid note ID.');
    }
    const result = await pool.query('DELETE FROM notes WHERE id = $1', [req.params.id]);
    if (!result.rowCount) return res.status(404).send('Note not found.');
    res.redirect(303, '/');
  });
  app.use((_req, res) => res.status(404).send('Page not found.'));
  app.use((error, _req, res, _next) => {
    if (error.type === 'entity.too.large') return res.status(413).send('Form is too large.');
    if (error.status === 400) return res.status(400).send('Invalid form.');
    res.status(503).send('Database temporarily unavailable.');
  });
  return app;
}

let pool;
try {
  const port = portNumber(process.env.PORT, 3000);
  pool = new pg.Pool(databaseConfig());
  pool.on('error', () => console.error('Database connection interrupted.'));
  await migrate(pool);
  const server = createApp(pool).listen(port, '127.0.0.1', () => console.log(`Notes listening on port ${port}.`));
  server.on('error', () => { console.error('HTTP listener failed.'); process.exitCode = 1; void pool.end(); });
  const shutdown = () => {
    const timer = setTimeout(() => process.exit(1), 10000);
    timer.unref();
    server.close(() => { void pool.end().finally(() => clearTimeout(timer)); });
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
} catch {
  console.error('Startup failed. Check database access and port configuration.');
  if (pool) await pool.end();
  process.exitCode = 1;
}
