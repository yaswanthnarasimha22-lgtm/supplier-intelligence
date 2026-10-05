/*
 * capture.js — runs in the page context (injected by Playwright).
 *
 * For every click / change / submit it computes a *stable* CSS
 * selector for the target element and forwards the capture to the
 * host (Node) process via the `__silRecordCapture` function that
 * Playwright exposes.
 *
 * Stability ranking of selectors (best → worst):
 *   1. data-testid / data-qa / data-test / data-cy / data-analytics-id
 *   2. id (only when human-readable, not a framework hash)
 *   3. name attribute on form elements
 *   4. role + aria-label
 *   5. text-based locator (button / a with its own text)
 *   6. short structural path (:nth-of-type), capped at 4 levels
 *
 * The picker also verifies the chosen selector matches EXACTLY ONE
 * element on the page before accepting it — otherwise it falls down
 * the ranking.
 */

(() => {
  if (window.__silCaptureInstalled) return;
  window.__silCaptureInstalled = true;

  // Framework-generated ids like "_ngcontent-abc-23", "mat-input-7",
  // "cdk-overlay-3", "ember42" are not stable across sessions.
  const BAD_ID_PATTERNS = /^(_ng|ember|react-|mat-|cdk-|chakra-|ant-)|-\d{3,}$|^[0-9a-f]{8}-[0-9a-f]{4}-/i;

  function isReadableId(id) {
    if (!id || typeof id !== "string") return false;
    if (id.length > 40) return false;
    if (/^\d+$/.test(id)) return false;
    if (BAD_ID_PATTERNS.test(id)) return false;
    return true;
  }

  function uniqueOn(doc, sel) {
    try { return doc.querySelectorAll(sel).length === 1; } catch { return false; }
  }

  function cssEscape(v) {
    try { return CSS.escape(String(v)); } catch { return String(v).replace(/"/g, '\\"'); }
  }

  function bestSelectorFor(el) {
    if (!el || !el.tagName) return [];
    const doc = el.ownerDocument;
    const candidates = [];

    // 1. Automation-friendly attributes (highest stability).
    for (const attr of ["data-testid", "data-qa", "data-test", "data-cy", "data-analytics-id", "data-analytics-label"]) {
      const v = el.getAttribute(attr);
      if (v) {
        const sel = `[${attr}="${cssEscape(v)}"]`;
        if (uniqueOn(doc, sel)) candidates.push({ kind: attr, selector: sel, stability: "high" });
      }
    }

    // 2. id if readable
    if (isReadableId(el.id)) {
      const sel = `#${cssEscape(el.id)}`;
      if (uniqueOn(doc, sel)) candidates.push({ kind: "id", selector: sel, stability: "medium" });
    }

    // 3. name attribute on form inputs
    if (el.name) {
      const tag = el.tagName.toLowerCase();
      const sel = `${tag}[name="${cssEscape(el.name)}"]`;
      if (uniqueOn(doc, sel)) candidates.push({ kind: "name", selector: sel, stability: "medium" });
    }

    // 4. role + aria-label
    const role = el.getAttribute("role") || el.tagName.toLowerCase();
    const aria = el.getAttribute("aria-label");
    if (aria) {
      const sel = `[role="${cssEscape(role)}"][aria-label="${cssEscape(aria)}"]`;
      if (uniqueOn(doc, sel)) candidates.push({ kind: "aria", selector: sel, stability: "medium" });
    }

    // 5. text-based locator (Playwright-compatible)
    const text = (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 50);
    if (text && (el.tagName === "BUTTON" || el.tagName === "A")) {
      candidates.push({
        kind: "text",
        selector: `${el.tagName.toLowerCase()}:has-text("${text.replace(/"/g, '\\"')}")`,
        stability: "low"
      });
    }

    // 6. structural fallback — short :nth-of-type path, max depth 4.
    const path = buildPath(el);
    if (path) candidates.push({ kind: "path", selector: path, stability: "low" });

    return candidates;
  }

  function buildPath(el, maxDepth = 4) {
    const parts = [];
    let node = el;
    let depth = 0;
    while (node && node.nodeType === 1 && depth < maxDepth) {
      if (isReadableId(node.id)) { parts.unshift(`#${cssEscape(node.id)}`); break; }
      let step = node.tagName.toLowerCase();
      const parent = node.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(c => c.tagName === node.tagName);
        if (siblings.length > 1) step += `:nth-of-type(${siblings.indexOf(node) + 1})`;
      }
      parts.unshift(step);
      node = node.parentElement;
      depth++;
    }
    return parts.join(" > ");
  }

  function labelFor(el) {
    if (!el) return "";
    // For radios / checkboxes prefer the associated <label>.
    if (el.tagName === "INPUT" && (el.type === "radio" || el.type === "checkbox")) {
      const assoc = (el.labels && el.labels[0] && el.labels[0].textContent) ||
                    (el.closest && el.closest("label") && el.closest("label").textContent);
      if (assoc && assoc.trim()) return assoc.trim().slice(0, 100);
    }
    return (
      el.getAttribute("aria-label") ||
      (el.textContent || "").trim() ||
      el.value ||
      el.getAttribute("placeholder") ||
      el.getAttribute("title") ||
      ""
    ).replace(/\s+/g, " ").trim().slice(0, 100);
  }

  function captureEvent(event, el, extra = {}) {
    if (!el || !el.tagName) return;
    const candidates = bestSelectorFor(el);
    const best = candidates[0];
    if (!best) return;

    const payload = {
      event,
      url: location.href,
      pageTitle: document.title,
      selector: best.selector,
      selectorKind: best.kind,
      stability: best.stability,
      candidates,
      label: labelFor(el),
      role: el.getAttribute("role") || el.tagName.toLowerCase(),
      htmlSnippet: (el.outerHTML || "").slice(0, 600),
      ...extra
    };

    try { window.__silRecordCapture(payload); } catch { /* host not attached */ }
  }

  document.addEventListener("click", (e) => {
    const t = e.target.closest(
      "button, a, [role='button'], [role='tab'], [role='menuitem'], " +
      "input[type='submit'], input[type='button'], input[type='checkbox'], input[type='radio'], summary"
    );
    if (t) captureEvent("click", t);
  }, true);

  document.addEventListener("change", (e) => {
    const t = e.target;
    if (!t || !t.tagName) return;
    if (t.type === "password") return;             // never capture password fields
    captureEvent("change", t, {
      value: (t.tagName === "SELECT" || /^(checkbox|radio|date|datetime-local|month|week|time|number|range)$/i.test(t.type))
        ? (t.tagName === "SELECT" ? t.options?.[t.selectedIndex]?.textContent?.trim() : t.value)
        : null
    });
  }, true);

  document.addEventListener("submit", (e) => {
    if (e.target && e.target.tagName === "FORM") captureEvent("submit", e.target);
  }, true);

  console.log("[SIL capture] active on " + location.hostname);
})();
