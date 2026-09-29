globalThis.SupplierAdapters ??= {};

/*
 * Alturabeds flow (confirmed 2026-09):
 *
 *   1. Land on https://www.alturabeds.com/en
 *   2. Dismiss cookie banner (#acceptCookies)
 *   3. Click the "Sign in" link in the top navigation to open the
 *      #modal-login-window Bootstrap modal (the login inputs already exist
 *      in the DOM but are hidden until the modal opens — the tracker only
 *      considers pre-login complete when the inputs are visible).
 *   4. Fill #loginForm username + password inside the modal.
 *   5. Click #loginForm > div.modal_btn.px-2 > button.
 *   6. On success the site redirects to /en/home.
 */
globalThis.SupplierAdapters.alturabeds = {
  matches: (hostname) =>
    hostname === "alturabeds.com" ||
    hostname === "www.alturabeds.com" ||
    hostname.endsWith(".alturabeds.com"),

  cookieAcceptSelectors: [
    "#acceptCookies",
    "button[id='acceptCookies']",
    "[class*='cookie'] button"
  ],

  // Header "Sign in" link that opens the modal.  Multiple selectors so a
  // trivial DOM change (a re-ordered nav item) does not break the flow.
  preLoginSelectors: [
    "#navbarContent > ul > li:nth-child(6) > a",
    "a[data-target='#modal-login-window']",
    "a[data-target*='login' i]",
    "header a.btn.login",
    "a[href='#'][class*='login']"
  ],
  preLoginButtonText: ["Sign in", "Sign In", "Login", "Log in"],

  // Inputs live inside #modal-login-window > #loginForm; they exist in the
  // DOM at page load but are invisible until the modal opens.  The tracker
  // now waits for these to be visible before requesting credentials.
  usernameSelectors: [
    "#loginForm > div:nth-child(2) > input[type=text]",
    "#loginForm input[name='username']",
    "#loginForm input[type='text']",
    "#modal-login-window input[name='username']"
  ],

  passwordSelector:
    "#loginForm > div:nth-child(3) > input[type=password], " +
    "#loginForm input[name='password'], " +
    "#loginForm input[type='password'], " +
    "#modal-login-window input[type='password']",

  loginSubmitSelectors: [
    "#loginForm > div.modal_btn.px-2 > button",
    "#loginForm button[type='submit']",
    "#modal-login-window button[type='submit']",
    "#loginForm button"
  ],

  loginErrorSelectors: [
    "#loginForm .alert-danger",
    "#modal-login-window .alert-danger",
    "#loginForm [class*='error' i]",
    "#modal-login-window [class*='error' i]"
  ],

  otpSelectors: [],
  hideAfterCredentialFillSelectors: [],
  confirmationSelectors: [],
  confirmationText: ["booking confirmed", "booking reference"],

  cookieDelay: 1200,
  // Modal open animation is ~300 ms; give the browser plenty of headroom
  // before we consider the pre-login step failed.
  preLoginDelay: 1500
};
