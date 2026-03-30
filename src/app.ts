import express, { type ErrorRequestHandler } from 'express';
import type { Queue } from 'bullmq';
import type Redis from 'ioredis';

import { createCrawlRoutes } from './routes/crawl.routes';
import type { CrawlStore } from './repositories/crawl.repository';

export interface AppDeps {
  store: CrawlStore;
  queue: Queue;
  redis: Redis;
}

export function createApp({ store, queue, redis }: AppDeps) {
  const app = express();

  app.use(express.json({ limit: '1mb' }));

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/readyz', async (_req, res, next) => {
    try {
      await redis.ping();
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.use(createCrawlRoutes({ store, queue }));

  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    const message = error instanceof Error ? error.message : 'Unexpected error';
    res.status(500).json({ error: message });
  };

  app.use(errorHandler);

  return app;
}
