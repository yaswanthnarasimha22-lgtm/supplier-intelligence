// W2M adapter (Account 1 card).
//
// W2M flow: Cookie Accept (Didomi) -> Username -> Password -> Tick Checkbox
// -> Login -> OTP. OTP is entered manually by the agent; the extension only
// detects and reports it.
globalThis.SupplierAdapters ??= {};

globalThis.SupplierAdapters.w2m = {
  matches: (hostname) =>
    hostname === "dmc.w2m.travel" ||
    hostname.endsWith(".w2m.travel"),

  cookieAcceptSelectors: [
    "#didomi-notice-agree-button",
    "button[id='didomi-notice-agree-button']",
    "[class*='didomi'] button[id*='agree']"
  ],

  preLoginSelectors: [],

  // Live-inspected selectors from the Angular Material form.
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
    "button .mdc-button__label",
    "button[type='submit']"
  ],

  // Checkbox that must be ticked before login will work.
  // Angular Material: clicking the mat-checkbox wrapper or its label is more
  // reliable than clicking the hidden native input directly.
  preSubmitCheckboxSelectors: [
    "mat-checkbox label",
    "mat-checkbox .mdc-checkbox",
    "mat-checkbox",
    "#mat-mdc-checkbox-0-input",
    "input[id='mat-mdc-checkbox-0-input']",
    "input[type='checkbox'].mdc-checkbox__native-control"
  ],

  // OTP selectors — the extension shows a secure popup for the agent to enter
  // the code; it is then auto-filled and the form is submitted automatically.
  otpSelectors: [
    "#prehome-login-multi-login-box-_ctl1_pageBody_MultiLoginBox_agencyLoginBox-verificationCode",
    "input[id*='verificationCode' i]",
    "input[name*='verification' i]",
    "input[name*='otp' i]",
    "input[id*='otp' i]",
    "input[name*='code' i]"
  ],

  // Terms-and-conditions checkbox that must be ticked before the OTP submit
  // button becomes active on b2dmc.w2m.travel/users/login.aspx.
  // Note: the ID contains a literal space, escaped as "\ " in CSS selectors.
  otpTermsCheckboxSelectors: [
    "#prehome-login-multi-login-box-_ctl1_pageBody_MultiLoginBox_agencyLoginBox-terms\\ and\\ conditions",
    "input[id*='terms'][type='checkbox']",
    "input[id*='condition'][type='checkbox']",
    "input[name*='terms'][type='checkbox']"
  ],

  // Login button on the OTP page that submits the code + checkbox.
  otpSubmitSelectors: [
    "#prehome-login-multi-login-box-agency-panel > div > div:nth-child(5) > div.col-xs-4.pull-right.text-right > button",
    "#prehome-login-multi-login-box-agency-panel button[type='submit']",
    "#prehome-login-multi-login-box-agency-panel button"
  ],

  // Supplier-specific error selector — "Incorrect password" paragraph.
  loginErrorSelectors: [
    "p.section-hero__content-box-error",
    ".section-hero__content-box-error",
    "form p[class*='error' i]"
  ],

  hideAfterCredentialFillSelectors: [],
  confirmationSelectors: [],
  confirmationText: [
    "booking confirmed",
    "booking reference"
  ],

  cookieDelay: 2000,
  preLoginDelay: 0
};

// W2M Account 2 card shares the same domain and selectors but must use a
// different backend account (W2M2_USERNAME / W2M2_PASSWORD).
globalThis.SupplierAdapters.w2m2 = globalThis.SupplierAdapters.w2m;

