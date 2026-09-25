globalThis.SupplierAdapters ??= {};

globalThis.SupplierAdapters.alturabeds = {
  matches: (hostname) =>
    hostname === "alturabeds.com" ||
    hostname === "www.alturabeds.com" ||
    hostname.endsWith(".alturabeds.com"),

  /* Cookie Accept → Sign In (opens modal) → Username → Password → Login Submit */
  cookieAcceptSelectors: [
    "#acceptCookies",
    "button[id='acceptCookies']",
    "[class*='cookie'] button"
  ],

  preLoginSelectors: [
    "#navbarContent > ul > li:nth-child(6) > a",
    "a[data-target*='login' i]",
    "a[href*='login' i]",
    "[class*='sign-in']",
    "[class*='signin']"
  ],

  usernameSelectors: [
    "#loginForm > div:nth-child(2) > input[type=text]",
    "#loginForm input[type='text']",
    "input[name*='user' i]"
  ],

  passwordSelector:
    "#loginForm > div:nth-child(3) > input[type=password], #loginForm input[type='password'], input[type='password']",

  loginSubmitSelectors: [
    "#loginForm > div.modal_btn.px-2 > button",
    "#loginForm button[type='submit']",
    "#loginForm button",
    "button[type='submit']"
  ],

  otpSelectors: [],

  hideAfterCredentialFillSelectors: [],

  confirmationSelectors: [],

  confirmationText: [
    "booking confirmed",
    "booking reference"
  ],

  cookieDelay: 1200,
  preLoginDelay: 1500
};
