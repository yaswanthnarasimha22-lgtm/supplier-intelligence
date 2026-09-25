/*
 * supplier-tracker.js
 * ----------------------------
 * Content script injected into every supplier portal page.
 *
 * Responsibilities:
 *  - Dismiss cookie/consent banners.
 *  - Walk multi-step pre-login flows (e.g. Hotelbeds discover -> app.login).
 *  - Detect the login form and request credentials from the extension.
 *  - Receive credentials from the extension and type them in a human-like
 *    way so Angular/React forms keep the values.
 *  - Mask the filled fields so the agent never sees the values.
 *  - Detect OTP prompts, login errors, successful dashboard landing, and
 *    booking confirmation.
 *  - Report tracking events back to the extension without ever logging or
 *    storing the credential values.
 *
 * Security notes:
 *  - DEV_MODE must stay false in production. When false, credentials are
 *    masked, the full-page overlay covers the login, and copy/select/right-
 *    click on the masked fields is blocked.
 *  - Credentials arrive only from the extension via a message. They are never
 *    read from the page, never written to the page source, and never logged.
 *  - The content script never stores the credential values in sessionStorage,
 *    localStorage, cookies, or any other readable storage. It only sets a
 *    boolean flag ("sil-credentials-attempted") to avoid re-requesting them
 *    on the same page load.
 */

/* ===================================================================
 *  DEV MODE
 *  Set to false for production so credential hiding is active.
 * =================================================================== */
const DEV_MODE = false;

// ---------------------------------------------------------------------------
// State machine (one instance per page load / content script instance)
// ---------------------------------------------------------------------------
// These flags drive the flow. They are intentionally flat and deterministic://   - cookieDone: a cookie/consent banner was seen and dismissed, or was
//     determined to be absent.
//   - preLoginDone: all required pre-login clicks completed, or the login
//     form was found directly.
//   - credentialRequestSent: we have already asked the extension for
//     credentials for this page load.
//   - loginFilled: credentials have been typed into the fields.
//   - overlayActive: the full-page shield overlay is currently shown.
//   - fieldsWiped: the visible field values have been cleared from the DOM.
//   - otpDetected: an OTP field was detected; the overlay is removed and the
//     agent is expected to type the code.
//   - loginErrorDetected: a login failure was detected and the error banner
//     is shown.
// ---------------------------------------------------------------------------

const reportedEventKeys = new Set();

let cookieDone = false;
let preLoginDone = false;
let preLoginStepIndex = 0;
let credentialRequestSent = false;
let loginFilled = false;
let overlayActive = false;
let fieldsWiped = false;
let otpDetected = false;
let loginErrorDetected = false;

// ---------------------------------------------------------------------------
// Adapter resolution
// ---------------------------------------------------------------------------
// Each supplier has an adapter object that describes selectors, delays, and
// flow hints for that specific portal. The generic adapter is the fallback for
// suppliers that have no dedicated adapter yet.
// ---------------------------------------------------------------------------

const genericAdapter = {
  // Generic username field guesses.
  usernameSelectors: [
    "input[type='email']",
    "input[name*='user' i]",
    "input[id*='user' i]",
    "input[name*='email' i]",
    "input[id*='email' i]",
    "input[name*='login' i]"
  ],

  // Generic password field guess.
  passwordSelector: "input[type='password']",

  // Generic submit control guesses.
  loginSubmitSelectors: [
    "button[type='submit']",
    "input[type='submit']",
    "button:not([type])"
  ],

  // No defaults for supplier-specific behavior.
  cookieAcceptSelectors: [],
  preLoginSelectors: [],
  preLoginButtonText: [],
  preLoginSteps: [],
  preSubmitCheckboxSelectors: [],
  loginErrorSelectors: [],
  otpSelectors: [],
  hideAfterCredentialFillSelectors: [],
  confirmationSelectors: [],
  confirmationText: ["booking confirmed", "booking confirmation"],

  // Delays used before retrying cookie/prelogin steps.
  preLoginDelay: 1000,
  cookieDelay: 800
};

// Find the first adapter whose `matches` function accepts this hostname.
const adapter = Object.values(globalThis.SupplierAdapters || {}).find(
  (candidate) => candidate.matches(location.hostname)
) || genericAdapter;

// Merge any missing keys from the generic adapter so every adapter has a
// complete set of keys. This avoids repetitive undefined checks elsewhere.
for (const key of Object.keys(genericAdapter)) {
  if (adapter[key] === undefined) {
    adapter[key] = genericAdapter[key];
  }
}

/**
 * Return the account identity for this page load.
 *
 * This is the single source of truth for the account key inside the content
 * script. It is set by the extension via the credential message payload so
 * that two cards on the same domain can never share a flag or credentials.
 */
let _sessionAccountValue = null;

// Override the flat account variable with a scoped one.
// This is set by runCredentialFill from the extension message payload.
let account = null;

