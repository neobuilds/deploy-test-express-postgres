import test from 'node:test';
import assert from 'node:assert/strict';
import { databaseConfig, redactedConfig, portNumber } from '../config.js';

const fallback = { DB_DATABASE: 'notes_demo', DB_USERNAME: 'notes_demo', DB_PASSWORD: 'test-only' };
test('DATABASE_URL takes precedence and decodes credentials', () => {
  const config = databaseConfig({ ...fallback,
    DATABASE_URL: 'postgresql://url_user:p%40ss%3Aword@127.0.0.1:5544/url_db?sslmode=require' });
  assert.equal(config.user, 'url_user');
  assert.equal(config.password, 'p@ss:word');
  assert.equal(config.database, 'url_db');
  assert.equal(config.port, 5544);
  assert.equal(config.ssl, false);
  assert.equal(config.connectionString, undefined);
});
test('DB_* fallback and default local host/port', () => {
  const config = databaseConfig(fallback);
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 5432);
  assert.equal(config.password, 'test-only');
  assert.equal(config.ssl, false);
  assert.equal(config.database, 'notes_demo');
  assert.equal(config.user, 'notes_demo');
  assert.equal(databaseConfig({ ...fallback, DB_HOST: 'localhost' }).host, 'localhost');
  assert.equal(databaseConfig({ ...fallback, DB_HOST: 'localhost', DB_PORT: '5544' }).port, 5544);
});
test('postgres scheme and default URL port', () => {
  assert.equal(databaseConfig({ DATABASE_URL: 'postgres://demo:test-only@localhost/demo' }).port, 5432);
});
test('safe diagnostics omit passwords and full URLs, including unexpected fields', () => {
  const url = 'postgres://demo:test-only@localhost/demo';
  const safe = JSON.stringify(redactedConfig({ ...databaseConfig({ DATABASE_URL: url }), connectionString: url }));
  assert.ok(!safe.includes('test-only'));
  assert.ok(!safe.includes(url));
  assert.ok(!safe.includes('password'));
});
test('invalid or incomplete config errors never echo supplied credentials', () => {
  for (const env of [{ DATABASE_URL: 'test-only-broken-url' }, { DATABASE_URL: 'http://u:test-only@localhost/db' },
    { DATABASE_URL: 'postgres://u:test-only@localhost:99999/db' },
    { DATABASE_URL: 'postgres://u:test-only@localhost' },
    { DATABASE_URL: 'postgres://:test-only@localhost/db' },
    { DATABASE_URL: 'postgres://u:%ZZ@localhost/db' },
    { ...fallback, DB_PORT: 'test-only' }, {}]) {
    assert.throws(() => databaseConfig(env), (error) => {
      assert.equal(error.message, 'Invalid database configuration. Check DATABASE_URL or DB_* settings.');
      assert.ok(!error.message.includes('test-only'));
      return true;
    });
  }
});
test('HTTP port defaults and validation', () => {
  assert.equal(portNumber(undefined, 3000), 3000);
  for (const port of ['0', '-1', '65536', '12garbage', '']) assert.throws(() => portNumber(port));
});
