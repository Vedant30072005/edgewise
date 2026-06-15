/** Shared analytics helpers — reused by stats and debrief routes. */

/**
 * Groups an array of trade rows by a field key, returning per-group
 * stats (trades, totalR, expectancy, winRate) sorted by expectancy desc.
 */
function groupByKey(trades, key) {
  const m = new Map();
  for (const t of trades) {
    const k = t[key];
    const s = m.get(k) || { trades: 0, totalR: 0, wins: 0 };
    s.trades += 1;
    s.totalR += t.r_multiple;
    if (t.r_multiple > 0) s.wins += 1;
    m.set(k, s);
  }
  return [...m.entries()]
    .map(([k, s]) => ({
      key: k,
      trades: s.trades,
      totalR: Math.round(s.totalR * 100) / 100,
      expectancy: Math.round((s.totalR / s.trades) * 100) / 100,
      winRate: Math.round((s.wins / s.trades) * 1000) / 10,
    }))
    .sort((a, b) => b.expectancy - a.expectancy);
}

module.exports = { groupByKey };
