// Weekly-metering time helpers — CONTRACTS §7: "week starts Monday UTC" for `usage_weeks`.
//
// The durable column is `usage_weeks.week_start date`, so the canonical week identifier is a
// 'YYYY-MM-DD' string naming the Monday (UTC) that opens the week. Redis keys derive from the
// same string so the hot counter and the Postgres row agree on which week a word lands in.

/**
 * The Monday-UTC that opens the ISO week containing `now`, formatted 'YYYY-MM-DD'.
 *
 * Bucketing is purely by UTC calendar day (host timezone never participates), so the Sunday→Monday
 * rollover happens exactly at 00:00:00 UTC — the boundary the metering contract requires.
 */
export function weekStartMondayUtc(now: Date): string {
  // Collapse to UTC midnight of the input's calendar day.
  const midnight = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  // getUTCDay(): 0=Sun … 6=Sat. Days since Monday = (day + 6) % 7 (Mon→0 … Sun→6).
  const daysSinceMonday = (midnight.getUTCDay() + 6) % 7;
  midnight.setUTCDate(midnight.getUTCDate() - daysSinceMonday);
  return midnight.toISOString().slice(0, 10);
}
