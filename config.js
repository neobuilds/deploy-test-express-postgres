const invalid = () => new Error('Invalid database configuration. Check DATABASE_URL or DB_* settings.');

export function portNumber(value, fallback) {
  const text = String(value ?? fallback);
  if (!/^\d+$/.test(text) || Number(text) < 1 || Number(text) > 65535) {
    throw new Error('Invalid port configuration.');
  }
  return Number(text);
}

export function databaseConfig(env = process.env) {
  let config;
  try {
    if (env.DATABASE_URL) {
      const url = new URL(env.DATABASE_URL);
      if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw invalid();
      config = {
        host: url.hostname.replace(/^\[|\]$/g, ''), port: portNumber(url.port || '5432'),
        database: decodeURIComponent(url.pathname.slice(1)),
        user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
      };
    } else {
      config = {
        host: env.DB_HOST || '127.0.0.1', port: portNumber(env.DB_PORT || '5432'),
        database: env.DB_DATABASE, user: env.DB_USERNAME, password: env.DB_PASSWORD,
      };
    }
    if (!config.host || !config.database || !config.user || typeof config.password !== 'string') throw invalid();
  } catch {
    throw invalid(); // URL parser errors may contain the original credentials.
  }
  // Explicit fields prevent URL query options or PGSSLMODE from enabling SSL.
  return { ...config, ssl: false, connectionTimeoutMillis: 3000, query_timeout: 5000, max: 5 };
}

export function redactedConfig(config) {
  return { host: config.host, port: config.port, database: config.database, user: config.user, ssl: false };
}
