/*
 * click-rules.js
 * -------------------------------------------------------------------
 * Server-side event classification pipeline.  Runs in this order
 * when classifyEvent(event) is called:
 *
 *   1. selector-rules.json  — supplier-specific, 100% deterministic
 *      matches on data-qa / data-testid / aria-label / id /
 *      formcontrolname / label / url.  Hand-curated per supplier.
 *      First match wins.  Winning here beats everything in step 2.
 *
 *   2. RULES (below)        — generic text-based rules keyed on the
 *      auto-derived `action` string ("click:book_now").  Multilingual.
 *
 * The extension already computes a semantic `action` for every event
 * (e.g. "click:book_now", "date:checkin_date", "submit:search_form");
 * these two layers rewrite that onto a stable `canonicalAction` so
 * dashboards can filter without worrying about labels.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Layer 1 — supplier-specific selector rules (loaded at startup)
// ---------------------------------------------------------------------------

let selectorRulesBySupplier = {};
try {
  const raw = JSON.parse(
    readFileSync(join(__dirname, "selector-rules.json"), "utf8")
  );
  for (const [k, v] of Object.entries(raw)) {
    if (k.startsWith("__")) continue;              // skip __doc__ etc.
    if (!Array.isArray(v)) continue;
    // Filter out string-only "section header" entries; keep real rule objects.
    selectorRulesBySupplier[k] = v.filter(
      (entry) => entry && typeof entry === "object" && entry.when && entry.canonical
    );
  }
} catch (err) {
  console.warn(
    "[click-rules] selector-rules.json unreadable:",
    err?.message || err
  );
}

/**
 * Match ONE selector-rule's `when` predicate against the event.
 * All predicate keys below are optional and AND-combined — a rule
 * fires only when every present key matches.  Missing keys are
 * ignored (effectively wildcards).  See docs/BACKEND_HANDOFF.md § 4
 * for the authoritative list.
 */
function selectorPredicateMatches(when, event, meta) {
  if (!when) return false;

  // String comparison helpers.
  const eq  = (v, want) => v != null && String(v) === String(want);
  const sub = (v, want) =>
    v != null && String(v).toLowerCase().includes(String(want).toLowerCase());
  const rex = (v, pattern) => {
    try { return v != null && new RegExp(pattern, "i").test(String(v)); }
    catch { return false; }
  };

  if (when.urlPattern       && !rex(event.url,              when.urlPattern))      return false;
  if (when.hostname         && !sub(event.url,              when.hostname))        return false;
  if (when.pageTitle        && !sub(event.pageTitle,        when.pageTitle))       return false;
  if (when.action           && !sub(event.action,           when.action))          return false;
  if (when.eventType        && !eq(event.eventType,         when.eventType))       return false;
  if (when.dataQa           && !eq(meta.dataQa,             when.dataQa))          return false;
  if (when.dataTestid       && !eq(meta.dataTestid,         when.dataTestid))      return false;
  if (when.dataTest         && !eq(meta.dataTest,           when.dataTest))        return false;
  if (when.dataCy           && !eq(meta.dataCy,             when.dataCy))          return false;
  if (when.dataAnalyticsId  && !eq(meta.dataAnalyticsId,    when.dataAnalyticsId)) return false;
  if (when.ariaLabel        && !eq(meta.ariaLabel,          when.ariaLabel))       return false;
  if (when.elementId        && !eq(meta.elementId,          when.elementId))       return false;
  if (when.elementName      && !eq(meta.elementName,        when.elementName))     return false;
  if (when.formControlName  && !eq(meta.formControlName,    when.formControlName)) return false;
  if (when.placeholder      && !eq(meta.placeholder,        when.placeholder))     return false;
  if (when.label            && !sub(meta.label,             when.label))           return false;
  if (when.role             && !eq(meta.role,               when.role))            return false;
  if (when.href             && !sub(meta.href,              when.href))            return false;
  if (when.classContains    && !sub(meta.classAttr,         when.classContains))   return false;
  return true;
}