/**
 * Return the current account identity for this page load, normalised to a
 * lowercase string.
 */
function sessionAccount() {
  if (_sessionAccountValue) return _sessionAccountValue;
  if (account) return account;
  return null;
}

/* ==================================================================
 *  DOM HELPERS
 * ================================================================== */

// Cached descriptor/setter for input.value. Repeated lookups are cheap but
// unnecessary; caching also keeps the typing helpers read-focused.
const inputValueSetter = Object.getOwnPropertyDescriptor(
  HTMLInputElement.prototype,
  "value"
).set;

// Tiny promise-based delay helper.
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fast-path: write a value directly into an input.
 *
 * This is used to clear stale values and as a best-effort fallback when
 * character-by-character typing fails to stick. It dispatches input and
 * change events so React/Angular forms notice the update.
 *
 * NOTE: the value passed in is never logged or stored by this helper.
 */
function setFieldValue(input, value) {
  if (!input) return;

  input.focus();
  input.click();

  inputValueSetter.call(input, "");
  input.dispatchEvent(new Event("input", { bubbles: true }));

  inputValueSetter.call(input, value);
  input.dispatchEvent(
    new InputEvent("input", {
      bubbles: true,
      cancelable: true,
      inputType: "insertText",
      data: value
    })
  );

  input.dispatchEvent(new Event("change", { bubbles: true }));
}

/**
 * Type a value character-by-character into an input.
 *
 * Why: Angular reactive forms (Hotelbeds in particular) can drop a value if
 * the full string is written atomically and the framework re-renders between
 * the native setter and the framework's listener. Typing one character at a
 * time with a small inter-character delay tends to keep the ControlValue-
 * Accessor in sync.
 *
 * Verification: after each character we check that `input.value` still holds
 * the expected prefix. If the value repeatedly fails to stick, the helper
 * retries up to `maxRestarts` times and then rejects so the caller can fall
 * back to `setFieldValue` or abort.
 *
 * Security: the raw credential value is never written to console, events, or
 * storage here. Only the typed result and failure reasons are used locally.
 */
async function typeFieldCharByChar(
  input,
  rawValue,
  { charDelay = 70, verifyDelay = 100, stableChecks = 3, maxRestarts = 2 } = {}
) {
  if (!input) throw new Error("Input not found");

  const value = String(rawValue ?? "");
  if (!value) {
    // Nothing to type; still dispatch a change so listeners see a stable state.
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }

  for (let attempt = 0; attempt <= maxRestarts; attempt++) {
    if (!input.isConnected) throw new Error("Input was replaced");

    input.focus();
    inputValueSetter.call(input, "");
    input.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        cancelable: true,
        inputType: "deleteContentBackward",
        data: null
      })
    );
    await delay(verifyDelay);

    let failed = false;
    for (let index = 0; index < value.length; index++) {
      const character = value[index];
      const expected = value.slice(0, index + 1);

      input.focus();
      inputValueSetter.call(input, expected);
      input.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          cancelable: true,
          inputType: "insertText",
          data: character
        })
      );
      await delay(charDelay);

      if (!input.isConnected || input.value !== expected) {
        failed = true;
        break;
      }
    }

    if (failed) continue;

    input.dispatchEvent(new Event("change", { bubbles: true }));

    let stable = true;
    for (let check = 0; check < stableChecks; check++) {
      await delay(verifyDelay);
      if (!input.isConnected || input.value !== value) {
        stable = false;
        break;
      }
    }

    if (stable) return;
  }

  throw new Error(
    `Value did not remain stable in ${input.id || input.name || "input"}`
  );
}

/**
 * Fire blur/focusout on a field. Used after both fields are filled so the
 * form treats the inputs as finished.
 */
function blurField(input) {
  if (!input) return;
  input.dispatchEvent(new Event("blur", { bubbles: true }));
  input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
}

/**
 * Return the current username and password inputs according to the active
 * adapter selectors.
 */
function findLoginFields() {
  const password = document.querySelector(adapter.passwordSelector);
  const username = (adapter.usernameSelectors || [])
    .map((selector) => document.querySelector(selector))
    .find(Boolean);
  return { username, password };
}

/**
 * Return the best login submit control for the given form (or the page if no
 * form is supplied).
 */
function findLoginSubmitButton(form) {
  for (const selector of adapter.loginSubmitSelectors || []) {
    const button =
      (form && form.querySelector(selector)) ||
      document.querySelector(selector);
    if (button) return button;
  }
  return null;
}

/**
 * Click the submit button (or submit the form as a fallback).
 */
