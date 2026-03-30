import { config } from './config';
import { createApp } from './app';
import { getCrawlQueue, closeCrawlQueues } from './queue';
import { getRedisClient, closeRedisClients } from './redis';
import { CrawlStore } from './repositories/crawl.repository';

const redis = getRedisClient('app');
const store = new CrawlStore(redis);
const queue = getCrawlQueue('app');
const app = createApp({ store, queue, redis });

const server = app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`API listening on port ${config.port}`);
});

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  // eslint-disable-next-line no-console
  console.log(`Received ${signal}, shutting down API...`);

  await new Promise<void>((resolve) => server.close(() => resolve()));
  await closeCrawlQueues();
  await closeRedisClients();
}

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});
