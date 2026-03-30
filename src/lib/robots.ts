import robotsParser from 'robots-parser';
import type Redis from 'ioredis';

import { config } from '../config';
import { robotsCacheKey, robotsLockKey } from './keys';
import { sleep } from './time';

type RobotsInstance = {
  isAllowed: (url: string, userAgent?: string) => boolean | undefined;
  getCrawlDelay: (userAgent?: string) => number | undefined;
};

interface RobotsPolicy {
  parser: RobotsInstance;
  crawlDelayMs: number;
  expiresAt: number;
}

const memoryCache = new Map<string, RobotsPolicy>();

export class RobotsService {
  constructor(private readonly redis: Redis) {}

  private async fetchRobotsText(origin: string): Promise<string> {
    const robotsUrl = new URL('/robots.txt', origin).toString();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.min(config.fetchTimeoutMs, 5000));

    try {
      const response = await fetch(robotsUrl, {
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          accept: 'text/plain,*/*;q=0.8',
          'user-agent': config.userAgent
        }
      });

      if (response.status === 200) {
        return await response.text();
      }

      return '';
    } catch {
      return '';
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildPolicy(origin: string, rawText: string): RobotsPolicy {
    const parser = robotsParser(new URL('/robots.txt', origin).toString(), rawText) as RobotsInstance;
    const crawlDelaySeconds = parser.getCrawlDelay(config.userAgent) ?? 0;
    const crawlDelayMs = Math.max(
      config.defaultPolitenessMs,
      Math.round(crawlDelaySeconds * 1000)
    );

    return {
      parser,
      crawlDelayMs,
      expiresAt: Date.now() + Math.min(config.robotsTtlSeconds * 1000, 5 * 60 * 1000)
    };
  }

  private async waitForCache(origin: string): Promise<RobotsPolicy | null> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const cached = await this.redis.get(robotsCacheKey(origin));
      if (cached !== null) {
        return this.buildPolicy(origin, cached);
      }

      await sleep(150 + attempt * 50);
    }

    return null;
  }

  async getPolicy(origin: string): Promise<RobotsPolicy> {
    const cached = memoryCache.get(origin);
    if (cached && cached.expiresAt > Date.now()) {
      return cached;
    }

    const redisCached = await this.redis.get(robotsCacheKey(origin));
    if (redisCached !== null) {
      const policy = this.buildPolicy(origin, redisCached);
      memoryCache.set(origin, policy);
      return policy;
    }

    const lockKey = robotsLockKey(origin);
    const lockToken = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const locked = await this.redis.set(lockKey, lockToken, 'PX', 10_000, 'NX');

    if (!locked) {
      const waited = await this.waitForCache(origin);
      if (waited) {
        memoryCache.set(origin, waited);
        return waited;
      }
    }

    try {
      const rawText = await this.fetchRobotsText(origin);
      await this.redis.set(robotsCacheKey(origin), rawText, 'EX', config.robotsTtlSeconds);

      const policy = this.buildPolicy(origin, rawText);
      memoryCache.set(origin, policy);
      return policy;
    } finally {
      const currentLock = await this.redis.get(lockKey);
      if (currentLock === lockToken) {
        await this.redis.del(lockKey);
      }
    }
  }

  async isAllowed(url: string): Promise<{ allowed: boolean; crawlDelayMs: number }> {
    const origin = new URL(url).origin;
    const policy = await this.getPolicy(origin);
    const allowed = policy.parser.isAllowed(url, config.userAgent);
    return {
      allowed: allowed !== false,
      crawlDelayMs: policy.crawlDelayMs
    };
  }
}
