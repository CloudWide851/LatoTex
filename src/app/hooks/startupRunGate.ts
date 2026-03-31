export function shouldRunStartupForRetryToken(
  lastStartedRetryToken: number | null,
  retryToken: number,
): boolean {
  return lastStartedRetryToken !== retryToken;
}