function clickLoginSubmit(form, submitButton) {
  const button =
    submitButton ||
    document.querySelector("button[data-qa='login-button']");

  if (button && !button.disabled) {
    button.scrollIntoView({ block: "center", inline: "center" });
    button.focus();
    HTMLElement.prototype.click.call(button);
    reportEvent(
      "login.submit_button_clicked",
      { dataQa: button.getAttribute("data-qa") },
      true
    );
    return true;
  }

  if (form) {
    form.requestSubmit();
    return true;
  }

  reportEvent("login.submit_control_not_found", {}, true);
  return false;
}

/**
 * Return the first element matching any of the supplied selectors, or null.
 * Invalid selectors are silently skipped.
 */
function findElement(selectors) {
  if (!selectors || !selectors.length) return null;
  for (const selector of selectors) {
    try {
      const el = document.querySelector(selector);
      if (el) return el;
    } catch {
      // Invalid selector; skip.
    }
  }
  return null;
}

/**
 * Find a clickable element by visible text content.
 *
 * This is used when CSS selectors are unstable (e.g. the "Client Login"
 * button on Yalago).
 */
function findClickableByText(textList) {
  if (!textList || !textList.length) return null;

  const candidates = document.querySelectorAll(
    "a, button, [role='button'], [role='tab']"
  );

  for (const el of candidates) {
    const elText = (el.textContent || "").trim().toLowerCase();
    for (const target of textList) {
      if (
        elText === target.toLowerCase() ||
        elText.includes(target.toLowerCase())
      ) {
        return el;
      }
    }
  }

  return null;
}

/**
 * Reliable visibility check that also works for position:fixed elements.
 *
 * offsetParent is null for fixed elements, so we use computed style and
 * geometry instead.
 */
function isElementVisible(el) {
  if (!el) return false;

  const style = window.getComputedStyle(el);
  if (style.display === "none") return false;
  if (style.visibility === "hidden") return false;
  if (style.opacity === "0") return false;

  return (
    el.offsetWidth > 0 ||
    el.offsetHeight > 0 ||
    el.getClientRects().length > 0
  );
}


/* ==================================================================
 *  LAYER 1 — FULL-PAGE OVERLAY (disabled in DEV_MODE)
 * ================================================================== */

function showLoginOverlay() {
  if (DEV_MODE) return;
  if (document.getElementById("sil-login-overlay")) return;

  const overlay = document.createElement("div");
  overlay.id = "sil-login-overlay";
  overlay.innerHTML = `
    <div class="sil-spinner"></div>
    <div class="sil-label">Signing in to supplier portal…</div>
    <div class="sil-sublabel">Credentials are managed securely — please wait.</div>
  `;
  overlay.addEventListener("contextmenu", (e) => e.preventDefault(), true);
  document.documentElement.appendChild(overlay);
  overlayActive = true;
  reportEvent("shield.overlay_shown", {}, true);
}

function removeLoginOverlay() {
  const overlay = document.getElementById("sil-login-overlay");
  if (overlay) {
    overlay.remove();
    overlayActive = false;
    reportEvent("shield.overlay_removed", {}, true);
  }
}

function showOtpNotice() {
  if (document.getElementById("sil-otp-notice")) return;
  const notice = document.createElement("div");
  notice.id = "sil-otp-notice";
  notice.textContent = "Enter the verification code sent to your device.";
  document.documentElement.appendChild(notice);
}

function removeOtpNotice() {
  const notice = document.getElementById("sil-otp-notice");
  if (notice) notice.remove();
}


/* ==================================================================
 *  LAYER 2 — CSS FIELD MASKING (disabled in DEV_MODE)
 * ================================================================== */

/**
 * Visually hide the credential value while keeping the field usable by the
 * form. The real value is still present in the DOM value, but the agent sees
 * discs and cannot select/copy it.
 *
 * This must remain enabled in production (DEV_MODE = false).
 */
function maskField(input) {
  if (!input) return;
  if (DEV_MODE) return;

  input.setAttribute("data-sil-masked", "true");
  input.style.setProperty("-webkit-text-security", "disc", "important");
  input.style.setProperty("caret-color", "transparent", "important");
  input.style.setProperty("user-select", "none", "important");
  input.style.setProperty("-webkit-user-select", "none", "important");
  input.setAttribute("autocomplete", "new-password");
  input.setAttribute("data-lpignore", "true");
  input.setAttribute("data-1p-ignore", "true");
  input.setAttribute("readonly", "true");

  // Re-enable editing shortly after masking so the form can submit normally.
  setTimeout(() => input.removeAttribute("readonly"), 150);
}

/**
 * Mask the login fields and hide any supplier-specific elements that should
 * not be visible once credentials are filled.
 */
function maskAllFields() {
  if (DEV_MODE) return;

  const { username, password } = findLoginFields();
  maskField(username);
  maskField(password);

  for (const selector of adapter.hideAfterCredentialFillSelectors || []) {
    for (const element of document.querySelectorAll(selector)) {
      element.style.setProperty("display", "none", "important");
    }
  }

  for (const form of document.querySelectorAll("form")) {
    form.setAttribute("autocomplete", "off");
  }
}


