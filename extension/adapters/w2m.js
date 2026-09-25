// W2M adapter for both account cards.
globalThis.SupplierAdapters ??= {};
globalThis.SupplierAdapters.w2m = {
  matches: (hostname) =>
    hostname === "w2m.travel" || hostname.endsWith(".w2m.travel"),
  cookieAcceptSelectors: [
    "#didomi-notice-agree-button",
    "button[id='didomi-notice-agree-button']",
    "[class*='didomi'] button[id*='agree']"
  ],
  preLoginSelectors: [],
  usernameSelectors: [
    "#mat-input-0",
    "input[id='mat-input-0']",
    "input[formcontrolname='email']",
    "input[name='email']"
  ],
  passwordSelector:
    "#mat-input-1, input[id='mat-input-1'], input[formcontrolname='password'], input[name='password'], input[type='password']",
  loginSubmitSelectors: [
    "w2m-button > w2m-link > button",
    "w2m-button w2m-link button",
    "w2m-button button",
    "form .section-hero__content-box-button button",
    "button[type='submit']"
  ],
  preSubmitCheckboxSelectors: [
    "mat-checkbox label",
    "mat-checkbox .mdc-checkbox",
    "mat-checkbox",
    "#mat-mdc-checkbox-0-input",
    "input[type='checkbox'].mdc-checkbox__native-control"
  ],
  otpSelectors: [
    "input[id*='verificationCode' i]",
    "input[id*='verification' i]",
    "input[name*='verification' i]",
    "input[id*='otp' i]",
    "input[name*='otp' i]",
    "input[id*='securityCode' i]",
    "input[name*='securityCode' i]",
    "#prehome-login-multi-login-box-agency-panel input[id*='code' i]:not([type='hidden'])",
    "#prehome-login-multi-login-box-agency-panel input[name*='code' i]:not([type='hidden'])"
  ],
  otpTermsCheckboxSelectors: [
    "input[id*='terms and conditions' i]",
    "input[id*='terms' i]",
    "input[name*='terms' i]",
    "#prehome-login-multi-login-box-agency-panel input[type='checkbox']"
  ],
  otpSubmitSelectors: [
    "#prehome-login-multi-login-box-agency-panel > div > div:nth-child(5) > div.col-xs-4.pull-right.text-right > button",
    "#prehome-login-multi-login-box-agency-panel button[type='submit']",
    "#prehome-login-multi-login-box-agency-panel input[type='submit']",
    "#prehome-login-multi-login-box-agency-panel button",
    "form button[type='submit']",
    "form input[type='submit']"
  ],
  loginErrorSelectors: [
    "p.section-hero__content-box-error",
    ".section-hero__content-box-error",
    "form p[class*='error' i]"
  ],
  hideAfterCredentialFillSelectors: [],
  confirmationSelectors: [],
  confirmationText: ["booking confirmed", "booking reference"],
  cookieDelay: 2000,
  preLoginDelay: 0
};
globalThis.SupplierAdapters.w2m2 = globalThis.SupplierAdapters.w2m;