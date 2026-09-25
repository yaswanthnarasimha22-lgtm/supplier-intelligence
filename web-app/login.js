import {
  attemptLogin,
  respondToChallenge,
  currentSession
} from "./src/services/auth.js";

/* Already signed in? Skip straight to the launcher. */
if (currentSession()) {
  window.location.replace("/web-app/index.html");
}

const loginForm       = document.querySelector("#login-form");
const usernameInput   = document.querySelector("#login-username");
const passwordInput   = document.querySelector("#login-password");
const errorBox        = document.querySelector("#login-error");
const submitBtn       = loginForm.querySelector(".auth-submit");

const challengeForm   = document.querySelector("#challenge-form");
const challengeMsg    = document.querySelector("#challenge-message");
const codeField       = document.querySelector("#challenge-code-field");
const codeInput       = document.querySelector("#challenge-code");
const newPassField    = document.querySelector("#challenge-newpass-field");
const newPassInput    = document.querySelector("#challenge-newpass");
const challengeError  = document.querySelector("#challenge-error");
const challengeSubmit = challengeForm.querySelector(".auth-submit");

let pendingChallenge = null;

function showError(box, message) {
  box.textContent = message;
  box.style.display = "block";
}
function hideError(box) {
  box.textContent = "";
  box.style.display = "none";
}

function resetPrimarySubmit() {
  submitBtn.disabled = false;
  submitBtn.textContent = "Sign in";
}

function resetChallengeSubmit() {
  challengeSubmit.disabled = false;
  challengeSubmit.textContent = "Confirm";
}

function goToLauncher() {
  submitBtn.textContent = "Success — redirecting…";
  window.location.replace("/web-app/index.html");
}

/**
 * Configure the challenge form for the given Cognito challenge and reveal it.
 * Returns `false` if the challenge is not supported by the UI so the caller
 * can surface a friendly message.
 */
function beginChallenge(result) {
  pendingChallenge = result;

  hideError(challengeError);
  codeField.style.display = "none";
  newPassField.style.display = "none";
  codeInput.value = "";
  newPassInput.value = "";

  switch (result.challenge) {
    case "SMS_MFA":
      challengeMsg.textContent = "Enter the verification code sent to your mobile.";
      codeField.style.display = "";
      break;
    case "SOFTWARE_TOKEN_MFA":
      challengeMsg.textContent = "Enter the code from your authenticator app.";
      codeField.style.display = "";
      break;
    case "EMAIL_OTP":
      challengeMsg.textContent = "Enter the verification code sent to your email.";
      codeField.style.display = "";
      break;
    case "NEW_PASSWORD_REQUIRED":
      challengeMsg.textContent = "You must set a new password before continuing.";
      newPassField.style.display = "";
      break;
    default:
      // Unknown / unsupported challenge — surface it on the main form.
      showError(errorBox, `This account requires an additional step (${result.challenge}) that is not supported here yet.`);
      resetPrimarySubmit();
      pendingChallenge = null;
      return false;
  }

  loginForm.style.display = "none";
  challengeForm.style.display = "";
  setTimeout(() => {
    (codeField.style.display === "" ? codeInput : newPassInput).focus();
  }, 30);
  return true;
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  hideError(errorBox);

  const username = usernameInput.value.trim();
  const password = passwordInput.value;

  if (!username || !password) {
    showError(errorBox, "Please enter both username and password.");
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Signing in…";

  let result;
  try {
    result = await attemptLogin(username, password);
  } catch (err) {
    resetPrimarySubmit();
    showError(errorBox, err?.message || "Sign-in failed. Please try again.");
    return;
  }

  if (result.ok) {
    goToLauncher();
    return;
  }

  if (result.challenge) {
    if (!beginChallenge(result)) return;
    // Keep the primary button disabled while the challenge form is up.
    submitBtn.textContent = "Sign in";
    submitBtn.disabled = false;
    return;
  }

  resetPrimarySubmit();
  showError(errorBox, result.error || "Invalid username or password.");
  passwordInput.select();
});

challengeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!pendingChallenge) return;
  hideError(challengeError);

  const responses = {};

  if (pendingChallenge.challenge === "SMS_MFA") {
    const code = codeInput.value.trim();
    if (!code) { showError(challengeError, "Enter the SMS code."); return; }
    responses.SMS_MFA_CODE = code;
  } else if (pendingChallenge.challenge === "SOFTWARE_TOKEN_MFA") {
    const code = codeInput.value.trim();
    if (!code) { showError(challengeError, "Enter the authenticator code."); return; }
    responses.SOFTWARE_TOKEN_MFA_CODE = code;
  } else if (pendingChallenge.challenge === "EMAIL_OTP") {
    const code = codeInput.value.trim();
    if (!code) { showError(challengeError, "Enter the emailed code."); return; }
    responses.EMAIL_OTP_CODE = code;
  } else if (pendingChallenge.challenge === "NEW_PASSWORD_REQUIRED") {
    const newPass = newPassInput.value;
    if (!newPass) { showError(challengeError, "Enter a new password."); return; }
    responses.NEW_PASSWORD = newPass;
  }

  challengeSubmit.disabled = true;
  challengeSubmit.textContent = "Verifying…";

  let next;
  try {
    next = await respondToChallenge({
      challenge: pendingChallenge.challenge,
      cognitoSession: pendingChallenge.cognitoSession,
      username: pendingChallenge.username,
      responses
    });
  } catch (err) {
    resetChallengeSubmit();
    showError(challengeError, err?.message || "Verification failed. Please try again.");
    return;
  }

  if (next.ok) {
    goToLauncher();
    return;
  }

  if (next.challenge) {
    // Another step in the challenge chain (e.g. MFA after NEW_PASSWORD_REQUIRED).
    resetChallengeSubmit();
    beginChallenge(next);
    return;
  }

  resetChallengeSubmit();
  showError(challengeError, next.error || "Verification failed. Please try again.");
});
