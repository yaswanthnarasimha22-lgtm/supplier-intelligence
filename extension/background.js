// ---------------------------------------------------------------------------
// Background service worker
// ---------------------------------------------------------------------------
//
// On every supplier-card click, this module:
//
// 1. Validates the supplier and start URL.
// 2. Determines the supplier's isolation group.
// 3. Clears the supplier's cookies and site data for every configured origin
//    (including known subdomains such as app.hotelbeds.com and
//    b2dmc.w2m.travel).
// 4. Clears extension session state for that group.
// 5. Creates a clean supplier tab.
// 6. Stores the session using the newly created tab ID.
// 7. Tracks navigation, login activity, and tab closure.
//
// Accounts using the same domain share an isolation group:
//
//   - hotelbeds  and hotelbeds2  -> group "hotelbeds"
//   - w2m        and w2m2        -> group "w2m"
//
// Existing supplier tabs are NOT closed when a new launch happens — agents may
// have multiple suppliers open at once. Session state (cookies, localStorage,
// IndexedDB, service workers) is fully wiped for the launching supplier so
// the new tab always starts unauthenticated.
// ---------------------------------------------------------------------------

const API_ORIGIN = "http://localhost:3000";

// ---------------------------------------------------------------------------
// Supplier configuration
// ---------------------------------------------------------------------------
const SUPPLIER_CONFIG = {
  hotelbeds: {
    domains: ["hotelbeds.com"],
    isolationGroup: "hotelbeds",
    originsToClear: [
      "https://hotelbeds.com",
      "https://www.hotelbeds.com",
      "https://app.hotelbeds.com",
      "https://discover.hotelbeds.com"
    ]
  },
  hotelbeds2: {
    domains: ["hotelbeds.com"],
    isolationGroup: "hotelbeds",
    originsToClear: [
      "https://hotelbeds.com",
      "https://www.hotelbeds.com",
      "https://app.hotelbeds.com",
      "https://discover.hotelbeds.com"
    ]
  },
  bedswithease: {
    domains: ["bedswithease.com"],
    isolationGroup: "bedswithease"
  },
  alturabeds: {
    domains: ["alturabeds.com"],
    isolationGroup: "alturabeds"
  },
  sunhotels: {
    domains: ["sunhotels.com"],
    isolationGroup: "sunhotels"
  },
  suninternational: {
    domains: ["suninternationaltt.com", "sunegypt.com"],
    isolationGroup: "suninternational"
  },
  suntransfers: {
    domains: ["suntransfers.com"],
    isolationGroup: "suntransfers"
  },
  stours: {
    domains: ["cyberlogic.cloud"],
    isolationGroup: "stours"
  },
  yalago: {
    domains: ["yalago.com"],
    isolationGroup: "yalago"
  },
  w2m: {
    domains: ["w2m.travel"],
    isolationGroup: "w2m",
    originsToClear: [
      "https://w2m.travel",
      "https://www.w2m.travel",
      "https://dmc.w2m.travel",
      "https://b2dmc.w2m.travel"
    ]
  },
  w2m2: {
    domains: ["w2m.travel"],
    isolationGroup: "w2m",
    originsToClear: [
      "https://w2m.travel",
      "https://www.w2m.travel",
      "https://dmc.w2m.travel",
      "https://b2dmc.w2m.travel"
    ]
  }
};

// Flatten all configured domains into a unique allow-list.
const ALLOWED_HOSTS = [
  ...new Set(
    Object.values(SUPPLIER_CONFIG).flatMap((config) => config.domains)
  )
];

// Launches are serialized by isolation group.
const launchLocks = new Map();

// Extension sessions are stored by supplier tab ID.
const sessionStorageKey = (tabId) => `supplier-session:${tabId}`;

// ---------------------------------------------------------------------------
// General helpers
// ---------------------------------------------------------------------------
function canonicalSupplier(supplier) {
  return String(supplier || "").trim().toLowerCase();
}

function supplierConfig(supplier) {
  const key = canonicalSupplier(supplier);
  return SUPPLIER_CONFIG[key] || null;
}

function sessionAccount(session) {
  if (!session) return null;
  const candidate = session.account || session.supplier;
  if (typeof candidate !== "string") return null;
  const normalized = canonicalSupplier(candidate);
  return normalized || null;
}

function hostnameInDomains(hostname, domains) {
  if (!hostname || !Array.isArray(domains)) return false;
  const normalizedHostname = hostname.toLowerCase();
  return domains.some((domain) => {
    const normalizedDomain = String(domain).toLowerCase();
    return (
      normalizedHostname === normalizedDomain ||
      normalizedHostname.endsWith(`.${normalizedDomain}`)
    );
  });
}

function isAllowedSupplierUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:") return false;
    return ALLOWED_HOSTS.some((host) => {
      return url.hostname === host || url.hostname.endsWith(`.${host}`);
    });
  } catch {
    return false;
  }
}

function newEventId() {
  // crypto.randomUUID() is available in MV3 service workers (Chrome 92+),
  // but fall back to a random-hex string just in case.
  try {
    if (crypto && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through */
  }
  return `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

// ---------------------------------------------------------------------------
// Backend communication
// ---------------------------------------------------------------------------
async function backendFetch(path, options = {}) {
  const url = `${API_ORIGIN}${path}`;
  const response = await fetch(url, options);

  if (!response.ok) {
    let body = {};
    try {
      body = await response.json();
    } catch {
      body = {};
    }
    const errorMessage =
      body.error ||
      body.message ||
      `Backend request failed with status ${response.status}`;
    throw new Error(errorMessage);
  }

  if (response.status === 204) return {};

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }

  const text = await response.text();
  return text ? { message: text } : {};
}

/**
 * Send a tracking event to the backend.
 *
 * The backend expects: eventId, sessionId, supplier, eventType, occurredAt.
 * Any extra keys in eventPayload (url, metadata, etc.) are forwarded
 * verbatim.  Session-derived fields always win over eventPayload so a caller
 * cannot accidentally overwrite them.
 */
async function sendEvent(session, eventPayload = {}) {
  if (!session?.sessionId) {
    throw new Error("Cannot send event without a session ID.");
  }
  if (!session?.launchToken) {
    throw new Error("Cannot send event without a launch token.");
  }

  const payload = {
    ...eventPayload,
    eventId: eventPayload.eventId || newEventId(),
    sessionId: session.sessionId,
    supplier: canonicalSupplier(session.supplier),
    userId: session.userId || null,
    tabId: session.tabId || null,
    occurredAt:
      eventPayload.occurredAt ||
      eventPayload.timestamp ||
      new Date().toISOString()
  };
  delete payload.timestamp;

  return backendFetch("/api/supplier-events", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.launchToken}`
    },
    body: JSON.stringify(payload)
  });
}

async function requestCredentials(session) {
  if (!session?.sessionId) {
    throw new Error("Cannot request credentials without a session ID.");
  }
  if (!session?.launchToken) {
    throw new Error("Cannot request credentials without a launch token.");
  }

  const account = sessionAccount(session);
  if (!account) {
    throw new Error("Cannot request credentials without an account.");
  }

  const query = new URLSearchParams({ account });
  return backendFetch(
    `/api/supplier-sessions/${encodeURIComponent(session.sessionId)}/credentials?${query.toString()}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${session.launchToken}` },
      credentials: "include"
    }
  );
}

// ---------------------------------------------------------------------------
// Supplier-tab helpers
// ---------------------------------------------------------------------------
async function getTabsForDomains(domains) {
  const matchingTabs = [];
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id || !tab.url) continue;
    let hostname;
    try {
      hostname = new URL(tab.url).hostname;
    } catch {
      continue;
    }
    if (hostnameInDomains(hostname, domains)) {
      matchingTabs.push(tab);
    }
  }
  return matchingTabs;
}

/**
 * Ask existing supplier content scripts to clear any page-level
 * credential-attempt flags.  Best-effort: silent failure when the tab has no
 * reachable content script.
 */
async function clearCredentialAttemptFlagsForGroup(domains) {
  const tabs = await getTabsForDomains(domains);
  const messages = tabs.map((tab) =>
    chrome.tabs
      .sendMessage(tab.id, { type: "SUPPLIER_RESET_SESSION_STATE" })
      .catch(() => undefined)
  );
  await Promise.allSettled(messages);
}

/**
 * Clear supplier site data.
 *
 * Removes cookies, localStorage, IndexedDB, cacheStorage, service workers,
 * etc. for every origin.  When the supplier config provides an explicit
 * `originsToClear` list (to reach subdomains like app.hotelbeds.com and
 * b2dmc.w2m.travel), those origins are added on top of the default
 * derivation of "https://<domain>" and "https://www.<domain>".
 */
