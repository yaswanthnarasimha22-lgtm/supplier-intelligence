globalThis.SupplierAdapters ??= {};

globalThis.SupplierAdapters.stours = {
  matches: (hostname) =>
    hostname === "stours-extranet.cyberlogic.cloud" ||
    hostname.endsWith(".cyberlogic.cloud"),

  /* Username → Password → Login (no cookie step) */
  cookieAcceptSelectors: [],

  preLoginSelectors: [],

  usernameSelectors: [
    "auth-sign-in form div.dx-field input",
    "auth-sign-in input[type='text']",
    "input[name*='user' i]",
    "input[type='email']",
    "input[type='text']"
  ],

  passwordSelector:
    "auth-sign-in form div.relative input, auth-sign-in input[type='password'], input[type='password']",

  loginSubmitSelectors: [
    "auth-sign-in form button.mat-flat-button.mat-primary",
    "auth-sign-in button[type='submit']",
    "button.mat-flat-button.mat-primary",
    "button[type='submit']"
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
