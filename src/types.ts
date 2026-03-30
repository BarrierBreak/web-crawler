export type CrawlStatus = 'queued' | 'running' | 'completed';

export type CrawlResultStatus = 'success' | 'failed' | 'blocked';

export interface CrawlRequestBody {
  url: string;
  depth: number;
  allowExternal?: boolean;
}

export interface CrawlJobData {
  crawlId: string;
  url: string;
  depth: number;
  allowExternal: boolean;
  rootOrigin: string;
  rootHost: string;
  parentUrl?: string | null;
}

export interface CrawlResult {
  jobId: string;
  url: string;
  normalizedUrl: string;
  finalUrl: string;
  depth: number;
  parentUrl?: string | null;
  status: CrawlResultStatus;
  statusCode?: number;
  contentType?: string;
  title?: string;
  description?: string;
  extractedLinks?: string[];
  error?: string;
  fetchedAt: string;
}

export interface CrawlSummary {
  jobId: string;
  status: CrawlStatus;
  rootUrl: string;
  rootOrigin: string;
  rootHost: string;
  allowExternal: boolean;
  maxDepth: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  updatedAt?: string;
  pending: number;
  processed: number;
  succeeded: number;
  failed: number;
  blocked: number;
  visited: number;
  finalized: number;
  results: number;
}
