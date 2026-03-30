import { Router } from 'express';
import type { Queue } from 'bullmq';

import { createCrawlController } from '../controllers/crawl.controller';
import type { CrawlStore } from '../repositories/crawl.repository';

export function createCrawlRoutes(deps: { store: CrawlStore; queue: Queue }) {
  const router = Router();
  const controller = createCrawlController(deps);

  router.post('/crawl', controller.startCrawl);
  router.get('/crawl/:id', controller.getStatus);
  router.get('/results/:id', controller.getResults);

  return router;
}
