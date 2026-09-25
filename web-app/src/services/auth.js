/*
 * auth.js — static credential store for the launcher UI.
 *
 * This is a prototype / demo authentication layer.  Credentials are hard-
 * coded and matched client-side; there is no server verification.  Replace
 * with a real identity provider (Chrome Enterprise SSO, Azure AD, etc.)
 * before production use.
 */

// Add / edit agent accounts here.  Passwords are compared verbatim.
const STATIC_USERS = [
  { username: "admin",   password: "Teletext@2026", displayName: "Administrator" },
  { username: "agent1",  password: "Agent@2026",    displayName: "Agent One"     },
  { username: "agent2",  password: "Agent@2026",    displayName: "Agent Two"     },
  { username: "trainer", password: "Trainer@2026",  displayName: "Trainer"       }
];

const SESSION_KEY = "sil-auth-session";

export function attemptLogin(username, password) {
  const found = STATIC_USERS.find(
    (u) => u.username === (username || "").trim() && u.password === password
  );
  if (!found) return null;

  const session = {
    username: found.username,
    displayName: found.displayName,
    signedInAt: new Date().toISOString()
  };

  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    /* sessionStorage may be blocked; the caller still gets the object */
  }
  return session;
}

export function currentSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function signOut() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
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
