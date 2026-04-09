// src/utils/time.js
// ReferralBuddy — Date range helpers (Unix seconds throughout)

'use strict';

/**
 * Resolve a named or custom period into { from, to, label }.
 *
 * @param {'alltime'|'day'|'week'|'month'|'custom'} period
 * @param {string|null} customFrom  ISO date string  (YYYY-MM-DD)
 * @param {string|null} customTo    ISO date string  (YYYY-MM-DD), defaults to now
 * @returns {{ from: number, to: number, label: string } | null}
 */
function getPeriodRange(period, customFrom = null, customTo = null) {
  const now = Math.floor(Date.now() / 1000);

  switch (period) {
    case 'day':
      return { from: now - 86_400, to: now, label: 'Last 24 Hours' };

    case 'week':
      return { from: now - 7 * 86_400, to: now, label: 'Last 7 Days' };

    case 'month':
      return { from: now - 30 * 86_400, to: now, label: 'Last 30 Days' };

    case 'alltime':
      return { from: 0, to: now, label: 'All Time' };

    case 'custom': {
      if (!customFrom) return null;
      const from = Math.floor(new Date(customFrom + 'T00:00:00Z').getTime() / 1000);
      const to   = customTo
        ? Math.floor(new Date(customTo   + 'T23:59:59Z').getTime() / 1000)
        : now;
      if (isNaN(from) || isNaN(to)) return null;
      return {
        from,
        to,
        label: `${customFrom}  →  ${customTo ?? 'now'}`,
      };
    }

    default:
      return { from: 0, to: now, label: 'All Time' };
  }
}

/**
 * Format a Unix timestamp as a human-readable string.
 * @param {number} ts  Unix seconds
 */
function fmtTime(ts) {
  return new Date(ts * 1000).toUTCString();
}

module.exports = { getPeriodRange, fmtTime };