/* ==================================================================
 *  LAYER 3 — DOM CLEANUP (disabled in DEV_MODE)
 * ================================================================== */

/**
 * Clear the visible credential values from the DOM after login.
 *
 * This does not remove the field itself; it blanks the value and removes the
 * HTML attribute so a quick DOM inspection is less likely to expose the last
 * typed value.
 */
function wipeFieldValues() {
  if (DEV_MODE) return;
  if (fieldsWiped) return;

  fieldsWiped = true;

  const { username, password } = findLoginFields();
  if (username) {
    inputValueSetter.call(username, "");
    username.removeAttribute("value");
  }
  if (password) {
    inputValueSetter.call(password, "");
    password.removeAttribute("value");
  }

  reportEvent("shield.credentials_wiped_from_dom", {}, true);
}


/* ==================================================================
 *  COPY / SELECT / RIGHT-CLICK PREVENTION (disabled in DEV_MODE)
 * ================================================================== */

if (!DEV_MODE) {
  document.addEventListener(
    "copy",
    (e) => {
      if (e.target?.hasAttribute?.("data-sil-masked")) {
        e.preventDefault();
      }
    },
    true
  );

  document.addEventListener(
    "cut",
    (e) => {
      if (e.target?.hasAttribute?.("data-sil-masked")) {
        e.preventDefault();
      }
    },
    true
  );

  document.addEventListener(
    "selectstart",
    (e) => {
      if (e.target?.hasAttribute?.("data-sil-masked")) {
        e.preventDefault();
      }
    },
    true
  );

  document.addEventListener(
    "keydown",
    (e) => {
      const target = e.target;
      if (!target?.hasAttribute?.("data-sil-masked")) return;

      if (
        (e.ctrlKey || e.metaKey) &&
        ["a", "c", "x"].includes(e.key.toLowerCase())
      ) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    true
  );

  document.addEventListener(
    "contextmenu",
    (e) => {
      if (e.target?.hasAttribute?.("data-sil-masked")) {
        e.preventDefault();
      }
    },
    true
  );
}


/* ==================================================================
 *  MUTATION GUARD (disabled in DEV_MODE)
 * ================================================================== */

/**
 * Re-apply masking if some other script removes the marker attribute from a
 * credential field while the overlay is still active.
 */
const maskGuard = new MutationObserver((mutations) => {
  if (DEV_MODE) return;
  if (!loginFilled || fieldsWiped) return;

  for (const mutation of mutations) {
    if (
      mutation.type === "attributes" &&
      mutation.attributeName === "data-sil-masked" &&
      mutation.target instanceof HTMLInputElement
    ) {
      if (!mutation.target.hasAttribute("data-sil-masked")) {
        maskField(mutation.target);
        reportEvent(
          "shield.mask_reapplied",
          {
            field: mutation.target.id || mutation.target.name || "unknown"
          }
        );
      }
    }
  }
});



/* ==================================================================
 *  COOKIE / CONSENT BANNER
 * ================================================================== */

function dismissCookieBanner() {
  if (cookieDone) return;

  const btn = findElement(adapter.cookieAcceptSelectors);
  if (btn) {
    btn.click();
    cookieDone = true;
    reportEvent("page.cookie_accepted", {}, true);
    chrome.runtime.sendMessage({
      type: "SUPPLIER_PRELOGIN_DONE",
      payload: { step: "cookie_accepted" }
    });
  }
}

/**
 * If no cookie banner is present, mark cookie handling as done so the
 * pre-login and form-detection steps are not blocked.
 */
function markCookieDoneIfBannerAbsent() {
  if (cookieDone) return;

  // If the adapter has no cookie selectors at all, there is nothing to wait
  // for.
  if (!adapter.cookieAcceptSelectors?.length) {
    cookieDone = true;
    return;
  }

  const btn = findElement(adapter.cookieAcceptSelectors);
  if (!btn) {
    cookieDone = true;
    reportEvent("page.cookie_banner_not_present", {}, true);
  }
}


/* ==================================================================
 *  PRE-LOGIN STEP (supports multi-step flows)
 *
 *  Two formats:
 *  1. Legacy single-step: adapter.preLoginSelectors or preLoginButtonText
 *  2. Multi-step: adapter.preLoginSteps = [ { selectors, buttonText }, ... ]
 *
 *  Hotelbeds uses the multi-step format:
 *    step 1 -> click the header login trigger on discover.hotelbeds.com
 *    step 2 -> click "CLIENTS LOGIN" in the dropdown
 *
 *  If the login form is already on the page, skip all pre-login steps. This
 *  is important because after the pre-login navigation the page may land
 *  directly on the login form (e.g. app.hotelbeds.com/auth/login).
 * ================================================================== */

function handlePreLoginStep() {
  // If the login form is already visible, there are no pre-login steps left
  // to perform.
  const { username, password } = findLoginFields();
  if (username && password) {
    preLoginDone = true;
    return;
  }

  // ---- Multi-step format ----
  const steps = adapter.preLoginSteps;
  if (steps && steps.length) {
    if (preLoginStepIndex >= steps.length) return;

    const step = steps[preLoginStepIndex];
    let btn = findElement(step.selectors || []);

    if (!btn && step.buttonText?.length) {
      btn = findClickableByText(step.buttonText);
    }

    if (btn) {
      btn.click();
      preLoginStepIndex++;
      reportEvent(
        "login.prelogin_step_clicked",
        {
          step: preLoginStepIndex,
          total: steps.length,
          text: (btn.textContent || "").trim().slice(0, 50)
        }
      );

      if (preLoginStepIndex >= steps.length) {
        preLoginDone = true;
      }

      chrome.runtime.sendMessage({
        type: "SUPPLIER_PRELOGIN_DONE",
        payload: { step: `prelogin_step_${preLoginStepIndex}` }
      });
    }
    return;
  }

  // ---- Legacy single-step format ----
  if (preLoginDone) return;

  let btn = findElement(adapter.preLoginSelectors);
  if (!btn && adapter.preLoginButtonText?.length) {
    btn = findClickableByText(adapter.preLoginButtonText);
  }

  if (btn) {
    btn.click();
    preLoginDone = true;
    reportEvent(
      "login.prelogin_button_clicked",
      {
        method: btn.tagName,
        text: (btn.textContent || "").trim().slice(0, 50)
      },
      true
    );
    chrome.runtime.sendMessage({
      type: "SUPPLIER_PRELOGIN_DONE",
      payload: { step: "prelogin_button_clicked" }
    });
  }
}


/* ==================================================================
 *  OTP DETECTION
 * ================================================================== */

function checkForOtp() {
  if (otpDetected) return;
  if (!loginFilled) return;

  const otpField = findElement(adapter.otpSelectors);
  if (otpField) {
    otpDetected = true;
    removeLoginOverlay();
    showOtpNotice();
    reportEvent("login.otp_required", {}, true);
    chrome.runtime.sendMessage({ type: "SUPPLIER_OTP_REQUIRED" });
  }
}


/* ==================================================================
 *  LOGIN FAILURE DETECTION
 * ================================================================== */

// Common login-failure messages. These are matched in supplier-visible text
// only after credentials have been filled, to reduce false positives.
const LOGIN_ERROR_PATTERNS = [
  "invalid username or password",
  "invalid credentials",
  "incorrect password",
  "incorrect username",
  "wrong password",
  "wrong username",
  "login failed",
  "authentication failed",
  "sign in failed",
  "sign-in failed",
  "access denied",
  "account locked",
  "account disabled",
  "account blocked",
  "too many attempts",
  "user not found",
  "unable to login",
  "unable to sign in",
  "invalid login",
  "bad credentials",
  "password is incorrect",
  "username is incorrect",
  "the password you entered is incorrect",
  "the username you entered is incorrect",
  "please check your credentials",
  "credentials are invalid",
  "not authorized",
  "unauthorized"
];

// Generic error-element selectors, in order of preference.
const LOGIN_ERROR_SELECTORS = [
  ".error-message",
  ".login-error",
  ".alert-danger",
  ".alert-error",
  "[class*='error-msg' i]",
  "[class*='login-error' i]",
  "[class*='auth-error' i]",
  "[role='alert']",
  ".notification-error",
  ".form-error",
  ".field-error"
];

function checkForLoginError() {
  if (loginErrorDetected) return;
  if (!loginFilled) return;

  // Method 1: supplier-specific error selectors (most reliable).
  for (const selector of adapter.loginErrorSelectors || []) {
    try {
      const el = document.querySelector(selector);
      if (el && isElementVisible(el) && el.textContent.trim().length > 0) {
        showLoginErrorBanner(el.textContent.trim().slice(0, 200));
        return;
      }
    } catch {
      // Invalid selector or unreadable element.
    }
  }

  // Method 2: generic error selectors.
  for (const selector of LOGIN_ERROR_SELECTORS) {
    try {
      const el = document.querySelector(selector);
      if (el && isElementVisible(el) && el.textContent.trim().length > 0) {
        showLoginErrorBanner(el.textContent.trim().slice(0, 200));
        return;
      }
    } catch {
      // Invalid selector or unreadable element.
    }
  }

  // Method 3: text scan for known error patterns.
  const pageText = (document.body?.innerText || "").toLowerCase();
  for (const pattern of LOGIN_ERROR_PATTERNS) {
    if (pageText.includes(pattern)) {
      const { username, password } = findLoginFields();
      if (username || password) {
        showLoginErrorBanner(pattern);
        return;
      }
    }
  }
}

/**
 * Show an inline banner explaining that login failed.
 *
 * The supplied text is HTML-escaped before insertion so the banner can never
 * become an XSS vector via supplier page content.
 */
function showLoginErrorBanner(errorText) {
  if (loginErrorDetected) return;
  loginErrorDetected = true;

  removeLoginOverlay();

  const existing = document.getElementById("sil-login-error-banner");
  if (existing) existing.remove();

  const safeText =
    (errorText || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .trim();

  const banner = document.createElement("div");
  banner.id = "sil-login-error-banner";
  banner.innerHTML = `
    <span class="sil-error-icon">⚠</span>
    <span>Login failed${safeText ? " — " + safeText : ""}. Please check credentials in .env or contact your supervisor.</span>
    <button class="sil-error-dismiss">Dismiss</button>
  `;

  banner.querySelector(".sil-error-dismiss").addEventListener(
    "click",
    () => banner.remove()
  );

  document.documentElement.appendChild(banner);

  reportEvent(
    "login.failed",
    {
      errorText: (errorText || "").slice(0, 200),
      url: location.href
    },
    true
  );
}


/* ==================================================================
 *  LOGIN FORM INSPECTION
 * ================================================================== */

/**
 * When the login form is detected, request credentials from the extension.
 *
 * Loop guard: if the page already recorded that credentials were attempted on
 * this page load (sessionStorage flag), we treat the form as already handled
 * and watch for either a redirect to the dashboard or a login error.
 *
 * This flag is only a boolean. Credentials themselves are never stored in
 * sessionStorage or any other page-readable storage.
 */
function inspectLoginForm() {
  const { username, password } = findLoginFields();
  if (!username || !password) return;

  reportEvent("login.form_detected", {}, true);
  if (credentialRequestSent) return;

  // Guard against re-requesting credentials on a page that already received
  // them during this load.
  try {
    if (sessionStorage.getItem("sil-credentials-attempted") === "true") {
      credentialRequestSent = true;
      loginFilled = true;
      removeLoginOverlay();
      reportEvent("login.redirect_after_credentials", {}, true);

      // Give the supplier a moment to either redirect to the dashboard or
      // render an error message.
      setTimeout(() => {
        if (!loginErrorDetected) {
          showLoginErrorBanner(
            "Login was not successful — the login page reappeared after submitting credentials. " +
            "Check the credentials mapped to this supplier card."
          );
        }
      }, 3000);
      return;
    }
  } catch {
    // sessionStorage may be blocked; proceed with the credential request.
  }

  credentialRequestSent = true;
  chrome.runtime.sendMessage({ type: "SUPPLIER_LOGIN_FORM_READY" });
}


/* ==================================================================
 *  BOOKING CONFIRMATION
 * ================================================================== */

function bookingConfirmationVisible() {
  if (
    (adapter.confirmationSelectors || []).some((s) => document.querySelector(s))
  ) {
    return true;
  }

  const pageText = (document.body.innerText || "").toLowerCase();
  return (adapter.confirmationText || []).some((text) =>
    pageText.includes(text)
  );
}


/* ==================================================================
 *  DASHBOARD / POST-LOGIN DETECTION
 * ================================================================== */

let loginFormGoneCount = 0;

/**
 * When credentials have been filled and the overlay is still active, watch
 * for the login form to disappear, which usually indicates a successful
 * redirect to the dashboard.
 */
function checkLoginComplete() {
  if (!loginFilled) return;
  if (!overlayActive && !DEV_MODE) return;
  if (otpDetected) return;

  const { username, password } = findLoginFields();
  if (!username && !password) {
    loginFormGoneCount++;
    if (loginFormGoneCount >= 2) {
      removeLoginOverlay();
      removeOtpNotice();
      reportEvent("login.dashboard_detected", {}, true);
    }
  } else {
    loginFormGoneCount = 0;
  }
}


/* ==================================================================
 *  EVENT REPORTING
 * ================================================================== */

/**
 * Send a tracking event to the extension.
 *
 * Security: metadata must never contain credential values. Event types and
 * opaque metadata are logged only when DEV_MODE is true.
 */
function reportEvent(eventType, metadata = {}, once = false) {
  if (once && reportedEventKeys.has(eventType)) return;
  if (once) reportedEventKeys.add(eventType);

  if (DEV_MODE) {
    // In production this branch is disabled, but even in dev we avoid
    // printing credential values.
    console.log(`[SIL] ${eventType}`, metadata);
  }

  chrome.runtime.sendMessage({
    type: "SUPPLIER_EVENT",
    payload: {
      eventType,
      url: location.href,
      pageTitle: document.title,
      metadata
    }
  });
}


/* ==================================================================
 *  EVENT LISTENERS
 * ================================================================== */

reportEvent("page.loaded", {}, true);

document.addEventListener(
  "submit",
  (event) => {
    if (event.target.matches("form")) {
      reportEvent("login.submitted");
    }
  },
  true
);

document.addEventListener(
  "click",
  (event) => {
    const target = event.target.closest(
      "button, a, [role='button'], input[type='submit'], input[type='button']"
    );
    if (!target) return;

    reportEvent(
      "interaction.click",
      {
        initiatedBy: event.isTrusted ? "user" : "script",
        element: target.tagName.toLowerCase(),
        elementId: target.id || null,
        elementName: target.getAttribute("name"),
        label: (
          target.getAttribute("aria-label") ||
          target.textContent ||
          target.value ||
          ""
        )
          .trim()
          .slice(0, 100)
      }
    );
  },
  true
);


/* ==================================================================
 *  CREDENTIAL FILL HANDLER (the core flow)
 * ================================================================== */

// Extracted so the success path and the fallback path share one implementation.
// Neither path logs or stores the credential values.
async function runCredentialFill(message) {
  const { username, password } = findLoginFields();
  if (!username || !password) {
    reportEvent("login.form_not_found", {}, true);
    return;
  }

  const usernameValue = message.payload.username;
  const passwordValue = message.payload.password;
  const shouldAutoSubmit =
    Boolean(message.payload.autoSubmit || adapter.forceAutoSubmit);
  const submitDelay = Number(adapter.submitDelay || 500);
  const typingOptions = adapter.credentialTyping || {};

  // ---- Step 1: show the shield overlay (hidden in DEV_MODE) ----
  showLoginOverlay();

  // ---- Step 2: mask the fields (hidden in DEV_MODE) ----
  maskField(username);
  maskField(password);

  if (!DEV_MODE) {
    maskGuard.observe(username, {
      attributes: true,
      attributeFilter: ["data-sil-masked"]
    });
    maskGuard.observe(password, {
      attributes: true,
      attributeFilter: ["data-sil-masked"]
    });
  }

  // ---- Step 3: type username, then password ----

  // Record which account this fill belongs to so the in-page flag and the
  // extension reset handler stay scoped to the selected card.
  const fillAccount = message?.payload?.account || (sessionAccount && sessionAccount()) || null;

  // Clear any stale value before typing.
  setFieldValue(username, "");
  maskField(username);

  try {
    await typeFieldCharByChar(username, usernameValue, typingOptions);
    reportEvent("login.username_filled", {}, true);

    // Small settle before touching the password field.
    await delay(150);

    setFieldValue(password, "");
    maskField(password);

    await typeFieldCharByChar(password, passwordValue, typingOptions);
    reportEvent("login.password_filled", {}, true);
  } catch (error) {
    // If the adapter requires verified typing, fail loudly but without
    // exposing credential values.
    if (adapter.requireVerifiedCredentialTyping) {
      loginFilled = false;
      removeLoginOverlay();
      reportEvent(
        "login.verified_typing_failed",
        { reason: error.message || "unknown" },
        true
      );
      showLoginErrorBanner(
        "Credential fields did not remain stable. Login was not submitted."
      );
      return;
    }

    // Best-effort fallback: write the values directly. This is still masked
    // and never logged.
    reportEvent(
      "login.fill_fallback_to_setfieldvalue",
      { reason: error.message || "unknown" },
      true
    );

    setFieldValue(username, usernameValue);
    maskField(username);
    setFieldValue(password, passwordValue);
    maskField(password);
    reportEvent("login.password_filled", {}, true);
  }

  // ---- Step 4: blur both fields after typing ----
  blurField(username);
  blurField(password);

  loginFilled = true;
  reportEvent("login.credentials_filled", {}, true);

  // Record the account for the final flag and client-side reset handling.
  // This is the single value used by checkForLoginError, inspectLoginForm,
  // runCredentialFill, and the client-side reset handler.
  _sessionAccountValue = fillAccount || (_sessionAccountValue && sessionAccount()) || null;

  // Record only a boolean flag scoped to the account, not the values.
  // Two cards on the same domain must never share this flag.
  const account = sessionAccount() || "unknown";
  try {
    sessionStorage.setItem(`sil-credentials-attempted:${account}`, "true");
  } catch {
    // sessionStorage may be blocked; not critical.
  }

  // Overlay timeout safety net.
  setTimeout(() => {
    if (overlayActive) {
      removeLoginOverlay();
      showLoginErrorBanner(
        "Login is taking too long — the supplier may be unresponsive. Please try again."
      );
    }
  }, 25000);

  // ---- Step 5: tick pre-submit checkboxes (e.g. W2M) ----
  const checkboxSelectors = adapter.preSubmitCheckboxSelectors || [];
  for (const selector of checkboxSelectors) {
    try {
      const el = document.querySelector(selector);
      if (!el) continue;

      if (el.tagName === "INPUT" && el.type === "checkbox") {
        if (!el.checked) {
          el.click();
          el.checked = true;
          el.dispatchEvent(new Event("change", { bubbles: true }));
          el.dispatchEvent(new Event("input", { bubbles: true }));
          reportEvent(
            "login.checkbox_ticked",
            { selector, method: "input" },
            true
          );
        }
        break;
      }

      el.click();
      reportEvent(
        "login.checkbox_ticked",
        { selector, method: "wrapper_click" },
        true
      );
      break;
    } catch {
      // Unreadable or removed element; skip.
    }
  }

  // ---- Step 6: submit ----
  if (shouldAutoSubmit) {
    const form =
      password.closest("form") || username.closest("form");
    const submitButton = findLoginSubmitButton(form);

    reportEvent(
      "login.auto_submit_attempted",
      {
        method:
          submitButton ? "button.click" : "form.requestSubmit",
        selectorConfigured: Boolean(submitButton)
      },
      true
    );

    setTimeout(() => {
      clickLoginSubmit(form, submitButton);

      // Clear visible values shortly after submit (hidden in DEV_MODE).
      setTimeout(() => wipeFieldValues(), 500);
    }, submitDelay);
  } else {
    setTimeout(() => wipeFieldValues(), 2000);
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "FILL_SUPPLIER_LOGIN") return;

  runCredentialFill(message);
});

// Handle reset requests from the extension before a fresh launch.
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "SUPPLIER_RESET_SESSION_STATE") return;

  // Drop the in-page credential-attempt flag scoped to the previous account
  // so a reused page does not skip the credential request for the next card.
  const account =
    message?.payload?.account ||
    sessionAccount() ||
    "unknown";
  try {
    sessionStorage.removeItem(`sil-credentials-attempted:${account}`);
  } catch {
    // sessionStorage may be blocked.
  }

  // Reset the content-script state machine for the new launch.
  credentialRequestSent = false;
  loginFilled = false;
  overlayActive = false;
  fieldsWiped = false;
  otpDetected = false;
  loginErrorDetected = false;
  preLoginDone = false;
  preLoginStepIndex = 0;
  cookieDone = false;
  loginFormGoneCount = 0;

  // Remove any leftover shield elements from the previous session.
  const oldOverlay = document.getElementById("sil-login-overlay");
  if (oldOverlay) oldOverlay.remove();

  const oldOtpNotice = document.getElementById("sil-otp-notice");
  if (oldOtpNotice) oldOtpNotice.remove();

  const oldErrorBanner = document.getElementById("sil-login-error-banner");
  if (oldErrorBanner) oldErrorBanner.remove();

  reportedEventKeys.clear();
});



