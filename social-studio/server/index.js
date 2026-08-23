import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { config, coreMissingConfig, coreConfigErrors } from './config.js';
import { migrate, bootstrapAdmin, bootstrapBrandProfile, pool } from './db.js';
import { optionalAuth } from './auth.js';
import routes from './routes.js';
import { errorHandler, notFound } from './http.js';

const missing = coreMissingConfig();
const configurationErrors = coreConfigErrors();
if (missing.length || configurationErrors.length) {
  console.error(`Invalid server configuration. Missing: ${missing.join(', ') || 'none'}; errors: ${configurationErrors.join(', ') || 'none'}`);
  process.exit(1);
}

await migrate();
await bootstrapAdmin();
await bootstrapBrandProfile();

const app = express();
if (config.trustProxy) app.set('trust proxy', config.trustProxy);
app.disable('x-powered-by');
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'same-site' },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      mediaSrc: ["'self'", 'blob:'],
      connectSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      fontSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"]
    }
  }
}));
app.use(compression());
app.use(cookieParser());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.use(optionalAuth);
app.use(routes);

const distPath = path.resolve('dist');
try {
  await fs.access(distPath);
  app.use(express.static(distPath, { index: false, maxAge: config.nodeEnv === 'production' ? '1h' : 0 }));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/') || req.path.startsWith('/public-media/')) return next();
    return res.sendFile(path.join(distPath, 'index.html'));
  });
} catch {
  app.get('/', (_req, res) => res.json({ name: 'HAAR Social Studio API', status: 'running' }));
}

app.use(notFound);
app.use(errorHandler);

const server = app.listen(config.port, '0.0.0.0', () => {
  console.log(`HAAR Social Studio listening on ${config.port}`);
});

async function shutdown(signal) {
  console.log(`${signal} received. Shutting down.`);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
