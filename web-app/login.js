import { attemptLogin, currentSession } from "./src/services/auth.js";

/* Already signed in? Skip straight to the launcher. */
if (currentSession()) {
  window.location.replace("/web-app/index.html");
}

const form = document.querySelector("#login-form");
const usernameInput = document.querySelector("#login-username");
const passwordInput = document.querySelector("#login-password");
const errorBox = document.querySelector("#login-error");
const submitBtn = form.querySelector(".auth-submit");

function showError(message) {
  errorBox.textContent = message;
  errorBox.style.display = "block";
}

function hideError() {
  errorBox.textContent = "";
  errorBox.style.display = "none";
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  hideError();

  const username = usernameInput.value.trim();
  const password = passwordInput.value;

  if (!username || !password) {
    showError("Please enter both username and password.");
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Signing in…";

  const session = attemptLogin(username, password);

  if (!session) {
    submitBtn.disabled = false;
    submitBtn.textContent = "Sign in";
    showError("Invalid username or password.");
    passwordInput.select();
    return;
  }

  submitBtn.textContent = "Success — redirecting…";
  window.location.replace("/web-app/index.html");
});
