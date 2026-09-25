globalThis.SupplierAdapters ??= {};

globalThis.SupplierAdapters.suntransfers = {
  matches: (hostname) =>
    hostname === "suntransfers.com" ||
    hostname === "www.suntransfers.com" ||
    hostname === "partners.suntransfers.com" ||
    hostname.endsWith(".suntransfers.com"),

  /* Cookie Accept → Username → Password → Login */
  cookieAcceptSelectors: [
    "#onetrust-accept-btn-handler",
    "button[id='onetrust-accept-btn-handler']",
    "[class*='onetrust'] button[id*='accept']"
  ],

  preLoginSelectors: [],

  usernameSelectors: [
    "#st-agencies-user",
    "input[id='st-agencies-user']",
    "input[name*='user' i]"
  ],

  passwordSelector:
    "#st-agencies-password, input[id='st-agencies-password'], input[type='password']",

  loginSubmitSelectors: [
    "#login > form > div:nth-child(3) > div > button",
    "#login form button",
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

  cookieDelay: 1500,
  preLoginDelay: 0
};
