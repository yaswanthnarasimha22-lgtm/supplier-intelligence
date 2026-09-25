// ---------------------------------------------------------------------------
// Background service worker
// ---------------------------------------------------------------------------
//
// On every supplier-card click, this module:
//
// 1. Validates the supplier and start URL.
// 2. Determines the supplier's isolation group.
// 3. Closes existing tabs belonging to that group.
// 4. Clears the supplier's cookies and site data.
// 5. Clears extension session state for that group.
// 6. Creates a clean supplier tab.
// 7. Stores the session using the newly created tab ID.
// 8. Tracks navigation, login activity, and tab closure.
//
// Accounts using the same domain share an isolation group:
//
// - hotelbeds and hotelbeds2
// - w2m and w2m2
//
// Therefore, opening one account removes the previous browser session for the
// shared domain before starting the new account.
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

// Flatten all configured domains into a unique list.
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

function accountOf(session) {
  if (!session) return null;
  const candidate = session.account || session.supplier;
  if (typeof candidate !== "string") return null;
  const normalized = canonicalSupplier(candidate);
  return normalized || null;
}

function sessionAccount(session) {
  return accountOf(session);
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

async function createBackendSession(sessionPayload) {
  return backendFetch("/api/supplier-sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sessionPayload)
  });
}

async function sendEvent(session, eventPayload = {}) {
  if (!session?.sessionId) throw new Error("Cannot send event without a session ID.");
  if (!session?.launchToken) throw new Error("Cannot send event without a launch token.");

  const payload = {
    eventId: crypto.randomUUID(),
    sessionId: session.sessionId,
    supplier: canonicalSupplier(session.supplier),
    userId: session.userId || null,
    tabId: session.tabId || null,
    occurredAt:
      eventPayload.occurredAt ||
      eventPayload.timestamp ||
      new Date().toISOString(),
    ...eventPayload,
    sessionId: session.sessionId,
    supplier: canonicalSupplier(session.supplier)
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
  if (!session?.sessionId) throw new Error("Cannot request credentials without a session ID.");
  if (!session?.launchToken) throw new Error("Cannot request credentials without a launch token.");

  const account = sessionAccount(session);
  if (!account) throw new Error("Cannot request credentials without an account.");

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

async function clearCredentialAttemptFlagsForGroup(domains) {
  const tabs = await getTabsForDomains(domains);
  const messages = tabs.map((tab) => {
    return chrome.tabs.sendMessage(tab.id, { type: "SUPPLIER_RESET_SESSION_STATE" }).catch(() => {});
  });
  await Promise.allSettled(messages);
}

async function closeTabsForDomains(domains) {
  const tabs = await getTabsForDomains(domains);
  const tabIds = tabs.map((tab) => tab.id).filter(Boolean);
  if (tabIds.length > 0) {
    await chrome.tabs.remove(tabIds);
  }
}

async function clearSiteDataForDomains(domains, extraOrigins = []) {
  const origins = new Set();
  for (const domain of domains) {
    origins.add(`https://${domain}`);
    origins.add(`https://www.${domain}`);
  }
  for (const origin of extraOrigins || []) {
    origins.add(origin);
  }
  
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
}

async function clearCookiesForDomains(domains) {
  for (const domain of domains) {
    let cookies = [];
    try {
      cookies = await chrome.cookies.getAll({ domain });
    } catch (error) {
      console.warn(`[SupplierTracker] Could not read cookies for ${domain}:`, error);
      continue;
    }
    
    const removals = cookies.map(async (cookie) => {
      const protocol = cookie.secure ? "https" : "http";
      const cookieDomain = cookie.domain.replace(/^./, "");
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
        console.warn(`[SupplierTracker] Could not remove cookie ${cookie.name}:`, error);
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
  if (!config) throw new Error(`No configuration exists for supplier: ${supplier}`);

  console.info(`[SupplierTracker] Preparing fresh launch for ${supplier}`, config);

  await clearCredentialAttemptFlagsForGroup(config.domains);
  await clearSiteDataForDomains(config.domains, config.originsToClear);
  await clearCookiesForDomains(config.domains);
  await clearExtensionSessionsForGroup(config.isolationGroup);

  console.info(`[SupplierTracker] Fresh browser state prepared for ${supplier}`);
}

// ---------------------------------------------------------------------------
// Launch locking
// ---------------------------------------------------------------------------
async function withSupplierLaunchLock(supplier, task) {
  const config = supplierConfig(supplier);
  if (!config) throw new Error(`Cannot create launch lock for unknown supplier: ${supplier}`);

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
// Messages from the web application and content scripts
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  
  // -----------------------------------------------------------------------
  // Open supplier tab
  // -----------------------------------------------------------------------
  if (message?.type === "OPEN_SUPPLIER_TAB") {
    const { sessionId, supplier, startUrl, userId, launchToken } = message.payload || {};
    const normalizedSupplier = canonicalSupplier(supplier);

    if (!sessionId || !normalizedSupplier || !startUrl || !launchToken) {
      sendResponse({ ok: false, error: "Missing session launch details." });
      return true;
    }

    const config = supplierConfig(normalizedSupplier);
    if (!config) {
      sendResponse({ ok: false, error: `Unknown supplier: ${normalizedSupplier}` });
      return true;
    }

    if (!isAllowedSupplierUrl(startUrl)) {
      sendResponse({ ok: false, error: `Supplier URL is not approved: ${startUrl}` });
      return true;
    }

    let startHostname;
    try {
      startHostname = new URL(startUrl).hostname;
    } catch {
      sendResponse({ ok: false, error: `Invalid supplier URL: ${startUrl}` });
      return true;
    }

    if (!hostnameInDomains(startHostname, config.domains)) {
      sendResponse({
        ok: false,
        error: `The URL ${startUrl} does not belong to supplier ${normalizedSupplier}.`
      });
      return true;
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

      await chrome.storage.session.set({ [sessionStorageKey(tab.id)]: session });

      try {
        await sendEvent(session, { eventType: "session.started", url: startUrl });
      } catch (error) {
        console.error("[SupplierTracker] Failed to report session start:", error);
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
        sendResponse({ ok: false, error: error?.message || "The supplier launch failed." });
      });

    return true;
  }

  // -----------------------------------------------------------------------
  // Tracking events sent by supplier-tracker.js
  // -----------------------------------------------------------------------
  if (message?.type === "SUPPLIER_EVENT") {
    const tabId = sender.tab?.id;
    if (!tabId) {
      sendResponse?.({ ok: false, error: "Supplier event did not include a tab ID." });
      return false;
    }

    const storageKey = sessionStorageKey(tabId);
    chrome.storage.session
      .get(storageKey)
      .then(async (result) => {
        const session = result[storageKey];
        if (!session) return { ok: false, error: "No active supplier session was found." };

        await sendEvent(session, message.payload || { eventType: "supplier.unknown_event" });
        return { ok: true };
      })
      .then((result) => sendResponse?.(result))
      .catch((error) => {
        console.error("[SupplierTracker] Failed to send supplier event:", error);
        sendResponse?.({ ok: false, error: error?.message || "Event reporting failed." });
      });

    return true;
  }

  // -----------------------------------------------------------------------
  // Login form detected, request credentials
  // -----------------------------------------------------------------------
  if (message?.type === "SUPPLIER_LOGIN_FORM_READY") {
    const tabId = sender.tab?.id;
    if (!tabId) {
      sendResponse?.({ ok: false, error: "Login request did not include a tab ID." });
      return false;
    }

    const storageKey = sessionStorageKey(tabId);
    chrome.storage.session
      .get(storageKey)
      .then(async (result) => {
        const session = result[storageKey];
        if (!session) throw new Error("No active supplier session was found for this tab.");

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
          await chrome.tabs.sendMessage(tabId, { type: "FILL_SUPPLIER_LOGIN", payload: credentials });
          await sendEvent(session, {
            eventType: "login.credentials_delivered",
            metadata: { account }
          }).catch(() => undefined);
          
          return { ok: true, account };
        } catch (error) {
          await sendEvent(session, {
            eventType: "login.credentials_unavailable",
            metadata: { reason: error?.message || "credential_request_failed", account }
          }).catch(() => undefined);
          throw error;
        }
      })
      .then((result) => sendResponse?.(result))
      .catch((error) => {
        console.error("[SupplierTracker] Credential delivery failed:", error);
        sendResponse?.({ ok: false, error: error?.message || "Credential delivery failed." });
      });

    return true;
  }

  // -----------------------------------------------------------------------
  // Prelogin completion and OTP detection
  // -----------------------------------------------------------------------
  if (message?.type === "SUPPLIER_PRELOGIN_DONE" || message?.type === "SUPPLIER_OTP_REQUIRED") {
    const tabId = sender.tab?.id;
    if (!tabId) {
      sendResponse?.({ ok: false, error: "Login event did not include a tab ID." });
      return false;
    }

    const storageKey = sessionStorageKey(tabId);
    chrome.storage.session
      .get(storageKey)
      .then(async (result) => {
        const session = result[storageKey];
        if (!session) return { ok: false, error: "No active supplier session was found." };

        const eventType =
          message.type === "SUPPLIER_OTP_REQUIRED"
            ? "login.otp_required"
            : "login.prelogin_step_completed";

        await sendEvent(session, { eventType, metadata: message.payload || {} });
        return { ok: true };
      })
      .then((result) => sendResponse?.(result))
      .catch((error) => {
        console.error("[SupplierTracker] Login event reporting failed:", error);
        sendResponse?.({ ok: false, error: error?.message || "Login event reporting failed." });
      });

    return true;
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
      console.warn("[SupplierTracker] Could not report tab closure:", error);
    } finally {
      await chrome.storage.session.remove(storageKey);
    }
  } catch (error) {
    console.error("[SupplierTracker] Failed to process tab removal:", error);
  }
});

// ---------------------------------------------------------------------------
// Extension startup validation
// ---------------------------------------------------------------------------
console.info("[SupplierTracker] Background service worker loaded successfully.");