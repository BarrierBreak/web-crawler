import { Queue } from 'bullmq';

import { config } from './config';

const queues = new Map<'app' | 'worker', Queue>();

function createConnection(mode: 'app' | 'worker') {
  return {
    url: config.redisUrl,
    maxRetriesPerRequest: mode === 'worker' ? null : 1
  };
}

export function getCrawlQueue(mode: 'app' | 'worker'): Queue {
  const existing = queues.get(mode);
  if (existing) {
    return existing;
  }

  const queue = new Queue(config.queueName, {
    connection: createConnection(mode) as any,
    defaultJobOptions: {
      attempts: config.jobAttempts,
      backoff: {
        type: 'exponential',
        delay: config.jobBackoffMs
      },
      removeOnComplete: true,
      removeOnFail: true
    }
  });

  queues.set(mode, queue);
  return queue;
}

export async function closeCrawlQueues(): Promise<void> {
  const current = [...queues.values()];
  queues.clear();
  await Promise.all(current.map((queue) => queue.close()));
}