async function clearSiteDataForDomains(domains, extraOrigins = []) {
  const origins = new Set();
  for (const domain of domains) {
    origins.add(`https://${domain}`);
    origins.add(`https://www.${domain}`);
  }
  for (const origin of extraOrigins || []) {
    origins.add(origin);
  }

  try {
    await chrome.browsingData.remove(
      { origins: [...origins] },
      {
        cookies: true,
        cacheStorage: true,
        fileSystems: true,
        indexedDB: true,
        localStorage: true,
        serviceWorkers: true,
        webSQL: true
      }
    );
  } catch (error) {
    console.warn("[SupplierTracker] browsingData.remove failed:", error);
  }
}

/**
 * Fallback pass to remove any cookies that survived browsingData.remove
 * (for example partitioned cookies on some Chrome versions).
 *
 * chrome.cookies.getAll({ domain }) returns cookies for the domain and its
 * subdomains, which is what we want.
 */
async function clearCookiesForDomains(domains) {
  for (const domain of domains) {
    let cookies = [];
    try {
      cookies = await chrome.cookies.getAll({ domain });
    } catch (error) {
      console.warn(
        `[SupplierTracker] Could not read cookies for ${domain}:`,
        error
      );
      continue;
    }

    const removals = cookies.map(async (cookie) => {
      const protocol = cookie.secure ? "https" : "http";
      // Strip the leading "." on domain-cookies (".hotelbeds.com" -> "hotelbeds.com").
      // The previous regex `/^./` was wrong — it removed the first CHARACTER
      // of every domain (turning "hotelbeds.com" into "otelbeds.com"), so
      // chrome.cookies.remove silently failed for host-only cookies.
      const cookieDomain = cookie.domain.replace(/^\./, "");
      const cookiePath = cookie.path || "/";
      const cookieUrl = `${protocol}://${cookieDomain}${cookiePath}`;

      const removalDetails = { url: cookieUrl, name: cookie.name };
      if (cookie.storeId) removalDetails.storeId = cookie.storeId;
      if (typeof cookie.partitionKey !== "undefined") {
        removalDetails.partitionKey = cookie.partitionKey;
      }

      try {
        await chrome.cookies.remove(removalDetails);
      } catch (error) {
        console.warn(
          `[SupplierTracker] Could not remove cookie ${cookie.name}:`,
          error
        );
      }
    });

    await Promise.allSettled(removals);
  }
}

async function clearExtensionSessionsForGroup(isolationGroup) {
  const allStoredValues = await chrome.storage.session.get(null);
  const keysToRemove = [];

  for (const [key, value] of Object.entries(allStoredValues)) {
    if (!key.startsWith("supplier-session:")) continue;
    if (!value?.supplier) continue;

    const config = supplierConfig(value.supplier);
    if (config && config.isolationGroup === isolationGroup) {
      keysToRemove.push(key);
    }
  }

  if (keysToRemove.length > 0) {
    await chrome.storage.session.remove(keysToRemove);
  }
}

// ---------------------------------------------------------------------------
// Fresh supplier launch
// ---------------------------------------------------------------------------
async function prepareFreshLaunch(supplier) {
  const config = supplierConfig(supplier);
  if (!config) {
    throw new Error(`No configuration exists for supplier: ${supplier}`);
  }

  console.info(
    `[SupplierTracker] Preparing fresh launch for ${supplier}`,
    config
  );

  // Reset credential-attempt flags on existing tabs for this domain group
  // (do not close them — the user may have other supplier tabs open too).
  await clearCredentialAttemptFlagsForGroup(config.domains);

  // Wipe cookies, localStorage, IndexedDB, service workers for every known
  // origin of this supplier (including subdomains such as app.hotelbeds.com
  // and b2dmc.w2m.travel) so the fresh tab starts unauthenticated.
  await clearSiteDataForDomains(config.domains, config.originsToClear);
  await clearCookiesForDomains(config.domains);
  await clearExtensionSessionsForGroup(config.isolationGroup);

  console.info(
    `[SupplierTracker] Fresh browser state prepared for ${supplier}`
  );
}

// ---------------------------------------------------------------------------
// Launch locking (serialize concurrent launches within an isolation group)
// ---------------------------------------------------------------------------
async function withSupplierLaunchLock(supplier, task) {
  const config = supplierConfig(supplier);
  if (!config) {
    throw new Error(`Cannot create launch lock for unknown supplier: ${supplier}`);
  }

  const lockKey = config.isolationGroup;
  const previous = launchLocks.get(lockKey) || Promise.resolve();
  const current = previous.catch(() => undefined).then(task);
  launchLocks.set(lockKey, current);

  try {
    return await current;
  } finally {
    if (launchLocks.get(lockKey) === current) {
      launchLocks.delete(lockKey);
    }
  }
}

