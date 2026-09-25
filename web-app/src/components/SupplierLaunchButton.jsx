import { openSupplierSession } from "../services/supplierSession.js";

export function attachSupplierLaunchButton(button, supplier, onStatus) {
	button.addEventListener("click", async () => {
		button.disabled = true;
		onStatus(`Opening ${supplier}…`);

		try {
			const session = await openSupplierSession(supplier);
			onStatus(`${supplier} opened — session ${session.sessionId}`, "success");
		} catch (error) {
			onStatus(error.message, "error");
		} finally {
			button.disabled = false;
		}
	});
}
