export function canonicalHost(urlOrHost: string): string {
  const host = urlOrHost.includes('://')
    ? new URL(urlOrHost).hostname
    : urlOrHost;

  const normalized = host.toLowerCase();
  return normalized.startsWith('www.') ? normalized.slice(4) : normalized;
}

export function isSameSite(candidateUrl: string, rootHost: string): boolean {
  return canonicalHost(candidateUrl) === canonicalHost(rootHost);
}
