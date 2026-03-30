import { createHash } from 'crypto';

export function sha1(value: string): string {
  return createHash('sha1').update(value).digest('hex');
}

export function crawlMetaKey(jobId: string): string {
  return `crawl:${jobId}:meta`;
}

export function crawlVisitedKey(jobId: string): string {
  return `crawl:${jobId}:visited`;
}

export function crawlFinalizedKey(jobId: string): string {
  return `crawl:${jobId}:finalized`;
}

export function crawlResultsKey(jobId: string): string {
  return `crawl:${jobId}:results`;
}

export function robotsCacheKey(origin: string): string {
  return `crawl:robots:${encodeURIComponent(origin)}`;
}

export function robotsLockKey(origin: string): string {
  return `crawl:robots-lock:${encodeURIComponent(origin)}`;
}

export function domainCooldownKey(origin: string): string {
  return `crawl:domain:${encodeURIComponent(origin)}:next-at`;
}

export function crawlJobId(crawlId: string, normalizedUrl: string): string {
  return `${crawlId}-${sha1(normalizedUrl).slice(0, 16)}`;
}
