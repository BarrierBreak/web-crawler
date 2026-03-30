import { randomUUID } from 'crypto';
import type { Queue } from 'bullmq';
import type { Request, Response } from 'express';

import { config } from '../config';
import { canonicalHost } from '../lib/domain';
import { crawlJobId } from '../lib/keys';
import { normalizeUrl } from '../lib/normalizeUrl';
import { createRootFailureResult } from '../services/crawl.service';
import type { CrawlRequestBody } from '../models/crawl.model';
import type { CrawlStore } from '../repositories/crawl.repository';

export interface CrawlControllerDeps {
  store: CrawlStore;
  queue: Queue;
}

function parseBody(body: unknown): Partial<CrawlRequestBody> {
  return (body ?? {}) as Partial<CrawlRequestBody>;
}

export function createCrawlController({ store, queue }: CrawlControllerDeps) {
  async function startCrawl(req: Request, res: Response): Promise<void> {
    const body = parseBody(req.body);
    const rawUrl = body.url;
    const depth = body.depth;
    const allowExternal = body.allowExternal ?? false;

    if (typeof rawUrl !== 'string' || typeof depth !== 'number') {
      res.status(400).json({
        error: 'Request body must include url and depth'
      });
      return;
    }

    if (!Number.isInteger(depth) || depth < 0 || depth > config.maxCrawlDepth) {
      res.status(400).json({
        error: `depth must be an integer between 0 and ${config.maxCrawlDepth}`
      });
      return;
    }

    const normalized = normalizeUrl(rawUrl);
    if (!normalized) {
      res.status(400).json({
        error: 'url must be an absolute http(s) URL'
      });
      return;
    }

    const jobId = randomUUID();
    const rootHost = canonicalHost(normalized);
    const rootOrigin = new URL(normalized).origin;

    await store.createSession({
      jobId,
      rootUrl: normalized,
      rootOrigin,
      rootHost,
      allowExternal,
      maxDepth: depth
    });

    try {
      const rootJobId = crawlJobId(jobId, normalized);
      await queue.add(
        'crawl-url',
        {
          crawlId: jobId,
          url: normalized,
          depth,
          allowExternal,
          rootOrigin,
          rootHost,
          parentUrl: null
        },
        {
          jobId: rootJobId
        }
      );
    } catch (error) {
      const result = createRootFailureResult(
        {
          crawlId: jobId,
          url: normalized,
          depth,
          allowExternal,
          rootOrigin,
          rootHost,
          parentUrl: null
        },
        `Failed to enqueue crawl job: ${(error as Error).message}`
      );

      await store.finalizeResult(jobId, result.jobId, result);
      res.status(503).json({
        error: 'Redis queue is temporarily unavailable',
        jobId
      });
      return;
    }

    res.status(202).json({
      jobId,
      statusUrl: `/crawl/${jobId}`,
      resultsUrl: `/results/${jobId}`
    });
  }

  async function getStatus(req: Request, res: Response): Promise<void> {
    const summary = await store.getSummary(req.params.id);
    if (!summary) {
      res.status(404).json({ error: 'Crawl job not found' });
      return;
    }

    res.json(summary);
  }

  async function getResults(req: Request, res: Response): Promise<void> {
    const summary = await store.getSummary(req.params.id);
    if (!summary) {
      res.status(404).json({ error: 'Crawl job not found' });
      return;
    }

    const results = await store.getResults(req.params.id);
    res.json({
      summary,
      results
    });
  }

  return {
    getResults,
    getStatus,
    startCrawl
  };
}
