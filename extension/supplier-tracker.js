/*
supplier-tracker.js
Content script injected into every supplier portal page.
*/

const DEV_MODE = false;

// ---------------------------------------------------------------------------
// State machine
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
const genericAdapter = {
  usernameSelectors: [
    "input[type='email']",
    "input[name*='user' i]",
    "input[id*='user' i]",
    "input[name*='email' i]",
    "input[id*='email' i]",
    "input[name*='login' i]"
  ],
  passwordSelector: "input[type='password']",
  loginSubmitSelectors: [
    "button[type='submit']",
    "input[type='submit']",
    "button:not([type])"
  ],
  cookieAcceptSelectors: [],
  preLoginSelectors: [],
  preLoginButtonText: [],
  preLoginSteps: [],
  preSubmitCheckboxSelectors: [],
  loginErrorSelectors: [],
  otpSelectors: [],
  otpTermsCheckboxSelectors: [],
  otpSubmitSelectors: [],
  hideAfterCredentialFillSelectors: [],
  confirmationSelectors: [],
  confirmationText: ["booking confirmed", "booking confirmation"],
  preLoginDelay: 1000,
  cookieDelay: 800
};

const adapter = Object.values(globalThis.SupplierAdapters || {}).find(
  (candidate) => candidate.matches(location.hostname)
) || genericAdapter;

for (const key of Object.keys(genericAdapter)) {
  if (adapter[key] === undefined) {
    adapter[key] = genericAdapter[key];
  }
}

let _sessionAccountValue = null;
let account = null;

function sessionAccount() {
  if (_sessionAccountValue) return _sessionAccountValue;
  if (account) return account;
  return null;
}

/* ==================================================================
DOM HELPERS
================================================================== */
const inputValueSetter = Object.getOwnPropertyDescriptor(
  HTMLInputElement.prototype,
  "value"
).set;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

