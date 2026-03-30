function readInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }

  return value;
}

function readPositiveInt(name: string, fallback: number): number {
  const value = readInt(name, fallback);
  if (value <= 0) {
    throw new Error(`${name} must be greater than 0`);
  }

  return value;
}

export const config = {
  port: readPositiveInt('PORT', 3000),
  redisUrl: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
  queueName: process.env.QUEUE_NAME ?? 'crawl-jobs',
  workerConcurrency: readPositiveInt('WORKER_CONCURRENCY', 50),
  jobAttempts: readPositiveInt('JOB_ATTEMPTS', 3),
  jobBackoffMs: readPositiveInt('JOB_BACKOFF_MS', 1000),
  fetchTimeoutMs: readPositiveInt('FETCH_TIMEOUT_MS', 15_000),
  defaultPolitenessMs: readPositiveInt('DEFAULT_POLITENESS_MS', 1000),
  robotsTtlSeconds: readPositiveInt('ROBOTS_TTL_SECONDS', 24 * 60 * 60),
  crawlTtlSeconds: readPositiveInt('CRAWL_TTL_SECONDS', 24 * 60 * 60),
  maxCrawlDepth: readPositiveInt('MAX_CRAWL_DEPTH', 5),
  userAgent:
    process.env.USER_AGENT ?? 'StatelessCrawler/1.0 (+https://example.com/bot)'
};