// ---------------------------------------------------------------------------
// SPA navigation tracking
// ---------------------------------------------------------------------------
chrome.webNavigation.onHistoryStateUpdated.addListener(async (details) => {
  if (details.frameId !== 0) return;

  try {
    const storageKey = sessionStorageKey(details.tabId);
    const result = await chrome.storage.session.get(storageKey);
    const session = result[storageKey];
    if (!session) return;

    await sendEvent(session, {
      eventType: "navigation.spa_route_change",
      url: details.url
    });
  } catch (error) {
    console.error("[SupplierTracker] Failed to track SPA navigation:", error);
  }
});

// ---------------------------------------------------------------------------
// Message dispatch helpers
// ---------------------------------------------------------------------------
function handleOpenSupplierTab(message, sendResponse) {
  const { sessionId, supplier, startUrl, userId, launchToken } =
    message.payload || {};
  const normalizedSupplier = canonicalSupplier(supplier);

  if (!sessionId || !normalizedSupplier || !startUrl || !launchToken) {
    sendResponse({ ok: false, error: "Missing session launch details." });
    return;
  }

  const config = supplierConfig(normalizedSupplier);
  if (!config) {
    sendResponse({ ok: false, error: `Unknown supplier: ${normalizedSupplier}` });
    return;
  }

  if (!isAllowedSupplierUrl(startUrl)) {
    sendResponse({ ok: false, error: `Supplier URL is not approved: ${startUrl}` });
    return;
  }

  let startHostname;
  try {
    startHostname = new URL(startUrl).hostname;
  } catch {
    sendResponse({ ok: false, error: `Invalid supplier URL: ${startUrl}` });
    return;
  }

  if (!hostnameInDomains(startHostname, config.domains)) {
    sendResponse({
      ok: false,
      error: `The URL ${startUrl} does not belong to supplier ${normalizedSupplier}.`
    });
    return;
  }

  withSupplierLaunchLock(normalizedSupplier, async () => {
    await prepareFreshLaunch(normalizedSupplier);

    const tab = await chrome.tabs.create({ url: startUrl, active: true });
    if (!tab?.id) throw new Error("Could not open the supplier tab.");

    const session = {
      sessionId,
      supplier: normalizedSupplier,
      account: normalizedSupplier,
      isolationGroup: config.isolationGroup,
      userId: userId || null,
      launchToken,
      tabId: tab.id,
      startUrl,
      startedAt: new Date().toISOString()
    };

    await chrome.storage.session.set({
      [sessionStorageKey(tab.id)]: session
    });

    try {
      await sendEvent(session, {
        eventType: "session.started",
        url: startUrl
      });
    } catch (error) {
      console.error(
        "[SupplierTracker] Failed to report session start:",
        error
      );
    }

    return {
      ok: true,
      sessionId,
      tabId: tab.id,
      supplier: normalizedSupplier,
      account: normalizedSupplier
    };
  })
    .then((result) => sendResponse(result))
    .catch((error) => {
      console.error("[SupplierTracker] Fresh launch failed:", error);
      sendResponse({
        ok: false,
        error: error?.message || "The supplier launch failed."
      });
    });
}

function handleSupplierEvent(message, sender, sendResponse) {
  const tabId = sender.tab?.id;
  if (!tabId) {
    sendResponse?.({ ok: false, error: "Supplier event did not include a tab ID." });
    return;
  }

  const storageKey = sessionStorageKey(tabId);
  chrome.storage.session
    .get(storageKey)
    .then(async (result) => {
      const session = result[storageKey];
      if (!session) {
        return { ok: false, error: "No active supplier session was found." };
      }
      await sendEvent(
        session,
        message.payload || { eventType: "supplier.unknown_event" }
      );
      return { ok: true };
    })
    .then((result) => sendResponse?.(result))
    .catch((error) => {
      console.error("[SupplierTracker] Failed to send supplier event:", error);
      sendResponse?.({
        ok: false,
        error: error?.message || "Event reporting failed."
      });
    });
}