function matchSelectorRules(event) {
  const supplier = event?.supplier;
  if (!supplier) return null;
  const rules = selectorRulesBySupplier[supplier];
  if (!rules?.length) return null;
  const meta = event.metadata || {};
  for (const rule of rules) {
    if (selectorPredicateMatches(rule.when, event, meta)) return rule.canonical;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Layer 2 — generic text-based rules (unchanged behaviour)
// ---------------------------------------------------------------------------

function predicateMatches(predicate, value) {
  if (predicate == null) return true;
  if (value == null) return false;
  const check = (p) => {
    if (p instanceof RegExp) return p.test(String(value));
    return String(value).toLowerCase().includes(String(p).toLowerCase());
  };
  return Array.isArray(predicate) ? predicate.some(check) : check(predicate);
}

// Shorthand helper: any-of substring match on `action`.
const act = (...terms) => ({ action: terms });

const RULES = [
  // ---- Booking lifecycle (checked first — most specific wins) -----
  { when: act("cancel_booking", "cancel_reservation", "cancelar_reserva", "cancel_reserva"),
    canonical: "booking.cancel" },

  { when: act("confirm_booking", "confirm_reservation", "confirmar_reserva", "confirm_booknow"),
    canonical: "booking.confirm" },

  { when: act("modify_booking", "modificar_reserva", "edit_booking", "change_booking"),
    canonical: "booking.modify" },

  { when: act("view_booking", "view_reservation", "ver_reserva", "booking_details"),
    canonical: "booking.view" },

  // "book"/"reserve"/"reservar"/"book_now" — the mainline create.
  // Scoped to click: or link: verbs so a "booking_details" link does
  // not fire this one before the view rule above gets its turn.
  { when: { action: /^(click|link|submit):[^:]*(book_now|booknow|book$|reservar|reserve$|reservenow|reserve_now|hacer_reserva)/i },
    canonical: "booking.create" },

  // ---- Search ------------------------------------------------------
  { when: { action: /^submit:[^:]*search/i },
    canonical: "search.submit" },

  { when: { action: /^(click|link|submit):[^:]*(search|buscar|find|find_now|go$|ir$)/i },
    canonical: "search.submit" },

  { when: act("checkin", "check_in", "arrival", "entrada", "llegada", "fecha_entrada"),
    canonical: "search.checkin_selected" },

  { when: act("checkout", "check_out", "departure", "salida", "fecha_salida"),
    canonical: "search.checkout_selected" },

  { when: act("destination", "destino", "country", "pais", "city", "ciudad", "region"),
    canonical: "search.destination_selected" },

  { when: act("guests", "adults", "children", "rooms", "occupancy", "habitaciones", "huespedes", "adultos", "niños"),
    canonical: "search.occupancy_selected" },

  // ---- Auth -------------------------------------------------------
  { when: { action: /^(click|link):[^:]*(sign_out|signout|log_out|logout|cerrar_sesion|salir)/i },
    canonical: "auth.signout" },

  { when: { action: /^(click|link|submit):[^:]*(sign_in|signin|log_in|login|iniciar_sesion|entrar|acceder)/i },
    canonical: "auth.signin" },

  // ---- Payment / checkout -----------------------------------------
  { when: act("pay_now", "pay", "pagar", "checkout", "finalizar_compra"),
    canonical: "payment.initiate" },

  // ---- Exports / documents ----------------------------------------
  { when: act("download", "descargar", "invoice", "factura", "voucher", "export", "pdf"),
    canonical: "export.download" },

  { when: act("print", "imprimir"),
    canonical: "export.print" },

  // ---- Cart --------------------------------------------------------
  { when: act("add_to_cart", "add_to_basket", "anadir", "añadir"),
    canonical: "cart.add" },

  { when: { action: /^click:[^:]*(remove|delete|eliminar|borrar)/i },
    canonical: "cart.remove" },

  // ---- Navigation --------------------------------------------------
  { when: { action: /^(click|link):[^:]*(next$|siguiente$|continue$|continuar$|proceed$)/i },
    canonical: "nav.next" },

  { when: { action: /^(click|link):[^:]*(back$|previous$|prev$|atras$|anterior$|volver$)/i },
    canonical: "nav.back" },

  { when: { action: /^(click|link):[^:]*(home$|inicio$|dashboard$|panel$)/i },
    canonical: "nav.home" },

  { when: { action: /^(click|link):[^:]*(my_bookings|my_reservations|mis_reservas|bookings$|reservations$)/i },
    canonical: "nav.bookings" },

  // ---- Supplier UI granular selections (hotel room, destination
  //      chip, etc.) — common on search-results pages ----------------
  { when: { action: /^(click|radio):[^:]*(room|habitacion|habitación|suite|standard|deluxe|double|single|twin)/i },
    canonical: "booking.room_selected" },

  { when: { action: /^click:[^:]*(hotel|resort|property|propiedad)/i },
    canonical: "booking.property_selected" },

  // ---- Filters -----------------------------------------------------
  { when: { action: /^(click|select):[^:]*(filter|filtro|sort|ordenar)/i },
    canonical: "search.filter_changed" },

  // When the <select> had no field label, we fall back to the chosen
  // value — these are the common sort options encountered on supplier
  // search-result pages.
  { when: { action: /^select:[^:]*(price_high_to_low|price_low_to_high|most_popular|highest_rated|star_rating|recommended)/i },
    canonical: "search.filter_changed" },

  // ---- Lifecycle shortcuts (so canonicalAction is never null for
  //      these common framework events) --------------------------------
  { when: { action: /^session\./ },     canonical: "session.lifecycle" },
  { when: { action: /^page\./ },        canonical: "page.lifecycle" },
  { when: { action: /^login\./ },       canonical: "login.lifecycle" },
  { when: { action: /^shield\./ },      canonical: "shield.lifecycle" },
  { when: { action: /^navigation\./ },  canonical: "nav.lifecycle" }
];

/**
 * Return a canonical action name for the event, or null when no rule
 * matches.  Callers should store both `action` (raw, auto-derived)
 * and `canonicalAction` (rule-mapped) so dashboards can pick either.
 *
 * Resolution order:
 *   1. supplier-specific selector-rules.json (hand-curated, deterministic)
 *   2. generic text-based RULES array below (multilingual, best-effort)
 */
export function classifyEvent(event) {
  if (!event) return null;

  // Layer 1 — selector rules (data-qa, aria-label, formcontrolname, …)
  const selectorHit = matchSelectorRules(event);
  if (selectorHit) return selectorHit;

  // Layer 2 — generic text rules keyed on event.action
  if (!event.action) return null;
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
