globalThis.SupplierAdapters ??= {};

globalThis.SupplierAdapters.sunInternational = {
  matches: (hostname) =>
    hostname === "suninternationaltt.com" ||
    hostname.endsWith(".suninternationaltt.com") ||
    hostname === "sunegypt.com" ||
    hostname === "www.sunegypt.com" ||
    hostname.endsWith(".sunegypt.com"),

  /* Close Cookie → Open Login → Username → Password → Login */
  cookieAcceptSelectors: [
    "#aspnetForm > footer > div.cookie-policy.alert.alert-info > div.cookie-policy__actions > button.btn.btn-secondary.cookie-policy__close",
    ".cookie-policy__close",
    "button.cookie-policy__close",
    ".cookie-policy .btn-secondary"
  ],

  preLoginSelectors: [
    "#upper-menu > div > div > button > span",
    "#upper-menu button",
    "[class*='login-trigger']",
    "[class*='sign-in']"
  ],

  usernameSelectors: [
    "#login-box-user",
    "input[id='login-box-user']",
    "input[name*='user' i]"
  ],

  passwordSelector:
    "#login-box-password, input[id='login-box-password'], input[type='password']",

  loginSubmitSelectors: [
    "#login-box > div.js-login-form-elements > div.login-box__section > div > button",
    "#login-box button[type='submit']",
    "#login-box button",
    ".login-box button",
    "button[type='submit']"
  ],

  otpSelectors: [],

  hideAfterCredentialFillSelectors: [],

  confirmationSelectors: [],

  confirmationText: [
    "booking confirmed",
    "booking reference"
  ],

  cookieDelay: 1500,
  preLoginDelay: 1500
};
