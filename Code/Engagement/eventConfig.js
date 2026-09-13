/**
 * eventConfig.js — which MM2 event is running, and what belongs to it.
 *
 * 📅 2026-09-13. MM2 runs seasonal events back to back from July to February,
 * and each one drops ~40 new items whose values then move every day while the
 * community works out what they are worth. That daily movement is the reason
 * to open the app during an event; the rest of the year the values list barely
 * changes.
 *
 * ── Why this is config and not a hardcoded Halloween screen ────────────────
 *
 * The dates move. Halloween has started Oct 17, Oct 16 and Oct 18 in the last
 * three years; Christmas has run Dec 20, Dec 20 and Dec 14; Summer has drifted
 * from Jul 4 to Jul 23 across four years. Easter 2026 did not happen at all.
 * Hardcoding a date means an app release every year and a wrong countdown in
 * between.
 *
 * So each event carries a TYPICAL window used as a fallback, and the real
 * dates come from RTDB `/events` when they are known:
 *
 *   /events/halloween = { start: <ms>, end: <ms>, enabled: true }
 *
 * Set that when Nikilis announces, and every install picks it up without a
 * release. Leave it unset and the screen still works off the estimate, saying
 * "around" rather than pretending to a precision it does not have.
 *
 * ── Matching items to an event ────────────────────────────────────────────
 *
 * Supreme tags `origin` on 92% of items ("Halloween 2025 (Tier 24)"), so an
 * event's items are just a filter on a field already in the feed. Counts
 * today: Christmas 406, Halloween 355, Summer 102, Easter 50, Valentine's 36,
 * Thanksgiving 10.
 */

// Estimated windows, from the last four years of observed start dates. These
// are FALLBACKS — a remote override always wins. `month` is 0-indexed.
export const EVENTS = [
  {
    id: 'halloween',
    label: 'Halloween',
    emoji: '🎃',
    // Oct 17 '23, Oct 16 '24, Oct 18 '25 — the most stable of the three majors.
    month: 9, day: 17, durationDays: 35,
    match: /halloween/i,
  },
  {
    id: 'thanksgiving',
    label: 'Thanksgiving',
    emoji: '🦃',
    // Nov 21 both years it ran. A minor event; only 10 items carry the tag.
    month: 10, day: 21, durationDays: 25,
    match: /thanksgiving/i,
  },
  {
    id: 'christmas',
    label: 'Christmas',
    emoji: '🎄',
    // Dec 20 '23, Dec 20 '24, Dec 14 '25. The biggest item drop of the year.
    month: 11, day: 17, durationDays: 40,
    match: /christmas/i,
  },
  {
    id: 'valentines',
    label: "Valentine's",
    emoji: '💘',
    // Feb 13 '26. Minor.
    month: 1, day: 13, durationDays: 30,
    match: /valentine/i,
  },
  {
    id: 'easter',
    label: 'Easter',
    emoji: '🐰',
    // Apr 1 '23, Apr 1 '24, Apr 18 '25 — and SKIPPED entirely in 2026. Treat a
    // missing Easter as normal rather than as a bug.
    month: 3, day: 5, durationDays: 35,
    match: /easter/i,
  },
  {
    id: 'summer',
    label: 'Summer',
    emoji: '🏖️',
    // Jul 4 '23, Jul 5 '24, Jul 18 '25, Jul 23 '26 — drifting later each year,
    // so this estimate is the weakest of the set.
    month: 6, day: 15, durationDays: 45,
    match: /summer/i,
  },
];

const DAY_MS = 24 * 60 * 60 * 1000;

/** Estimated window for an event in a given year, as {start, end} ms. */
const estimatedWindow = (event, year) => {
  const start = new Date(year, event.month, event.day, 12, 0, 0).getTime();
  return { start, end: start + event.durationDays * DAY_MS, estimated: true };
};

/**
 * The window to use: a remote override if one is set and enabled, otherwise
 * the estimate for whichever year is relevant.
 *
 * A remote entry with `enabled: false` suppresses the event entirely — that is
 * how you handle a year like Easter 2026, which simply did not run.
 */
/**
 * Build the event list: the local defaults, overlaid with anything the backend
 * defines — INCLUDING events this build has never heard of.
 *
 * That is the point. When MM2 runs something new, or renames a tag, you add it
 * under /events and every install picks it up on the next launch. No release,
 * no store review, no waiting for users to update. The items themselves need
 * nothing at all: the scraper tags them with `origin`, they land in the pool,
 * and the filter finds them.
 *
 *   /events/blackfriday = {
 *     label: "Black Friday",  emoji: "🛍️",
 *     match: "black ?friday",        // matched against each item's origin
 *     start: 1764547200000, end: 1765152000000,
 *     enabled: true
 *   }
 *
 * A bad regex from the backend must not take the screen down, so each pattern
 * is compiled defensively and a broken one drops that event rather than
 * throwing.
 */
