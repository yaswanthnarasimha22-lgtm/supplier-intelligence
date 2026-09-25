/*
 * auth.js — hybrid authentication for the Supplier Session Launcher UI.
 *
 * Two providers are supported side-by-side:
 *
 *   1. STATIC       — the original hard-coded agent accounts used for local
 *                     development and demos.  Passwords are compared verbatim
 *                     against the STATIC_USERS table below.
 *
 *   2. COGNITO      — the shared AWS Cognito User Pool used by our other
 *                     applications.  Login is performed against the Cognito
 *                     Identity Provider REST API using the USER_PASSWORD_AUTH
 *                     flow, exactly as AWS Amplify does under the hood.  The
 *                     Cognito access token is stored on the session object so
 *                     downstream API requests can send it as a Bearer token.
 *
 * The login flow keeps the same function names and shapes as before so callers
 * (login.js, app.js, SupplierLaunchButton.jsx) can stay unchanged.
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// Public configuration for the shared Cognito User Pool.  These values are
// safe to embed in the browser — they identify the pool/client only, not the
// pool's admin credentials.
export const COGNITO_CONFIG = Object.freeze({
  region: "eu-west-1",
  userPoolId: "eu-west-1_1yghGdnkD",
  clientId: "5e80b7ijtpsgfgt4sjnktakmqr",
  domain: "https://dynamic-tt-uat.auth.eu-west-1.amazoncognito.com",
  jwksUrl:
    "https://cognito-idp.eu-west-1.amazonaws.com/eu-west-1_jkKnSFsS1/.well-known/jwks.json"
});

const COGNITO_ENDPOINT = `https://cognito-idp.${COGNITO_CONFIG.region}.amazonaws.com/`;

// Static / demo accounts.  These continue to work alongside Cognito so local
// development, automated testing, and offline demos do not depend on the AWS
// network being reachable.
const STATIC_USERS = [
  { username: "admin",   password: "Teletext@2026", displayName: "Administrator" },
  { username: "agent1",  password: "Agent@2026",    displayName: "Agent One"     },
  { username: "agent2",  password: "Agent@2026",    displayName: "Agent Two"     },
  { username: "trainer", password: "Trainer@2026",  displayName: "Trainer"       }
];

const SESSION_KEY = "sil-auth-session";

// ---------------------------------------------------------------------------
// Cognito REST helpers
// ---------------------------------------------------------------------------

async function cognitoRequest(action, payload) {
  const response = await fetch(COGNITO_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Target": `AWSCognitoIdentityProviderService.${action}`
    },
    body: JSON.stringify(payload)
  });

  let body = {};
  try { body = await response.json(); } catch { body = {}; }

  if (!response.ok) {
    const code = body.__type || `HTTP_${response.status}`;
    const message = body.message || body.Message || "Cognito request failed";
    const err = new Error(message);
    err.code = code;
    throw err;
  }
  return body;
}

function mapCognitoError(error) {
  const code = String(error?.code || "").split("#").pop();
  switch (code) {
    case "NotAuthorizedException":
      return "Invalid username or password.";
    case "UserNotFoundException":
      return "That user does not exist.";
    case "UserNotConfirmedException":
      return "Your account has not been confirmed yet.";
    case "PasswordResetRequiredException":
      return "Your password must be reset before you can sign in.";
    case "TooManyRequestsException":
    case "TooManyFailedAttemptsException":
      return "Too many attempts. Please wait a moment and try again.";
    case "InvalidParameterException":
      return error?.message || "Invalid sign-in details.";
    default:
      return error?.message || "Sign-in failed. Please try again.";
  }
}

// ---------------------------------------------------------------------------
// Session persistence
// ---------------------------------------------------------------------------

function persistSession(session) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    /* sessionStorage may be blocked; the caller still gets the object */
  }
}

function buildStaticSession(user) {
  return {
    username: user.username,
    displayName: user.displayName,
    signedInAt: new Date().toISOString(),
    authProvider: "static"
  };
}

