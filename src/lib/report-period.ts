// Published period IDs are sorted as YYYY-A or YYYY-B, oldest first.
export function publishedPeriod(
  periods: readonly string[],
  year?: number,
  half?: string,
): string | undefined {
  for (let i = periods.length - 1; i >= 0; i--) {
    const period = periods[i]!;
    if (
      (year === undefined || period.slice(0, 4) === String(year)) &&
      (half === undefined || period.slice(-1) === half)
    ) return period;
  }
  return undefined;
}
