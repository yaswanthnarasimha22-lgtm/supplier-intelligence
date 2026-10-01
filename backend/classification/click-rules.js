/*
 * click-rules.js
 * -------------------------------------------------------------------
 * Server-side rewrite table.  The extension already computes a
 * semantic `action` for every event (e.g. "click:book_now",
 * "date:checkin_date", "submit:search_form").  For the clicks that
 * matter to the business we map the noisy raw label onto a stable
 * canonical action so dashboards can filter on
 * `canonicalAction: "booking.create"` regardless of whether the
 * supplier's button says "Book", "Book Now", "Reserve", "Reservar"
 * or "Buscar".
 *
 * Rules are ordered most-specific → most-generic; first match wins.
 * Adding a new mapping requires no code change beyond editing this
 * file (and a restart).
 *
 * Each predicate is tested as a case-insensitive substring OR as a
 * regex — so the rules below cover variants ("book", "booknow",
 * "book_now", "reserve", "reservar") in both EN and ES without any
 * strict anchors.
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

  // ---- Filters -----------------------------------------------------
  { when: { action: /^(click|select):[^:]*(filter|filtro|sort|ordenar)/i },
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
