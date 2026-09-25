globalThis.SupplierAdapters ??= {};

globalThis.SupplierAdapters.bedsWithEase = {
  matches: (hostname) =>
    hostname === "bedswithease.com" || hostname.endsWith(".bedswithease.com"),

  /* Close Notification → Username → Password → Login */
  cookieAcceptSelectors: [
    "#app > div.cookies-usage-message > div > i",
    ".cookies-usage-message i",
    "[class*='cookie'] button",
    "[class*='cookie'] i"
  ],

  preLoginSelectors: [],

  usernameSelectors: [
    "#app > div.login-content > form:nth-child(3) > div:nth-child(2) > input",
    "input[name*='user' i]",
    "input[type='email']",
    ".login-content form input[type='text']"
  ],

  passwordSelector:
    "#app > div.login-content > form:nth-child(3) > div:nth-child(3) > input, .login-content form input[type='password'], input[type='password']",

  loginSubmitSelectors: [
    "#app > div.login-content > form:nth-child(3) > button",
    ".login-content form button",
    "button[type='submit']",
    "input[type='submit']"
  ],

  otpSelectors: [],

  hideAfterCredentialFillSelectors: [],

  confirmationSelectors: [],

  confirmationText: [
    "booking confirmed",
    "booking reference"
  ],

  cookieDelay: 1000,
  preLoginDelay: 0
};
