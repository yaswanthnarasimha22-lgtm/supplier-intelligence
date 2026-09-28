import { withAuth, agentIdentity } from "./auth.js";

const APP_ORIGIN = window.location.origin;

/**
 * Open a tracked supplier session.
 *
 * We include the authenticated agent identity in the request body so the
 * server can stamp it onto the session record and every subsequent event.
 * When JWT verification is switched on server-side, the server will use the
 * token as the source of truth and ignore the body-supplied identity (it
 * stays as a useful debug field only).
 */
export async function openSupplierSession(supplier) {
	const agent = agentIdentity();

	const response = await fetch("/api/supplier-sessions", withAuth({
		method: "POST",
		credentials: "include",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			supplier,
			agent,
			client: {
				userAgent: navigator.userAgent,
				language: navigator.language,
				timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
			}
		})
	}));

	if (!response.ok) {
		const body = await response.json().catch(() => ({}));
		throw new Error(body.error || "Unable to create supplier session.");
	}

	const session = await response.json();

	/* Tell the extension to open the supplier in a new tab.  We also forward
	   the agent identity so the extension's background service worker can
	   stamp it onto every event it reports, even the ones fired before the
	   first server round-trip. */
	window.postMessage(
		{
			type: "START_SUPPLIER_TRACKING",
			payload: { ...session, agent }
		},
		APP_ORIGIN
	);

	return session;
}

export function extensionReady(timeoutMs = 1200) {
	return new Promise((resolve) => {
		const timer = window.setTimeout(() => resolve(false), timeoutMs);

		function onMessage(event) {
			if (event.origin !== APP_ORIGIN) return;
			if (event.data?.type !== "SUPPLIER_EXTENSION_READY") return;

			window.clearTimeout(timer);
			window.removeEventListener("message", onMessage);
			resolve(true);
		}

		window.addEventListener("message", onMessage);
		window.postMessage({ type: "SUPPLIER_EXTENSION_PING" }, APP_ORIGIN);
	});
}
