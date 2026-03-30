import IORedis from 'ioredis';

import { config } from './config';

type Mode = 'app' | 'worker';

const clients = new Map<Mode, IORedis>();

export function getRedisClient(mode: Mode): IORedis {
  const existing = clients.get(mode);
  if (existing) {
    return existing;
  }

  const client = new IORedis(config.redisUrl, {
    enableReadyCheck: true,
    maxRetriesPerRequest: mode === 'worker' ? null : 1
  });

  clients.set(mode, client);
  return client;
}

export async function closeRedisClients(): Promise<void> {
  const entries = [...clients.values()];
  clients.clear();

  await Promise.all(
    entries.map(async (client) => {
      try {
        await client.quit();
      } catch {
        client.disconnect();
      }
    })
  );
}
