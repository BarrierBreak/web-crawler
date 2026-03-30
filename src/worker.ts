import { Worker } from 'bullmq';

import { config } from './config';
import { createCrawlerProcessor, createFailedListener } from './crawler';
import { getRedisClient, closeRedisClients } from './redis';
import { getCrawlQueue, closeCrawlQueues } from './queue';
import { CrawlStore } from './store';
import { PolitenessService } from './lib/politeness';
import { RobotsService } from './lib/robots';

const store = new CrawlStore(getRedisClient('worker'));
const queue = getCrawlQueue('worker');
const robots = new RobotsService(getRedisClient('worker'));
const politeness = new PolitenessService(getRedisClient('worker'));

const worker = new Worker(
  config.queueName,
  createCrawlerProcessor({
    store,
    queue,
    robots,
    politeness
  }),
  {
    connection: {
      url: config.redisUrl,
      maxRetriesPerRequest: null
    } as any,
    concurrency: config.workerConcurrency,
    lockDuration: 120_000
  }
);

worker.on(
  'failed',
  createFailedListener({
    store,
    queue,
    robots,
    politeness
  })
);

worker.on('error', (error) => {
  // eslint-disable-next-line no-console
  console.error('Worker error:', error);
});

worker.on('completed', (job) => {
  // eslint-disable-next-line no-console
  console.log(`Completed crawl job ${job.id}`);
});

// eslint-disable-next-line no-console
console.log(`Worker listening on queue ${config.queueName} with concurrency ${config.workerConcurrency}`);

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  // eslint-disable-next-line no-console
  console.log(`Received ${signal}, shutting down worker...`);

  await worker.close();
  await closeCrawlQueues();
  await closeRedisClients();
}

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});