async function typeFieldCharByChar(
  input,
  rawValue,
  { charDelay = 70, verifyDelay = 100, stableChecks = 3, maxRestarts = 2 } = {}
) {
  if (!input) throw new Error("Input not found");
  const value = String(rawValue ?? "");
  if (!value) {
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

function blurField(input) {
  if (!input) return;
  input.dispatchEvent(new Event("blur", { bubbles: true }));
  input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
}

function findLoginFields() {
  const password = document.querySelector(adapter.passwordSelector);
  const username = (adapter.usernameSelectors || [])
    .map((selector) => document.querySelector(selector))
    .find(Boolean);
  return { username, password };
}

function findLoginSubmitButton(form) {
  for (const selector of adapter.loginSubmitSelectors || []) {
    const button =
      (form && form.querySelector(selector)) ||
      document.querySelector(selector);
    if (button) return button;
  }
  return null;
}

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
LAYER 1 — FULL-PAGE OVERLAY
================================================================== */
function showLoginOverlay() {
  if (DEV_MODE) return;
  if (document.getElementById("sil-login-overlay")) return;
  const overlay = document.createElement("div");
  overlay.id = "sil-login-overlay";
  overlay.innerHTML = `<div class="sil-spinner"></div> <div class="sil-label">Signing in to supplier portal…</div> <div class="sil-sublabel">Credentials are managed securely — please wait.</div>`;
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
LAYER 2 — CSS FIELD MASKING
================================================================== */
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
  setTimeout(() => input.removeAttribute("readonly"), 150);
}

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
LAYER 3 — DOM CLEANUP
================================================================== */
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
COPY / SELECT / RIGHT-CLICK PREVENTION
================================================================== */
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
MUTATION GUARD
================================================================== */
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
COOKIE / CONSENT BANNER
================================================================== */
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

function markCookieDoneIfBannerAbsent() {
  if (cookieDone) return;
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
PRE-LOGIN STEP
================================================================== */
function handlePreLoginStep() {
  const { username, password } = findLoginFields();
  if (username && password) {
    preLoginDone = true;
    return;
  }
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
OTP DETECTION AND POPUP
================================================================== */
function isW2mHost() {
  const hostname = location.hostname.toLowerCase();
  return hostname === "b2dmc.w2m.travel" || hostname.endsWith(".w2m.travel");
}

function isStandaloneOtpPage() {
  if (!isW2mHost()) return false;
  const pathname = location.pathname.toLowerCase();
  return (
    pathname === "/users/login.aspx" ||
    pathname.endsWith("/users/login.aspx") ||
    pathname.includes("verification") ||
    pathname.includes("/otp")
  );
}

function findOtpField() {
  if (isW2mHost() && !isStandaloneOtpPage()) return null;
  const configured = findElement(adapter.otpSelectors || []);
  if (configured && isElementVisible(configured)) return configured;
  if (!isStandaloneOtpPage()) return null;
  const candidates = document.querySelectorAll(
    "input:not([type='hidden']):not([type='checkbox']):not([type='submit']):not([type='button'])"
  );
  for (const input of candidates) {
    if (!isElementVisible(input)) continue;
    const identity = [
      input.id,
      input.name,
      input.getAttribute("placeholder"),
      input.getAttribute("aria-label")
    ].filter(Boolean).join(" ").toLowerCase();
    if (/otp|verification|security|one.?time|code/.test(identity)) return input;
  }
  return null;
}

function checkForOtp() {
  if (otpDetected) return;
  const standaloneOtp = isStandaloneOtpPage();
  if (isW2mHost() && !standaloneOtp) return;
  
  const otpField = findOtpField();
  if (!otpField) return;
  
  const { username, password } = findLoginFields();
  if (!loginFilled && !standaloneOtp) return;
  
  // FIX APPLIED: Removed the restrictive early return that aborted the popup
  // if username/password fields happened to exist on the OTP page.
  
  otpDetected = true;
  showLoginOverlay();
  showOtpPopup();
  reportEvent("login.otp_required", { standalone: standaloneOtp }, true);
  chrome.runtime.sendMessage({ type: "SUPPLIER_OTP_REQUIRED" });
}

function showOtpPopup() {
  removeOtpNotice();
  if (document.getElementById("sil-otp-popup")) return;
  showLoginOverlay();
  const overlay = document.getElementById("sil-login-overlay");
  if (!overlay) return;
  
  overlay.innerHTML = "";
  const popup = document.createElement("div");
  popup.id = "sil-otp-popup";
  popup.setAttribute("role", "dialog");
  popup.setAttribute("aria-modal", "true");
  popup.setAttribute("aria-labelledby", "sil-otp-title");
  popup.innerHTML = `
    <div class="sil-otp-card">
      <div class="sil-otp-icon" aria-hidden="true">&#128274;</div>
      <div id="sil-otp-title" class="sil-otp-title">Verification required</div>
      <div class="sil-otp-desc">Enter the one-time code sent to the registered contact.</div>
      <input type="text" id="sil-otp-input" class="sil-otp-input"
        placeholder="OTP code" maxlength="20" autocomplete="one-time-code"
        inputmode="numeric" aria-label="One-time verification code">
      <button type="button" id="sil-otp-submit-btn" class="sil-otp-submit-btn">Confirm and submit</button>
      <div id="sil-otp-error" class="sil-otp-error" aria-live="polite"></div>
    </div>
  `;
  overlay.appendChild(popup);
  
  popup.style.setProperty("pointer-events", "all", "important");
  popup.querySelectorAll("*").forEach((element) => {
    element.style.setProperty("pointer-events", "all", "important");
    element.style.setProperty("user-select", "auto", "important");
  });
  
  const otpInput = popup.querySelector("#sil-otp-input");
  const submitBtn = popup.querySelector("#sil-otp-submit-btn");
  const errorDiv = popup.querySelector("#sil-otp-error");
  let submitting = false;
  
  const submit = async () => {
    if (submitting) return;
    const otpValue = (otpInput.value || "").trim();
    if (!otpValue) {
      errorDiv.textContent = "Enter the OTP code before confirming.";
      otpInput.focus();
      return;
    }
    submitting = true;
    errorDiv.textContent = "";
    submitBtn.disabled = true;
    submitBtn.textContent = "Submitting...";
    const result = await fillOtpAndSubmit(otpValue);
    if (!result.ok) {
      submitting = false;
      submitBtn.disabled = false;
      submitBtn.textContent = "Confirm and submit";
      errorDiv.textContent = result.error || "OTP submission could not be completed.";
      otpInput.focus();
    }
  };
  
  submitBtn.addEventListener("click", submit);
  otpInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submit();
    }
  });
  setTimeout(() => otpInput?.focus(), 100);
}

function findOtpTermsCheckbox() {
  const configured = findElement(adapter.otpTermsCheckboxSelectors || []);
  if (configured) return configured;
  if (!isStandaloneOtpPage()) return null;
  for (const input of document.querySelectorAll("input[type='checkbox']")) {
    const identity = `${input.id || ""} ${input.name || ""}`.toLowerCase();
    if (/term|condition|accept|agree/.test(identity)) return input;
  }
  return null;
}

function findOtpSubmitButton(otpField) {
  const configured = findElement(adapter.otpSubmitSelectors || []);
  if (configured) return configured;
  const form = otpField?.closest("form");
  return (
    form?.querySelector("button[type='submit'], input[type='submit'], button:not([type])") ||
    document.querySelector("button[type='submit'], input[type='submit']")
  );
}

async function fillOtpAndSubmit(otpValue) {
  try {
    const otpField = findOtpField();
    if (!otpField) {
      reportEvent("login.otp_field_not_found", {}, true);
      return { ok: false, error: "The OTP field was not found on the supplier page." };
    }
    otpField.focus();
    setFieldValue(otpField, otpValue);
    await delay(250);
    if (otpField.value !== otpValue) {
      return { ok: false, error: "The OTP value did not remain in the supplier field." };
    }
    blurField(otpField);
    
    const termsCheckbox = findOtpTermsCheckbox();
    if (termsCheckbox) {
      if (termsCheckbox.tagName === "INPUT" && termsCheckbox.type === "checkbox") {
        if (!termsCheckbox.checked) HTMLElement.prototype.click.call(termsCheckbox);
        await delay(150);
        if (!termsCheckbox.checked) {
          const checkedSetter = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            "checked"
          )?.set;
          checkedSetter?.call(termsCheckbox, true);
          termsCheckbox.dispatchEvent(new Event("input", { bubbles: true }));
          termsCheckbox.dispatchEvent(new Event("change", { bubbles: true }));
        }
      } else {
        HTMLElement.prototype.click.call(termsCheckbox);
      }
      reportEvent("login.otp_terms_ticked", {}, true);
      await delay(350);
    }
    
    const submitButton = findOtpSubmitButton(otpField);
    if (!submitButton) {
      reportEvent("login.otp_submit_button_not_found", {}, true);
      return { ok: false, error: "The OTP submit button was not found." };
    }
    if (submitButton.disabled) {
      await delay(500);
    }
    submitButton.scrollIntoView({ block: "center", inline: "center" });
    submitButton.focus();
    HTMLElement.prototype.click.call(submitButton);
    reportEvent("login.otp_submitted", {}, true);
    
    // NOTE: We intentionally DO NOT call removeLoginOverlay() here.
    // The shield stays active to hide the page until the dashboard loads.
    return { ok: true };
  } catch (error) {
    reportEvent("login.otp_fill_error", { reason: error?.message || "unknown" }, true);
    return { ok: false, error: "OTP submission failed. Please try again." };
  }
}

