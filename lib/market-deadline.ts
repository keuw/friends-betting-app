const DEFAULT_MARKET_CLOSE_MONTHS = 3;

export function defaultMarketCloseDate(
  now = new Date(),
  minimumClose?: Date,
): Date {
  const candidate = new Date(now.getTime());
  const originalDay = candidate.getDate();

  candidate.setDate(1);
  candidate.setMonth(candidate.getMonth() + DEFAULT_MARKET_CLOSE_MONTHS);

  const lastDayOfTargetMonth = new Date(
    candidate.getFullYear(),
    candidate.getMonth() + 1,
    0,
  ).getDate();
  candidate.setDate(Math.min(originalDay, lastDayOfTargetMonth));

  if (
    minimumClose &&
    Number.isFinite(minimumClose.getTime()) &&
    minimumClose.getTime() > candidate.getTime()
  ) {
    return new Date(minimumClose.getTime());
  }

  return candidate;
}
