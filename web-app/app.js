import { attachSupplierLaunchButton } from "./src/components/SupplierLaunchButton.jsx";
import { extensionReady } from "./src/services/supplierSession.js";

const extensionStatus = document.querySelector("#extension-status");
const launchStatus = document.querySelector("#launch-status");
const eventListContainer = document.querySelector("#event-list");

function setLaunchStatus(message, type = "info") {
  launchStatus.textContent = message;
  launchStatus.classList.remove("error", "success");
  if (type === "error") launchStatus.classList.add("error");
  if (type === "success") launchStatus.classList.add("success");
}

function getEventTypeClass(eventType) {
  if (eventType.startsWith("session.")) return "session";
  if (eventType.startsWith("login.")) return "login";
  if (eventType.startsWith("interaction.")) return "interaction";
  if (eventType.startsWith("page.")) return "page";
  if (eventType.startsWith("booking.")) return "booking";
  if (eventType.startsWith("navigation.")) return "navigation";
  return "";
}

function formatTime(isoString) {
  try {
    const d = new Date(isoString);
    return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return "";
  }
}

async function refreshEvents() {
  try {
    const response = await fetch("/api/supplier-events");
    const { events } = await response.json();
    eventListContainer.innerHTML = "";

    if (!events || !events.length) {
      eventListContainer.innerHTML = '<p class="empty-state">No events recorded yet. Open a supplier to begin.</p>';
      return;
    }

    for (const event of events) {
      const row = document.createElement("div");
      row.className = "event-row";

      const typeClass = getEventTypeClass(event.eventType);
      const time = formatTime(event.occurredAt);

      row.innerHTML = `
        <span>
          <span class="event-type ${typeClass}">${event.eventType}</span>
          <span class="event-supplier">${event.supplier}</span>
        </span>
        <span class="event-meta">${time}</span>
      `;
      eventListContainer.append(row);
    }
  } catch {
    eventListContainer.innerHTML = '<p class="empty-state">Could not load events.</p>';
  }
}

/* Wire up every supplier card */
for (const button of document.querySelectorAll("[data-supplier]")) {
  attachSupplierLaunchButton(button, button.dataset.supplier, setLaunchStatus);
}

/* Refresh button */
document.querySelector("#refresh-events").addEventListener("click", refreshEvents);

/* Check extension status */
if (await extensionReady()) {
  extensionStatus.textContent = "Extension connected";
  extensionStatus.classList.add("connected");
} else {
  extensionStatus.textContent = "Extension not detected";
  extensionStatus.classList.add("disconnected");
  setLaunchStatus("Load the extension in chrome://extensions before launching a supplier.", "error");
}

/* Auto-refresh events every 4 seconds */
refreshEvents();
setInterval(refreshEvents, 4000);
