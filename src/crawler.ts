import { Job, UnrecoverableError, Queue } from 'bullmq';

import { config } from './config';
import { isSameSite } from './lib/domain';
import { crawlJobId } from './lib/keys';
import { extractPageData } from './lib/html';
import { fetchPage } from './lib/fetch';
import { isRetryableStatus, parseRetryAfterMs } from './lib/http';
import { normalizeUrl } from './lib/normalizeUrl';
import { PolitenessService } from './lib/politeness';
import { RobotsService } from './lib/robots';
import { nowIso } from './lib/time';
import { CrawlStore, createRootResult } from './store';
import type { CrawlJobData, CrawlResult } from './types';

interface CrawlerDependencies {
  store: CrawlStore;
  queue: Queue;
  robots: RobotsService;
  politeness: PolitenessService;
}

function buildSuccessResult(params: {
  job: Job<CrawlJobData>;
  finalUrl: string;
  statusCode: number;
  contentType: string;
  title?: string;
  description?: string;
  extractedLinks?: string[];
}): CrawlResult {
  const { job, finalUrl, statusCode, contentType, title, description, extractedLinks } = params;
  return {
    jobId: crawlJobId(job.data.crawlId, job.data.url),
    url: job.data.url,
    normalizedUrl: finalUrl,
    finalUrl,
    depth: job.data.depth,
    parentUrl: job.data.parentUrl ?? null,
    status: 'success',
    statusCode,
    contentType,
    title,
    description,
    extractedLinks,
    fetchedAt: nowIso()
  };
}

function buildFailureResult(params: {
  job: Job<CrawlJobData>;
  message: string;
  statusCode?: number;
  finalUrl?: string;
}): CrawlResult {
  const { job, message, statusCode, finalUrl } = params;
  return {
    jobId: crawlJobId(job.data.crawlId, job.data.url),
    url: job.data.url,
    normalizedUrl: finalUrl ?? job.data.url,
    finalUrl: finalUrl ?? job.data.url,
    depth: job.data.depth,
    parentUrl: job.data.parentUrl ?? null,
    status: 'failed',
    statusCode,
    error: message,
    fetchedAt: nowIso()
  };
}

function buildBlockedResult(params: {
  job: Job<CrawlJobData>;
  message: string;
}): CrawlResult {
  const { job, message } = params;
  return {
    jobId: crawlJobId(job.data.crawlId, job.data.url),
    url: job.data.url,
    normalizedUrl: job.data.url,
    finalUrl: job.data.url,
    depth: job.data.depth,
    parentUrl: job.data.parentUrl ?? null,
    status: 'blocked',
    error: message,
    fetchedAt: nowIso()
  };
}

async function finalizeOnce(
  deps: CrawlerDependencies,
  job: Job<CrawlJobData>,
  result: CrawlResult
): Promise<void> {
  const resultId = result.jobId;
  const { finalized, pending } = await deps.store.finalizeResult(job.data.crawlId, resultId, result);

  if (finalized && pending <= 0) {
    return;
  }
}

async function enqueueDiscoveredUrl(
  deps: CrawlerDependencies,
  job: Job<CrawlJobData>,
  childUrl: string
): Promise<void> {
  const normalized = normalizeUrl(childUrl, job.data.url);
  if (!normalized) {
    return;
  }

  if (!job.data.allowExternal && !isSameSite(normalized, job.data.rootHost)) {
    return;
  }

  try {
    await deps.queue.add(
      'crawl-url',
      {
        crawlId: job.data.crawlId,
        url: normalized,
        depth: Math.max(0, job.data.depth - 1),
        allowExternal: job.data.allowExternal,
        rootOrigin: job.data.rootOrigin,
        rootHost: job.data.rootHost,
        parentUrl: job.data.url
      },
      {
        jobId: crawlJobId(job.data.crawlId, normalized)
      }
    );

    await deps.store.claimScheduled(job.data.crawlId, normalized);
  } catch (error) {
    throw error;
  }
}

export function createCrawlerProcessor(deps: CrawlerDependencies) {
  return async function processJob(job: Job<CrawlJobData>): Promise<void> {
    const resultId = crawlJobId(job.data.crawlId, job.data.url);

    if (await deps.store.isFinalized(job.data.crawlId, resultId)) {
      return;
    }

    await deps.store.claimScheduled(job.data.crawlId, job.data.url);
    await deps.store.markRunning(job.data.crawlId);

    const origin = new URL(job.data.url).origin;
    const robots = await deps.robots.getPolicy(origin);
    const allowed = robots.parser.isAllowed(job.data.url, config.userAgent);

    if (allowed === false) {
      await finalizeOnce(
        deps,
        job,
        buildBlockedResult({
          job,
          message: 'Disallowed by robots.txt'
        })
      );
      return;
    }

    await deps.politeness.waitForSlot(origin, robots.crawlDelayMs);

    const page = await fetchPage(job.data.url);

    if (isRetryableStatus(page.statusCode)) {
      const retryAfter = parseRetryAfterMs(page.response.headers.get('retry-after'));
      if (retryAfter !== null) {
        await deps.politeness.extendCooldown(origin, retryAfter);
      }

      throw new Error(`Retryable HTTP ${page.statusCode} for ${job.data.url}`);
    }

    if (page.statusCode >= 400) {
      await finalizeOnce(
        deps,
        job,
        buildFailureResult({
          job,
          message: `HTTP ${page.statusCode}`,
          statusCode: page.statusCode,
          finalUrl: page.finalUrl
        })
      );
      return;
    }

    const parsed =
      page.contentType.toLowerCase().includes('html') && page.body
        ? extractPageData(page.body, page.finalUrl)
        : { title: undefined, description: undefined, links: [] as string[] };

    if (job.data.depth > 0) {
      for (const link of parsed.links) {
        await enqueueDiscoveredUrl(deps, job, link);
      }
    }

    await finalizeOnce(
      deps,
      job,
      buildSuccessResult({
        job,
        finalUrl: page.finalUrl,
        statusCode: page.statusCode,
        contentType: page.contentType,
        title: parsed.title,
        description: parsed.description,
        extractedLinks: parsed.links
      })
    );
  };
}

export function createFailedListener(deps: CrawlerDependencies) {
  return async (job: Job<CrawlJobData> | undefined, error: Error): Promise<void> => {
    if (!job) {
      return;
    }

    const attempts = job.opts.attempts ?? 1;
    const finalFailure =
      error instanceof UnrecoverableError || job.attemptsMade >= attempts;

    if (!finalFailure) {
      return;
    }

    const result = buildFailureResult({
      job,
      message: error.message
    });

    await finalizeOnce(deps, job, result);
  };
}

export function createRootFailureResult(
  data: CrawlJobData,
  message: string
): CrawlResult {
  return createRootResult(data, {
    jobId: crawlJobId(data.crawlId, data.url),
    status: 'failed',
    error: message,
    fetchedAt: nowIso()
  });
}
