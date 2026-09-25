// Hotelbeds adapter (Account 1 card).
//
// Both hotelbeds and hotelbeds2 cards point at the same domain, so this
// adapter matches any hotelbeds.com page. The account is distinguished by the
// backend session/supplier key, not by the adapter.
globalThis.SupplierAdapters ??= {};

globalThis.SupplierAdapters.hotelbeds = {
  matches: (hostname) =>
    hostname === "hotelbeds.com" ||
    hostname.endsWith(".hotelbeds.com"),

  cookieAcceptSelectors: [
    "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll"
  ],

  // Multi-step pre-login flow on discover.hotelbeds.com:
  //  step 1 -> click the header login trigger
  //  step 2 -> click "CLIENTS LOGIN"
  preLoginSteps: [
    {
      selectors: [
        "#__next > div > header > div.main-header-wrapper > div > nav > ul > li:nth-child(3) > div > span",
        "#__next header nav span.button_curl_login",
        "header span.button_curl_login",
        "header nav .button_curl_login",
        "span.hb-btn.button_curl_login"
      ],
      buttonText: []
    },
    {
      selectors: [
        "#__next > div > header > div.megamenu_hotelbeds_hotelbedsContainer__rtie8 > div > div > div > div.megamenu__content > div.megamenu__items > ul > li:nth-child(2) > div > a",
        "a.megamenu__second-level-label[href*='app.hotelbeds']",
        ".megamenu__items a[href*='app.hotelbeds.com/auth/login']",
        "a[href*='app.hotelbeds.com/auth/login']"
      ],
      buttonText: ["CLIENTS LOGIN"]
    }
  ],

  preLoginSelectors: [],
  preLoginButtonText: [],

  usernameSelectors: [
    "#username",
    "input[id='username']",
    "input[data-qa='username']",
    "input[formcontrolname='username']",
    "input[name='username']"
  ],

  passwordSelector:
    "#password, input[id='password'], input[data-qa='password'], input[formcontrolname='password'], input[type='password']",

  loginSubmitSelectors: [
    "button[data-qa='login-button']",
    "clientb2b-front-login-form form div > button",
    "clientb2b-front-login-form form button",
    "clientb2b-front-content-container form button",
    "form button",
    "button[type='submit']"
  ],

  loginErrorSelectors: [
    "hb-notification-title",
    ".hb-notification__title",
    ".hb-notification__content",
    "hb-notification-body",
    ".hb-notification__body"
  ],

  otpSelectors: [],
  preSubmitCheckboxSelectors: [],
  hideAfterCredentialFillSelectors: [],

  confirmationSelectors: [
    "[data-testid*='confirmation' i]",
    "[class*='booking-confirmation' i]"
  ],
  confirmationText: [
    "booking confirmed",
    "booking confirmation",
    "booking reference"
  ],

  // Require verified character-by-character typing; Hotelbeds Angular forms
  // are sensitive to rapid bulk writes.
  requireVerifiedCredentialTyping: true,
  forceAutoSubmit: true,
  submitDelay: 700,
  credentialTyping: {
    charDelay: 90,
    verifyDelay: 130,
    stableChecks: 4,
    maxRestarts: 3
  },
  cookieDelay: 1500,
  preLoginDelay: 2000
};

// Hotelbeds Account 2 card uses the same domain and the same selectors, but a
// different backend supplier key. The adapter match function is shared, so we
// alias it under the account-2 key as well.
//
// This does not merge credentials. Credentials are still resolved by the
// supplier key on the backend (HOTELBEDS2_USERNAME / HOTELBEDS2_PASSWORD).
globalThis.SupplierAdapters.hotelbeds2 = globalThis.SupplierAdapters.hotelbeds;

