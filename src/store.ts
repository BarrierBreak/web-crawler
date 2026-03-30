import type Redis from 'ioredis';

import { config } from './config';
import {
  crawlFinalizedKey,
  crawlMetaKey,
  crawlResultsKey,
  crawlVisitedKey
} from './lib/keys';
import { nowIso } from './lib/time';
import type { CrawlJobData, CrawlResult, CrawlSummary } from './types';

const finalizeScript = `
local finalizedKey = KEYS[1]
local resultsKey = KEYS[2]
local metaKey = KEYS[3]
local visitedKey = KEYS[4]
local ttl = tonumber(ARGV[1])
local jobId = ARGV[2]
local resultJson = ARGV[3]
local resultStatus = ARGV[4]
local now = ARGV[5]

if redis.call("SADD", finalizedKey, jobId) == 0 then
  return {0, tonumber(redis.call("HGET", metaKey, "pending") or "0")}
end

redis.call("HSET", resultsKey, jobId, resultJson)
redis.call("HINCRBY", metaKey, "processed", 1)

if resultStatus == "success" then
  redis.call("HINCRBY", metaKey, "succeeded", 1)
elseif resultStatus == "failed" then
  redis.call("HINCRBY", metaKey, "failed", 1)
elseif resultStatus == "blocked" then
  redis.call("HINCRBY", metaKey, "blocked", 1)
end

local pending = redis.call("HINCRBY", metaKey, "pending", -1)
redis.call("HSET", metaKey, "updatedAt", now)

redis.call("EXPIRE", metaKey, ttl)
redis.call("EXPIRE", resultsKey, ttl)
redis.call("EXPIRE", visitedKey, ttl)
redis.call("EXPIRE", finalizedKey, ttl)

if pending <= 0 then
  redis.call("HSET", metaKey, "status", "completed", "completedAt", now)
end

return {1, pending}
`;

const claimScript = `
local visitedKey = KEYS[1]
local metaKey = KEYS[2]
local finalizedKey = KEYS[3]
local resultsKey = KEYS[4]
local ttl = tonumber(ARGV[1])
local url = ARGV[2]

local inserted = redis.call("SADD", visitedKey, url)
if inserted == 1 then
  redis.call("HINCRBY", metaKey, "pending", 1)
end

redis.call("EXPIRE", visitedKey, ttl)
redis.call("EXPIRE", metaKey, ttl)
redis.call("EXPIRE", finalizedKey, ttl)
redis.call("EXPIRE", resultsKey, ttl)

return inserted
`;

export class CrawlStore {
  constructor(private readonly redis: Redis) {}

  private metaKey(jobId: string): string {
    return crawlMetaKey(jobId);
  }

  private visitedKey(jobId: string): string {
    return crawlVisitedKey(jobId);
  }

  private finalizedKey(jobId: string): string {
    return crawlFinalizedKey(jobId);
  }

  private resultsKey(jobId: string): string {
    return crawlResultsKey(jobId);
  }

  async createSession(data: {
    jobId: string;
    rootUrl: string;
    rootOrigin: string;
    rootHost: string;
    allowExternal: boolean;
    maxDepth: number;
  }): Promise<void> {
    const now = nowIso();
    const metaKey = this.metaKey(data.jobId);
    const visitedKey = this.visitedKey(data.jobId);
    const finalizedKey = this.finalizedKey(data.jobId);
    const resultsKey = this.resultsKey(data.jobId);

    await this.redis.multi()
      .hset(metaKey, {
        jobId: data.jobId,
        status: 'queued',
        rootUrl: data.rootUrl,
        rootOrigin: data.rootOrigin,
        rootHost: data.rootHost,
        allowExternal: data.allowExternal ? '1' : '0',
        maxDepth: String(data.maxDepth),
        createdAt: now,
        updatedAt: now,
        pending: '1',
        processed: '0',
        succeeded: '0',
        failed: '0',
        blocked: '0'
      })
      .sadd(visitedKey, data.rootUrl)
      .expire(metaKey, config.crawlTtlSeconds)
      .expire(visitedKey, config.crawlTtlSeconds)
      .expire(finalizedKey, config.crawlTtlSeconds)
      .expire(resultsKey, config.crawlTtlSeconds)
      .exec();
  }

  async markRunning(jobId: string): Promise<void> {
    const metaKey = this.metaKey(jobId);
    const now = nowIso();

    await this.redis
      .multi()
      .hset(metaKey, {
        status: 'running',
        updatedAt: now
      })
      .hsetnx(metaKey, 'startedAt', now)
      .expire(metaKey, config.crawlTtlSeconds)
      .exec();
  }

