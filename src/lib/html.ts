import * as cheerio from 'cheerio';

import { normalizeUrl } from './normalizeUrl';

function firstDefined(values: Array<string | undefined>): string | undefined {
  return values.map((value) => value?.trim()).find((value) => Boolean(value));
}

function shouldSkipHref(href: string): boolean {
  const trimmed = href.trim().toLowerCase();
  return (
    !trimmed ||
    trimmed.startsWith('#') ||
    trimmed.startsWith('javascript:') ||
    trimmed.startsWith('mailto:') ||
    trimmed.startsWith('tel:') ||
    trimmed.startsWith('sms:')
  );
}

export interface ParsedPage {
  title?: string;
  description?: string;
  links: string[];
}

export function extractPageData(html: string, baseUrl: string): ParsedPage {
  const $ = cheerio.load(html);
  const baseHref = $('base[href]').first().attr('href');
  const resolutionBase = baseHref
    ? normalizeUrl(baseHref, baseUrl) ?? baseUrl
    : baseUrl;

  const title = $('title').first().text().trim() || undefined;
  const description = firstDefined([
    $('meta[name="description"]').first().attr('content'),
    $('meta[property="og:description"]').first().attr('content'),
    $('meta[name="twitter:description"]').first().attr('content')
  ]);

  const links = new Set<string>();
  $('a[href], area[href]').each((_, element) => {
    const href = $(element).attr('href');
    if (!href || shouldSkipHref(href)) {
      return;
    }

    const normalized = normalizeUrl(href, resolutionBase);
    if (normalized) {
      links.add(normalized);
    }
  });

  return {
    title,
    description,
    links: [...links]
  };
}