function buildCognitoSession(username, authResult) {
  return {
    username: username.trim(),
    displayName: username.trim(),
    signedInAt: new Date().toISOString(),
    authProvider: "cognito",
    tokens: {
      accessToken: authResult.AccessToken || null,
      idToken: authResult.IdToken || null,
      refreshToken: authResult.RefreshToken || null,
      tokenType: authResult.TokenType || "Bearer",
      expiresIn: authResult.ExpiresIn || null,
      issuedAt: new Date().toISOString()
    }
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Attempt to sign a user in.
 *
 * The result is always an object so callers can distinguish between:
 *   - success       -> { ok: true,  session }
 *   - MFA / etc.    -> { ok: false, challenge: "SMS_MFA" | "NEW_PASSWORD_REQUIRED" | ...,
 *                        cognitoSession, challengeParams, username }
 *   - failure       -> { ok: false, error }
 *
 * Static credentials are checked first so demo/agent test logins keep working
 * without touching AWS.  Anything that does not match a static user falls
 * through to Cognito.
 */
export async function attemptLogin(username, password) {
  const trimmedUsername = (username || "").trim();

  // 1. Static / demo accounts — kept for local development.
  const staticUser = STATIC_USERS.find(
    (u) => u.username === trimmedUsername && u.password === password
  );
  if (staticUser) {
    const session = buildStaticSession(staticUser);
    persistSession(session);
    return { ok: true, session };
  }

  // 2. Cognito User Pool.
  try {
    const result = await cognitoRequest("InitiateAuth", {
      AuthFlow: "USER_PASSWORD_AUTH",
      ClientId: COGNITO_CONFIG.clientId,
      AuthParameters: {
        USERNAME: trimmedUsername,
        PASSWORD: password
      }
    });

    if (result.AuthenticationResult) {
      const session = buildCognitoSession(trimmedUsername, result.AuthenticationResult);
      persistSession(session);
      return { ok: true, session };
    }

    if (result.ChallengeName) {
      return {
        ok: false,
        challenge: result.ChallengeName,
        cognitoSession: result.Session,
        challengeParams: result.ChallengeParameters || {},
        username: trimmedUsername
      };
    }

    return { ok: false, error: "Unexpected response from the identity provider." };
  } catch (error) {
    return { ok: false, error: mapCognitoError(error) };
  }
}

/**
 * Continue a Cognito authentication after a challenge (e.g. MFA code,
 * NEW_PASSWORD_REQUIRED).  Returns the same shape as attemptLogin so the
 * calling code can loop until it either succeeds or fails cleanly.
 */
export async function respondToChallenge({
  challenge,
  cognitoSession,
  username,
  responses
}) {
  try {
    const result = await cognitoRequest("RespondToAuthChallenge", {
      ChallengeName: challenge,
      ClientId: COGNITO_CONFIG.clientId,
      Session: cognitoSession,
      ChallengeResponses: {
        USERNAME: username,
        ...responses
      }
    });

    if (result.AuthenticationResult) {
      const session = buildCognitoSession(username, result.AuthenticationResult);
      persistSession(session);
      return { ok: true, session };
    }

    if (result.ChallengeName) {
      return {
        ok: false,
        challenge: result.ChallengeName,
        cognitoSession: result.Session,
        challengeParams: result.ChallengeParameters || {},
        username
      };
    }

    return { ok: false, error: "Unexpected response from the identity provider." };
  } catch (error) {
    return { ok: false, error: mapCognitoError(error) };
  }
}

export function currentSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Return the Cognito access token, or null when the current session is a
 * static/demo login.  Callers can pass this to `fetch` via
 *   Authorization: `Bearer ${token}`
 */
export function accessToken() {
  const session = currentSession();
  return session?.tokens?.accessToken || null;
}

/**
 * Add the Bearer token, if any, onto a fetch `init` object.  Static-user
 * sessions have no Cognito token, so protected API calls should treat a
 * missing token as "development mode" on the server side.
 */
export function withAuth(init = {}) {
  const token = accessToken();
  if (!token) return init;
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Bearer ${token}`);
  return { ...init, headers };
}

export async function signOut() {
  const session = currentSession();
  const token = session?.tokens?.accessToken;

  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }

  // Best-effort global sign-out on Cognito; do not block the UI if it fails.
  if (token) {
    try {
      await cognitoRequest("GlobalSignOut", { AccessToken: token });
    } catch {
      /* Network error or already-expired token — ignore. */
    }
  }
}

/**
 * Redirect to the login page unless a valid session exists.
 * Returns the session object when signed in, or `null` after redirecting.
 */
export function requireSession() {
  const session = currentSession();
  if (session) return session;
  window.location.replace("/web-app/login.html");
  return null;
}
