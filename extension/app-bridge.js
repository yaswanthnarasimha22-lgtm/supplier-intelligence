const APP_ORIGIN = "http://localhost:3000";
let launchInProgress = false;

window.addEventListener("message", (event) => {
  if (event.source !== window || event.origin !== APP_ORIGIN) return;
  const message = event.data;

  if (message?.type === "SUPPLIER_EXTENSION_PING") {
    window.postMessage({ type: "SUPPLIER_EXTENSION_READY" }, APP_ORIGIN);
    return;
  }
  if (message?.type !== "START_SUPPLIER_TRACKING") return;

  if (launchInProgress) {
    window.postMessage({
      type: "SUPPLIER_EXTENSION_RESULT",
      payload: { ok: false, error: "A supplier launch is already being prepared." }
    }, APP_ORIGIN);
    return;
  }

  launchInProgress = true;
  chrome.runtime.sendMessage(
    { type: "OPEN_SUPPLIER_TAB", payload: message.payload },
    (response) => {
      launchInProgress = false;
      if (chrome.runtime.lastError) {
        response = { ok: false, error: chrome.runtime.lastError.message };
      }
      window.postMessage({
        type: "SUPPLIER_EXTENSION_RESULT",
        payload: response
      }, APP_ORIGIN);
    }
  );
});