  async touch(jobId: string): Promise<void> {
    await this.redis
      .multi()
      .expire(this.metaKey(jobId), config.crawlTtlSeconds)
      .expire(this.visitedKey(jobId), config.crawlTtlSeconds)
      .expire(this.finalizedKey(jobId), config.crawlTtlSeconds)
      .expire(this.resultsKey(jobId), config.crawlTtlSeconds)
      .exec();
  }

  async addVisited(jobId: string, url: string): Promise<boolean> {
    const added = await this.redis.sadd(this.visitedKey(jobId), url);
    await this.touch(jobId);
    return added === 1;
  }

  async claimScheduled(jobId: string, url: string): Promise<boolean> {
    const inserted = Number(await this.redis.eval(
      claimScript,
      4,
      this.visitedKey(jobId),
      this.metaKey(jobId),
      this.finalizedKey(jobId),
      this.resultsKey(jobId),
      config.crawlTtlSeconds,
      url
    ));

    return inserted === 1;
  }

  async removeVisited(jobId: string, url: string): Promise<void> {
    await this.redis.srem(this.visitedKey(jobId), url);
    await this.touch(jobId);
  }

  async incrementPending(jobId: string, delta = 1): Promise<number> {
    const pending = await this.redis.hincrby(this.metaKey(jobId), 'pending', delta);
    await this.touch(jobId);
    return pending;
  }

  async isFinalized(jobId: string, resultId: string): Promise<boolean> {
    const finalized = await this.redis.sismember(this.finalizedKey(jobId), resultId);
    return finalized === 1;
  }

  async finalizeResult(
    jobId: string,
    resultId: string,
    result: CrawlResult
  ): Promise<{ finalized: boolean; pending: number }> {
    const response = (await this.redis.eval(
      finalizeScript,
      4,
      this.finalizedKey(jobId),
      this.resultsKey(jobId),
      this.metaKey(jobId),
      this.visitedKey(jobId),
      config.crawlTtlSeconds,
      resultId,
      JSON.stringify(result),
      result.status,
      nowIso()
    )) as [number | string, number | string];

    return {
      finalized: Number(response[0]) === 1,
      pending: Number(response[1])
    };
  }

  async getSummary(jobId: string): Promise<CrawlSummary | null> {
    const meta = await this.redis.hgetall(this.metaKey(jobId));
    if (!meta.jobId) {
      return null;
    }

    const [visited, finalized, results] = await Promise.all([
      this.redis.scard(this.visitedKey(jobId)),
      this.redis.scard(this.finalizedKey(jobId)),
      this.redis.hlen(this.resultsKey(jobId))
    ]);

    return {
      jobId: meta.jobId,
      status: (meta.status as CrawlSummary['status']) ?? 'queued',
      rootUrl: meta.rootUrl,
      rootOrigin: meta.rootOrigin,
      rootHost: meta.rootHost,
      allowExternal: meta.allowExternal === '1',
      maxDepth: Number(meta.maxDepth ?? 0),
      createdAt: meta.createdAt,
      startedAt: meta.startedAt || undefined,
      completedAt: meta.completedAt || undefined,
      updatedAt: meta.updatedAt || undefined,
      pending: Number(meta.pending ?? 0),
      processed: Number(meta.processed ?? 0),
      succeeded: Number(meta.succeeded ?? 0),
      failed: Number(meta.failed ?? 0),
      blocked: Number(meta.blocked ?? 0),
      visited,
      finalized,
      results
    };
  }

  async getResults(jobId: string): Promise<CrawlResult[]> {
    const values = await this.redis.hvals(this.resultsKey(jobId));
    const results = values
      .map((value) => {
        try {
          return JSON.parse(value) as CrawlResult;
        } catch {
          return null;
        }
      })
      .filter((value): value is CrawlResult => Boolean(value));

    return results.sort((left, right) => {
      const leftTime = Date.parse(left.fetchedAt);
      const rightTime = Date.parse(right.fetchedAt);
      if (leftTime !== rightTime) {
        return leftTime - rightTime;
      }
      return left.url.localeCompare(right.url);
    });
  }
}

export function createRootResult(
  data: CrawlJobData,
  overrides: Partial<CrawlResult>
): CrawlResult {
  return {
    jobId: overrides.jobId ?? '',
    url: overrides.url ?? data.url,
    normalizedUrl: overrides.normalizedUrl ?? data.url,
    finalUrl: overrides.finalUrl ?? data.url,
    depth: overrides.depth ?? data.depth,
    parentUrl: overrides.parentUrl ?? data.parentUrl ?? null,
    status: overrides.status ?? 'success',
    statusCode: overrides.statusCode,
    contentType: overrides.contentType,
    title: overrides.title,
    description: overrides.description,
    extractedLinks: overrides.extractedLinks,
    error: overrides.error,
    fetchedAt: overrides.fetchedAt ?? nowIso()
  };
}
