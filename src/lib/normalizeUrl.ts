const TRACKING_PARAMS = new Set([
  'fbclid',
  'gclid',
  'igshid',
  'mc_cid',
  'mc_eid',
  'ref',
  'ref_src',
  'utm_campaign',
  'utm_content',
  'utm_medium',
  'utm_source',
  'utm_term',
  'yclid'
]);

export function normalizeUrl(rawUrl: string, baseUrl?: string): string | null {
  try {
    const url = baseUrl ? new URL(rawUrl, baseUrl) : new URL(rawUrl);

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }

    url.hash = '';
    url.hostname = url.hostname.toLowerCase();

    if (
      (url.protocol === 'http:' && url.port === '80') ||
      (url.protocol === 'https:' && url.port === '443')
    ) {
      url.port = '';
    }

    url.pathname = url.pathname.replace(/\/{2,}/g, '/');
    if (!url.pathname) {
      url.pathname = '/';
    }

    if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
      url.pathname = url.pathname.replace(/\/+$/, '');
    }

    const params = new URLSearchParams();
    const entries = Array.from(url.searchParams.entries())
      .filter(([key]) => !TRACKING_PARAMS.has(key.toLowerCase()))
      .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
        const keyCompare = leftKey.localeCompare(rightKey);
        return keyCompare !== 0 ? keyCompare : leftValue.localeCompare(rightValue);
      });

    for (const [key, value] of entries) {
      params.append(key, value);
    }

    const query = params.toString();
    url.search = query ? `?${query}` : '';

    return url.toString();
  } catch {
    return null;
  }
}
