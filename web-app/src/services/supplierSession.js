import { withAuth } from "./auth.js";

const APP_ORIGIN = window.location.origin;

export async function openSupplierSession(supplier) {
	const response = await fetch("/api/supplier-sessions", withAuth({
		method: "POST",
		credentials: "include",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ supplier })
	}));

	if (!response.ok) {
		const body = await response.json().catch(() => ({}));
		throw new Error(body.error || "Unable to create supplier session.");
	}

	const session = await response.json();

	/* Tell the extension to open the supplier in a new tab */
	window.postMessage(
		{
			type: "START_SUPPLIER_TRACKING",
			payload: session
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
