import { config } from '../config';

export interface FetchedPage {
  response: Response;
  finalUrl: string;
  statusCode: number;
  contentType: string;
  body: string;
}

export async function fetchPage(url: string): Promise<FetchedPage> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.fetchTimeoutMs);

  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
        'user-agent': config.userAgent
      }
    });

    const contentType = response.headers.get('content-type') ?? '';
    const shouldReadBody =
      response.status < 400 &&
      contentType.toLowerCase().includes('html');

    const body = shouldReadBody ? await response.text() : '';

    return {
      response,
      finalUrl: response.url || url,
      statusCode: response.status,
      contentType,
      body
    };
  } finally {
    clearTimeout(timeout);
  }
}