function handleLoginFormReady(sender, sendResponse) {
  const tabId = sender.tab?.id;
  if (!tabId) {
    sendResponse?.({ ok: false, error: "Login request did not include a tab ID." });
    return;
  }

  const storageKey = sessionStorageKey(tabId);
  chrome.storage.session
    .get(storageKey)
    .then(async (result) => {
      const session = result[storageKey];
      if (!session) {
        throw new Error("No active supplier session was found for this tab.");
      }

      const account = sessionAccount(session);
      if (!account) {
        await sendEvent(session, {
          eventType: "login.credentials_unavailable",
          metadata: { reason: "missing_account" }
        }).catch(() => undefined);
        throw new Error("The supplier account is missing from the session.");
      }

      try {
        const credentials = await requestCredentials({ ...session, account });
        await chrome.tabs
          .sendMessage(tabId, {
            type: "FILL_SUPPLIER_LOGIN",
            payload: credentials
          })
          .catch((err) => {
            // The content script may not be ready yet; surface a warning
            // but do not fail the whole credential delivery.
            console.warn(
              "[SupplierTracker] Content script not reachable for FILL_SUPPLIER_LOGIN:",
              err
            );
          });

        await sendEvent(session, {
          eventType: "login.credentials_delivered",
          metadata: { account }
        }).catch(() => undefined);

        return { ok: true, account };
      } catch (error) {
        await sendEvent(session, {
          eventType: "login.credentials_unavailable",
          metadata: {
            reason: error?.message || "credential_request_failed",
            account
          }
        }).catch(() => undefined);
        throw error;
      }
    })
    .then((result) => sendResponse?.(result))
    .catch((error) => {
      console.error("[SupplierTracker] Credential delivery failed:", error);
      sendResponse?.({
        ok: false,
        error: error?.message || "Credential delivery failed."
      });
    });
}

function handleLoginEvent(message, sender, sendResponse) {
  const tabId = sender.tab?.id;
  if (!tabId) {
    sendResponse?.({ ok: false, error: "Login event did not include a tab ID." });
    return;
  }

  const storageKey = sessionStorageKey(tabId);
  chrome.storage.session
    .get(storageKey)
    .then(async (result) => {
      const session = result[storageKey];
      if (!session) {
        return { ok: false, error: "No active supplier session was found." };
      }

      const eventType =
        message.type === "SUPPLIER_OTP_REQUIRED"
          ? "login.otp_required"
          : "login.prelogin_step_completed";

      await sendEvent(session, {
        eventType,
        metadata: message.payload || {}
      });
      return { ok: true };
    })
    .then((result) => sendResponse?.(result))
    .catch((error) => {
      console.error("[SupplierTracker] Login event reporting failed:", error);
      sendResponse?.({
        ok: false,
        error: error?.message || "Login event reporting failed."
      });
    });
}

// ---------------------------------------------------------------------------
// Messages from the web application and content scripts
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  try {
    if (message?.type === "OPEN_SUPPLIER_TAB") {
      handleOpenSupplierTab(message, sendResponse);
      return true;
    }

    if (message?.type === "SUPPLIER_EVENT") {
      handleSupplierEvent(message, sender, sendResponse);
      return true;
    }

    if (message?.type === "SUPPLIER_LOGIN_FORM_READY") {
      handleLoginFormReady(sender, sendResponse);
      return true;
    }

    if (
      message?.type === "SUPPLIER_PRELOGIN_DONE" ||
      message?.type === "SUPPLIER_OTP_REQUIRED"
    ) {
      handleLoginEvent(message, sender, sendResponse);
      return true;
    }
  } catch (error) {
    // Catches any synchronous throw inside a handler so it does not surface
    // as an unhandled "(anonymous function)" error in the service-worker log.
    console.error(
      "[SupplierTracker] Unhandled error in message listener:",
      error
    );
    try {
      sendResponse?.({
        ok: false,
        error: error?.message || "Unhandled background error."
      });
    } catch {
      /* ignore secondary sendResponse failure */
    }
    return false;
  }

  return false;
});

// ---------------------------------------------------------------------------
// Tab lifecycle tracking
// ---------------------------------------------------------------------------
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const storageKey = sessionStorageKey(tabId);
  try {
    const result = await chrome.storage.session.get(storageKey);
    const session = result[storageKey];
    if (!session) return;

    try {
      await sendEvent(session, { eventType: "session.tab_closed" });
    } catch (error) {
      console.warn(
        "[SupplierTracker] Could not report tab closure:",
        error
      );
    } finally {
      await chrome.storage.session.remove(storageKey);
    }
  } catch (error) {
    console.error(
      "[SupplierTracker] Failed to process tab removal:",
      error
    );
  }
});

// ---------------------------------------------------------------------------
// Extension startup
// ---------------------------------------------------------------------------
console.info(
  "[SupplierTracker] Background service worker loaded successfully."
);