/* ==================================================================
LOGIN FAILURE DETECTION
================================================================== */
const LOGIN_ERROR_PATTERNS = [
  "invalid username or password", "invalid credentials", "incorrect password",
  "incorrect username", "wrong password", "wrong username", "login failed",
  "authentication failed", "sign in failed", "sign-in failed", "access denied",
  "account locked", "account disabled", "account blocked", "too many attempts",
  "user not found", "unable to login", "unable to sign in", "invalid login",
  "bad credentials", "password is incorrect", "username is incorrect",
  "the password you entered is incorrect", "the username you entered is incorrect",
  "please check your credentials", "credentials are invalid", "not authorized", "unauthorized"
];

const LOGIN_ERROR_SELECTORS = [
  ".error-message", ".login-error", ".alert-danger", ".alert-error",
  "[class*='error-msg' i]", "[class*='login-error' i]", "[class*='auth-error' i]",
  "[role='alert']", ".notification-error", ".form-error", ".field-error"
];

function checkForLoginError() {
  if (loginErrorDetected) return;
  if (!loginFilled) return;
  
  for (const selector of adapter.loginErrorSelectors || []) {
    try {
      const el = document.querySelector(selector);
      if (el && isElementVisible(el) && el.textContent.trim().length > 0) {
        showLoginErrorBanner(el.textContent.trim().slice(0, 200));
        return;
      }
    } catch { /* Invalid selector or unreadable element. */ }
  }
  
  for (const selector of LOGIN_ERROR_SELECTORS) {
    try {
      const el = document.querySelector(selector);
      if (el && isElementVisible(el) && el.textContent.trim().length > 0) {
        showLoginErrorBanner(el.textContent.trim().slice(0, 200));
        return;
      }
    } catch { /* Invalid selector or unreadable element. */ }
  }
  
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

function showLoginErrorBanner(errorText) {
  if (loginErrorDetected) return;
  loginErrorDetected = true;
  removeLoginOverlay();
  const existing = document.getElementById("sil-login-error-banner");
  if (existing) existing.remove();
  
  const safeText = (errorText || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .trim();
    
  const banner = document.createElement("div");
  banner.id = "sil-login-error-banner";
  banner.innerHTML = `<span class="sil-error-icon">⚠</span> <span>Login failed${safeText ? " — " + safeText : ""}. Please check credentials in .env or contact your supervisor.</span> <button class="sil-error-dismiss">Dismiss</button>`;
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
LOGIN FORM INSPECTION
================================================================== */
function inspectLoginForm() {
  const { username, password } = findLoginFields();
  if (!username || !password) return;
  reportEvent("login.form_detected", {}, true);
  if (credentialRequestSent) return;
  
  try {
    if (sessionStorage.getItem("sil-credentials-attempted") === "true") {
      credentialRequestSent = true;
      loginFilled = true;
      removeLoginOverlay();
      reportEvent("login.redirect_after_credentials", {}, true);
      setTimeout(() => {
        if (!loginErrorDetected) {
          showLoginErrorBanner(
            "Login was not successful — the login page reappeared after submitting credentials. Check the credentials mapped to this supplier card."
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
BOOKING CONFIRMATION
================================================================== */
function bookingConfirmationVisible() {
  if ((adapter.confirmationSelectors || []).some((s) => document.querySelector(s))) {
    return true;
  }
  const pageText = (document.body.innerText || "").toLowerCase();
  return (adapter.confirmationText || []).some((text) => pageText.includes(text));
}

/* ==================================================================
DASHBOARD / POST-LOGIN DETECTION
================================================================== */
let loginFormGoneCount = 0;

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
EVENT REPORTING
================================================================== */
function reportEvent(eventType, metadata = {}, once = false) {
  if (once && reportedEventKeys.has(eventType)) return;
  if (once) reportedEventKeys.add(eventType);
  if (DEV_MODE) {
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
EVENT LISTENERS
================================================================== */
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
CREDENTIAL FILL HANDLER
================================================================== */
async function runCredentialFill(message) {
  const { username, password } = findLoginFields();
  if (!username || !password) {
    reportEvent("login.form_not_found", {}, true);
    return;
  }
  const usernameValue = message.payload.username;
  const passwordValue = message.payload.password;
  const shouldAutoSubmit = Boolean(message.payload.autoSubmit || adapter.forceAutoSubmit);
  const submitDelay = Number(adapter.submitDelay || 500);
  const typingOptions = adapter.credentialTyping || {};
  
  showLoginOverlay();
  maskField(username);
  maskField(password);
  if (!DEV_MODE) {
    maskGuard.observe(username, { attributes: true, attributeFilter: ["data-sil-masked"] });
    maskGuard.observe(password, { attributes: true, attributeFilter: ["data-sil-masked"] });
  }
  
  const fillAccount = message?.payload?.account || (sessionAccount && sessionAccount()) || null;
  setFieldValue(username, "");
  maskField(username);
  
  try {
    await typeFieldCharByChar(username, usernameValue, typingOptions);
    reportEvent("login.username_filled", {}, true);
    await delay(150);
    setFieldValue(password, "");
    maskField(password);
    await typeFieldCharByChar(password, passwordValue, typingOptions);
    reportEvent("login.password_filled", {}, true);
  } catch (error) {
    if (adapter.requireVerifiedCredentialTyping) {
      loginFilled = false;
      removeLoginOverlay();
      reportEvent("login.verified_typing_failed", { reason: error.message || "unknown" }, true);
      showLoginErrorBanner("Credential fields did not remain stable. Login was not submitted.");
      return;
    }
    reportEvent("login.fill_fallback_to_setfieldvalue", { reason: error.message || "unknown" }, true);
    setFieldValue(username, usernameValue);
    maskField(username);
    setFieldValue(password, passwordValue);
    maskField(password);
    reportEvent("login.password_filled", {}, true);
  }
  
  blurField(username);
  blurField(password);
  loginFilled = true;
  reportEvent("login.credentials_filled", {}, true);
  
  _sessionAccountValue = fillAccount || (_sessionAccountValue && sessionAccount()) || null;
  const account = sessionAccount() || "unknown";
  try {
    sessionStorage.setItem(`sil-credentials-attempted:${account}`, "true");
  } catch { /* sessionStorage may be blocked; not critical. */ }
  
  setTimeout(() => {
    if (overlayActive) {
      removeLoginOverlay();
      showLoginErrorBanner("Login is taking too long — the supplier may be unresponsive. Please try again.");
    }
  }, 25000);
  
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
          reportEvent("login.checkbox_ticked", { selector, method: "input" }, true);
        }
        break;
      }
      el.click();
      reportEvent("login.checkbox_ticked", { selector, method: "wrapper_click" }, true);
      break;
    } catch { /* Unreadable or removed element; skip. */ }
  }
  
  if (shouldAutoSubmit) {
    const form = password.closest("form") || username.closest("form");
    const submitButton = findLoginSubmitButton(form);
    reportEvent(
      "login.auto_submit_attempted",
      { method: submitButton ? "button.click" : "form.requestSubmit", selectorConfigured: Boolean(submitButton) },
      true
    );
    setTimeout(() => {
      clickLoginSubmit(form, submitButton);
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

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "SUPPLIER_RESET_SESSION_STATE") return;
  const resetAccount = message?.payload?.account || sessionAccount() || "unknown";
  try {
    sessionStorage.removeItem(`sil-credentials-attempted:${resetAccount}`);
  } catch { /* sessionStorage may be blocked. */ }
  
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
  
  const oldOverlay = document.getElementById("sil-login-overlay");
  if (oldOverlay) oldOverlay.remove();
  const oldOtpNotice = document.getElementById("sil-otp-notice");
  if (oldOtpNotice) oldOtpNotice.remove();
  const oldOtpPopup = document.getElementById("sil-otp-popup");
  if (oldOtpPopup) oldOtpPopup.remove();
  const oldErrorBanner = document.getElementById("sil-login-error-banner");
  if (oldErrorBanner) oldErrorBanner.remove();
  reportedEventKeys.clear();
});

/* ==================================================================
MUTATION OBSERVER
================================================================== */
const observer = new MutationObserver(() => {
  dismissCookieBanner();
  handlePreLoginStep();
  inspectLoginForm();
  checkForOtp();
  checkForLoginError();
  checkLoginComplete();
  if (bookingConfirmationVisible()) {
    reportEvent("booking.confirmation_detected", {}, true);
  }
});
observer.observe(document.documentElement, { childList: true, subtree: true });

/* ==================================================================
INITIAL CHECKS ON LOAD
================================================================== */
dismissCookieBanner();
checkForOtp();
setTimeout(() => {
  dismissCookieBanner();
  markCookieDoneIfBannerAbsent();
  handlePreLoginStep();
  inspectLoginForm();
  checkForOtp();
}, adapter.cookieDelay || 800);

setTimeout(() => {
  markCookieDoneIfBannerAbsent();
  handlePreLoginStep();
  inspectLoginForm();
  checkForOtp();
}, (adapter.cookieDelay || 800) + (adapter.preLoginDelay || 1000));

/* ==================================================================
PAGE NAVIGATION — cleanup on full page loads
================================================================== */
window.addEventListener("beforeunload", () => {
  if (loginFilled && !fieldsWiped) wipeFieldValues();
});