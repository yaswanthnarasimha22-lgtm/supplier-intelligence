globalThis.SupplierAdapters ??= {};

globalThis.SupplierAdapters.sunhotels = {
  matches: (hostname) =>
    hostname === "sunhotels.com" ||
    hostname === "www.sunhotels.com" ||
    hostname.endsWith(".sunhotels.com"),

  /* Username → Password → Login → Dashboard */
  cookieAcceptSelectors: [],

  preLoginSelectors: [],

  usernameSelectors: [
    "#LoginUsername",
    "input[id='LoginUsername']",
    "input[name*='username' i]"
  ],

  passwordSelector:
    "#LoginPassword, input[id='LoginPassword'], input[type='password']",

  loginSubmitSelectors: [
    "#login-button",
    "button[id='login-button']",
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

  cookieDelay: 500,
  preLoginDelay: 0
};
