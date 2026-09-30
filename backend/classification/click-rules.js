/*
 * click-rules.js
 * -------------------------------------------------------------------
 * Server-side rewrite table.  The extension already computes a
 * semantic `action` for every event (e.g. "click:book_now",
 * "date:checkin_date", "submit:search_form").  For the small number
 * of clicks that matter to the business (booking creation, booking
 * cancellation, search submission, etc.) we map the noisy raw label
 * onto a stable canonical action so dashboards can filter on
 * `canonicalAction: "booking.create"` regardless of whether the
 * supplier's button says "Book", "Book Now", "Reserve" or "Reservar".
 *
 * A rule fires when ALL predicates in its `when` object match.  Rules
 * are ordered most-specific → most-generic; first match wins.
 * Adding a new mapping requires no code change beyond editing this
 * file (and a restart).
 */

/**
 * Test one rule predicate against the event.
 * A predicate value can be:
 *   - a RegExp   — matched with .test() against the corresponding string
 *   - a string   — case-insensitive substring match
 *   - an array   — any-of match (strings or RegExps)
 */
function predicateMatches(predicate, value) {
  if (predicate == null) return true;
  if (value == null) return false;
  const check = (p) => {
    if (p instanceof RegExp) return p.test(String(value));
    return String(value).toLowerCase().includes(String(p).toLowerCase());
  };
  return Array.isArray(predicate) ? predicate.some(check) : check(predicate);
}

const RULES = [
  // ---- Booking lifecycle ------------------------------------------
  { when: { action: /^click:.*(cancel_booking|cancel_reservation)/i },
    canonical: "booking.cancel" },
  { when: { action: /^click:.*(confirm_booking|confirm_reservation)/i },
    canonical: "booking.confirm" },
  { when: { action: /^click:(book|book_now|reserve|reservar|booknow)$/i },
    canonical: "booking.create" },
  { when: { action: /^click:.*view_booking/i },  canonical: "booking.view"    },
  { when: { action: /^click:.*modify_booking/i }, canonical: "booking.modify" },

  // ---- Search -----------------------------------------------------
  { when: { action: /^submit:.*search/i },            canonical: "search.submit" },
  { when: { action: /^click:(search|find|find_now)$/i }, canonical: "search.submit" },
  { when: { action: /^date:(checkin|check_in|arrival)/i },   canonical: "search.checkin_selected" },
  { when: { action: /^date:(checkout|check_out|departure)/i }, canonical: "search.checkout_selected" },
  { when: { action: /^select:.*(destination|country|city|region)/i }, canonical: "search.destination_selected" },
  { when: { action: /^select:.*(guests|adults|rooms|occupancy)/i }, canonical: "search.occupancy_selected" },

  // ---- Auth -------------------------------------------------------
  { when: { action: /^click:(sign_out|signout|log_out|logout)$/i }, canonical: "auth.signout" },
  { when: { action: /^submit:.*login/i }, canonical: "auth.signin" },

  // ---- Nav / cart / exports --------------------------------------
  { when: { action: /^click:next$/i },                canonical: "nav.next" },
  { when: { action: /^click:(back|previous|prev)$/i }, canonical: "nav.back" },
  { when: { action: /^click:.*(download|invoice|voucher|export)/i }, canonical: "export.download" },
  { when: { action: /^click:print/i },                canonical: "export.print" },
  { when: { action: /^click:add_to_cart/i },          canonical: "cart.add" },
  { when: { action: /^click:(remove|delete)$/i },     canonical: "cart.remove" }
];

/**
 * Return a canonical action name for the event, or null when no rule
 * matches.  Callers should store both `action` (raw, auto-derived)
 * and `canonicalAction` (rule-mapped) so dashboards can pick either.
 */
export function classifyEvent(event) {
  if (!event || !event.action) return null;
  for (const rule of RULES) {
    const w = rule.when || {};
    if (!predicateMatches(w.supplier, event.supplier)) continue;
    if (!predicateMatches(w.action,   event.action))   continue;
    if (!predicateMatches(w.role,     event.role))     continue;
    if (!predicateMatches(w.field,    event.field))    continue;
    return rule.canonical;
  }
  return null;
}