/* ==================================================================
 *  MUTATION OBSERVER — drives the state machine
 * ================================================================== */

/**
 * The mutation observer is the central loop for the page-side state machine.
 * It reacts to DOM changes rather than polling. On every mutation it:
 *  1. dismisses cookie banners,
 *  2. advances pre-login steps,
 *  3. looks for the login form,
 *  4. checks for an OTP prompt,
 *  5. checks for login errors,
 *  6. checks whether login completed,
 *  7. checks for a booking confirmation.
 *
 * Text scans (login error patterns, booking confirmation text) are deferred
 * to the dedicated check functions so we do not pay for them on every
 * mutation unless state has changed.
 */
const observer = new MutationObserver(() => {
  // Step 1: dismiss cookie banners.
  dismissCookieBanner();

  // Step 2: handle pre-login clicks. This is not gated on cookieDone because
  // some suppliers show their pre-login trigger before/after cookie banners.
  handlePreLoginStep();

  // Step 3: check for the login form.
  inspectLoginForm();

  // Step 4: check for an OTP prompt.
  checkForOtp();

  // Step 5: check for login failure messages.
  checkForLoginError();

  // Step 6: check whether login completed.
  checkLoginComplete();

  // Step 7: check for booking confirmation.
  if (bookingConfirmationVisible()) {
    reportEvent("booking.confirmation_detected", {}, true);
  }
});

observer.observe(document.documentElement, {
  childList: true,
  subtree: true
});


/* ==================================================================
 *  INITIAL CHECKS ON LOAD
 * ================================================================== */

dismissCookieBanner();

// After the cookie delay, dismiss cookies again, decide whether the banner is
// absent, and attempt the first pre-login/form detection.
setTimeout(() => {
  dismissCookieBanner();
  markCookieDoneIfBannerAbsent();
  handlePreLoginStep();
  inspectLoginForm();
}, adapter.cookieDelay || 800);

// After cookie + pre-login delays, make a final attempt.
setTimeout(() => {
  markCookieDoneIfBannerAbsent();
  handlePreLoginStep();
  inspectLoginForm();
}, (adapter.cookieDelay || 800) + (adapter.preLoginDelay || 1000));


/* ==================================================================
 *  PAGE NAVIGATION — cleanup on full page loads
 * ================================================================== */

window.addEventListener("beforeunload", () => {
  if (loginFilled && !fieldsWiped) wipeFieldValues();
});
