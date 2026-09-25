globalThis.SupplierAdapters ??= {};

globalThis.SupplierAdapters.yalago = {
  matches: (hostname) =>
    hostname === "yalago.com" ||
    hostname === "affiliate.yalago.com" ||
    hostname.endsWith(".yalago.com"),

  /*
   * The startUrl already lands on the login form (#loginForm),
   * so no preLoginSelectors needed.
   * Flow: Cookie Accept → Username → Password → Login → OTP → Submit OTP
   */
  cookieAcceptSelectors: [
    "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
    "[id*='cookie'] button[id*='accept']",
    "[class*='cookie'] button",
    "button[id*='accept']"
  ],

  /*
   * The "Client Login" button in the header must be clicked to reveal
   * the login form. Exact selector from live inspection added first.
   */
  preLoginSelectors: [
    "#landingRoot > div > div > div > header > div > div > div.MuiGrid-root.MuiGrid-item.MuiGrid-grid-xs-2 > a > button",
    "#landingRoot header a > button",
    "header a > button.MuiButton-root",
    "header button.MuiButton-root",
    "a[href='#loginForm']",
    "a[href*='loginForm']"
  ],

  preLoginButtonText: [
    "Client Login"
  ],

  /* Live-inspected selectors from the MUI login form */
  usernameSelectors: [
    "#username",
    "input[id='username']",
    "input[autocomplete='username']",
    "input[aria-describedby='username-helper-text']"
  ],

  passwordSelector:
    "#password, input[id='password'], input[autocomplete='current-password'], input[type='password']",

  loginSubmitSelectors: [
    "#landingRoot form button.MuiButton-contained",
    "form button.MuiButton-root.MuiButton-contained",
    "button.MuiButton-contained",
    "form button[type='submit']",
    "button[type='submit']"
  ],

  /* OTP selectors — when detected, agent enters manually */
  otpSelectors: [
    "input[name*='otp' i]",
    "input[name*='verification' i]",
    "input[id*='otp' i]",
    "input[id*='verification' i]",
    "input[name*='code' i]",
    "input[id*='code' i]",
    "input[type='tel']"
  ],

  /* Supplier-specific error selectors */
  loginErrorSelectors: [
    "#client-snackbar",
    "span[id='client-snackbar']",
    "[class*='snackbar'] span",
    ".MuiSnackbar-root span"
  ],

  hideAfterCredentialFillSelectors: [],

  preSubmitCheckboxSelectors: [],

  confirmationSelectors: [],

  confirmationText: [
    "booking confirmed",
    "booking reference"
  ],

  cookieDelay: 1500,
  preLoginDelay: 2000
};