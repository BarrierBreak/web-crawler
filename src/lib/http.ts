export function isRetryableStatus(statusCode: number): boolean {
  return (
    statusCode === 408 ||
    statusCode === 425 ||
    statusCode === 429 ||
    (statusCode >= 500 && statusCode <= 599)
  );
}

export function parseRetryAfterMs(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, Math.round(seconds * 1000));
  }

  const target = Date.parse(value);
  if (!Number.isFinite(target)) {
    return null;
  }

  return Math.max(0, target - Date.now());
}