export const mergeRemoteEvents = (remote) => {
  const byId = new Map(EVENTS.map((e) => [e.id, e]));

  if (remote && typeof remote === 'object') {
    for (const [id, cfg] of Object.entries(remote)) {
      if (!cfg || typeof cfg !== 'object') continue;
      const base = byId.get(id);

      let match = base?.match || null;
      if (typeof cfg.match === 'string' && cfg.match.trim()) {
        try {
          match = new RegExp(cfg.match, 'i');
        } catch (e) {
          // Malformed pattern from the backend: keep the local one if there is
          // one, otherwise skip this event entirely rather than crashing.
          if (!base) continue;
        }
      }
      if (!match) continue;

      byId.set(id, {
        ...(base || { month: 0, day: 1, durationDays: 30 }),
        id,
        label: cfg.label || base?.label || id,
        emoji: cfg.emoji || base?.emoji || '🎉',
        match,
      });
    }
  }

  return [...byId.values()];
};

const windowFor = (event, now, remote) => {
  const override = remote && remote[event.id];
  if (override && override.enabled === false) return null;
  if (override && Number(override.start) > 0 && Number(override.end) > 0) {
    return { start: Number(override.start), end: Number(override.end), estimated: false };
  }

  const year = new Date(now).getFullYear();
  // Check this year and next, so a December event still resolves in January
  // and an upcoming one is found once this year's has passed.
  const thisYear = estimatedWindow(event, year);
  if (now <= thisYear.end) return thisYear;
  return estimatedWindow(event, year + 1);
};

/**
 * Which event to show, and in what state.
 *
 * Returns null when nothing is running and nothing is close enough to be worth
 * a countdown — better an absent section than a permanent "42 days to go".
 *
 * `phase` is 'active' or 'upcoming'. An active event always wins; among
 * upcoming ones the soonest wins.
 */
export const resolveEvent = (now = Date.now(), remote = null, lookaheadDays = 45) => {
  let upcoming = null;
  let active = null;

  // Local defaults overlaid with whatever the backend says, so a brand-new
  // event needs no app release.
  for (const event of mergeRemoteEvents(remote)) {
    const win = windowFor(event, now, remote);
    if (!win) continue;

    if (now >= win.start && now <= win.end) {
      const candidate = {
        event,
        phase: 'active',
        startsAt: win.start,
        endsAt: win.end,
        estimated: win.estimated,
        daysLeft: Math.max(0, Math.ceil((win.end - now) / DAY_MS)),
      };

      // Events overlap: MM2 chains them back to back, and an estimated window
      // is padded, so two can look active at once. Real dates from the backend
      // beat a guess — that is the whole point of being able to set them. Two
      // real ones tie-break to whichever started most recently, which is the
      // one that just began.
      if (!active
          || (active.estimated && !candidate.estimated)
          || (active.estimated === candidate.estimated && candidate.startsAt > active.startsAt)) {
        active = candidate;
      }
      continue;
    }

    if (win.start > now) {
      const daysUntil = Math.ceil((win.start - now) / DAY_MS);
      if (daysUntil <= lookaheadDays && (!upcoming || daysUntil < upcoming.daysUntil)) {
        upcoming = {
          event,
          phase: 'upcoming',
          startsAt: win.start,
          endsAt: win.end,
          estimated: win.estimated,
          daysUntil,
        };
      }
    }
  }

  return active || upcoming;
};

/**
 * The pool items belonging to an event, newest year first.
 *
 * Sorted by year descending then by absolute movement, so this year's drop
 * leads and the items actually moving sit at the top of it — which is what a
 * trader opens the screen to see.
 */
export const eventItems = (pool, event) => {
  if (!Array.isArray(pool) || !event) return [];
  const yearOf = (origin) => {
    const m = String(origin || '').match(/(20\d\d)/);
    return m ? Number(m[1]) : 0;
  };
  return pool
    .filter((i) => i && event.match.test(i.origin || ''))
    .sort((a, b) => {
      const ya = yearOf(a.origin);
      const yb = yearOf(b.origin);
      if (yb !== ya) return yb - ya;
      return Math.abs(Number(b.change) || 0) - Math.abs(Number(a.change) || 0);
    });
};

export const __testing = { estimatedWindow, windowFor, DAY_MS };
