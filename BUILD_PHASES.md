# Supplier Session Tracker — Build Phases & Roadmap

## What this project is

Based on the email thread discussing the Supplier Intelligence Layer (SIL-A – Session Control), the team is building an internal tool that lets Teletext Holidays agents access supplier portals through a managed browser experience. The core objectives extracted from every line of the conversation are:

**Security objective:** Agents must never see, copy, or store supplier portal credentials. The extension fills the username and password automatically; the agent only sees the supplier page after login is complete (or at the OTP step, which they enter manually).

**Audit objective:** Every agent action on a supplier portal — page load, login, click, navigation, booking confirmation, tab close — is recorded to a session-level audit trail linked to the agent's identity.

**Control objective:** The extension is deployed centrally via Active Directory Group Policy. Agents cannot uninstall, disable, or bypass it. Supplier access is channeled through the managed extension so there is a single point of credential delivery and session monitoring.

**Architecture decision (from emails):** The team confirmed that iframes are not viable — 9 of 16 suppliers block iframe embedding, and even those that render may not complete login flows reliably. The agreed architecture is a Chrome extension that opens each supplier in a normal browser tab and injects a content script to handle credential fill and event tracking.

**Deployment decision (from emails):** Active Directory Group Policy via `ExtensionInstallForcelist` is the chosen path. Chrome Enterprise Core is deferred. The extension is self-hosted on an internal HTTPS server, not published to the Chrome Web Store, because it handles credential flows and the code should not be publicly accessible.

---

## Supplier inventory

The login details document provides credentials and exact DOM selectors for 9 active suppliers:

| # | Supplier | Portal URL | Cookie step | Pre-login step | OTP |
|---|----------|-----------|-------------|----------------|-----|
| 1 | Hotelbeds | app.hotelbeds.com | Yes (Cookiebot) | No | No |
| 2 | Beds With Ease | bedswithease.com/login | Yes (notification close) | No | No |
| 3 | Altura Beds | alturabeds.com | Yes (#acceptCookies) | Yes (Sign In nav link) | No |
| 4 | SunHotels (WebBeds) | sunhotels.com/en/ | No | No | No |
| 5 | Sun International | suninternationaltt.com | Yes (cookie policy close) | Yes (upper-menu login button) | No |
| 6 | SunTransfers | suntransfers.com | Yes (OneTrust) | No | No |
| 7 | S Tours | stours-extranet.cyberlogic.cloud | No | No | No |
| 8 | Yalago | affiliate.yalago.com | Yes | Yes (Client Login button) | Yes |
| 9 | W2M | dmc.w2m.travel | Yes (Didomi) | No | Yes |

---

## Phase 1 — Local development build (this delivery)

**Goal:** A fully working local PoC with all 9 suppliers, ready for testing on a developer machine.

### Step 1.1: Project setup

Set up the Node.js project with `server.js` serving both the web app and the API. No external dependencies beyond Node.js itself.

**Files:** `package.json`, `server.js`, `.env`, `.env.example`, `.gitignore`

### Step 1.2: Backend session management

Build the backend that creates a unique `sessionId` for every supplier launch, stores it in memory, and writes a JSON audit file per session. The backend also serves credentials from environment variables (later, from a secrets vault).

**Files:** `backend/supplier-sessions/create-session`, `backend/supplier-sessions/ingest-event`

**API endpoints:**
- `POST /api/supplier-sessions` — create a session, return `sessionId`, `startUrl`, `launchToken`
- `GET /api/supplier-sessions/:id/credentials` — return credentials for an authorized session
- `POST /api/supplier-events` — ingest a tracking event
- `GET /api/supplier-events` — list recent events (for the dashboard)

### Step 1.3: Chrome extension — background service worker

Build `background.js` that handles the core orchestration: receiving launch requests from the web app, opening supplier tabs, mapping `tabId` to `sessionId`, relaying events to the backend, requesting and forwarding credentials, and cleaning up on tab close.

**Files:** `extension/background.js`, `extension/manifest.json`

### Step 1.4: Chrome extension — app bridge

Build `app-bridge.js` as a content script that runs only on the internal web app URL. It relays `START_SUPPLIER_TRACKING` messages from the web app to the background worker and returns the result.

**Files:** `extension/app-bridge.js`

### Step 1.5: Chrome extension — supplier tracker content script

Build `supplier-tracker.js` as the main content script that runs on every supplier portal. This handles:

- Cookie/consent banner dismissal (reads `cookieAcceptSelectors` from the adapter)
- Pre-login button clicks (reads `preLoginSelectors` — e.g. "Sign In" to reveal the form)
- Login form detection via `MutationObserver`
- Credential request when form is found (`SUPPLIER_LOGIN_FORM_READY`)
- Credential fill using React-compatible `setFieldValue` (bypasses the native setter)
- Field masking: sets `autocomplete="new-password"` and `readonly` to prevent Chrome from saving credentials
- Auto-submit: clicks the login button after a short delay
- OTP detection: watches for OTP input fields and notifies the background worker
- Click tracking: logs every button, link, and role="button" click with element metadata
- Form submission tracking
- Booking confirmation detection (DOM selectors and text matching)
- SPA navigation tracking via `MutationObserver`

**Files:** `extension/supplier-tracker.js`

### Step 1.6: Supplier adapters (one per supplier)

Build an adapter file for each supplier with the exact selectors from the login details document. Each adapter specifies: hostname matching, cookie accept selectors, pre-login selectors, username selectors, password selector, login submit selectors, OTP selectors, and timing delays.

**Files:** `extension/adapters/hotelbeds.js`, `beds-with-ease.js`, `alturabeds.js`, `sunhotels.js`, `sun-international.js`, `suntransfers.js`, `stours.js`, `yalago.js`, `w2m.js`

### Step 1.7: Web app — supplier launcher dashboard

Build the agent-facing web page with a card for each supplier. Clicking a card triggers the backend session creation and extension launch flow. The page also shows a live event log that auto-refreshes. Suppliers requiring OTP are badged so agents know to expect a code prompt.

**Files:** `web-app/index.html`, `web-app/styles.css`, `web-app/app.js`, `web-app/src/services/supplierSession.js`, `web-app/src/components/SupplierLaunchButton.jsx`

### Step 1.8: Test each supplier end to end

For each of the 9 suppliers, verify:
- Cookie banner is dismissed automatically
- Pre-login button is clicked (where applicable)
- Login form is detected
- Credentials are filled without being visible to the agent
- Login button is clicked automatically
- OTP prompt is detected and agent can enter it manually (Yalago, W2M)
- Chrome does not offer to save the password
- Events are logged to the session JSON file
- Tab close event is recorded

### Deliverable

A zip file containing the complete project. Run with `npm start`, load the extension folder unpacked in `chrome://extensions`, and test.

---

## Phase 2 — Selector hardening & adapter refinement

**Goal:** Make every adapter reliable against real supplier portals, handle edge cases.

### Step 2.1: Live selector verification

Open each supplier portal manually, inspect the actual DOM, and verify every selector in the adapter matches the current page structure. Suppliers change their HTML frequently; selectors from the login details document are a starting point.

### Step 2.2: Handle SSO redirects

Some suppliers (e.g. Hotelbeds) may redirect to an SSO or separate authentication domain after the initial page load. The extension manifest and `ALLOWED_HOSTS` must include all redirect domains. Test each supplier's full redirect chain.

### Step 2.3: Handle timing variations

Different suppliers load at different speeds. Some use heavy JavaScript frameworks (Angular, React) that render the login form after a delay. Tune the `cookieDelay` and `preLoginDelay` per adapter, and ensure the `MutationObserver` catches late-rendering forms.

### Step 2.4: CAPTCHA and bot detection

Some suppliers may show CAPTCHAs or block automated form fills. For these, the extension should fill credentials but pause before submitting, letting the agent complete the CAPTCHA manually. Add a `hasCaptcha` flag to the adapter.

### Step 2.5: Session timeout handling

If an agent leaves a supplier tab open too long, the supplier may time out the session. Detect session-expired indicators (login form re-appearing, specific error messages) and re-trigger the credential flow automatically.

### Deliverable

Updated adapter files with verified, production-tested selectors.

---

## Phase 3 — Security hardening

**Goal:** Remove all credential exposure vectors.

### Step 3.1: Credential vault integration

Replace `.env` file credentials with a call to a secrets vault (AWS Secrets Manager, Azure Key Vault, or HashiCorp Vault). The backend requests credentials at runtime, caches them for a short TTL, and never writes them to disk.

### Step 3.2: Launch token security

Replace the UUID launch token with a short-lived signed JWT. The backend validates the JWT on every credential and event request. Tokens expire after a configurable window (e.g. 15 minutes). Include the agent's authenticated identity in the JWT claims.

### Step 3.3: Agent authentication

Replace the `demo-agent` hard-coded user with the agent's real identity from the internal application's authentication system. The session creation endpoint requires a valid internal session cookie or bearer token.

### Step 3.4: Credential field protection

Enhance the content script's credential masking:
- Set `type="password"` and `autocomplete="new-password"` on both fields
- Briefly set fields to `readonly` to prevent Chrome autofill prompts
- Inject CSS to hide the field values visually during the fill
- Disable password manager detection heuristics where possible

### Step 3.5: Extension code obfuscation

Before packaging the CRX, minify and obfuscate the extension JavaScript. This reduces the risk of an agent inspecting the extension source through Chrome DevTools to extract credential-handling logic.

### Deliverable

Backend integrated with the secrets vault. Extension hardened against credential exposure.

---

## Phase 4 — GPO deployment (Active Directory)

**Goal:** Force-install the extension on all 132 agent machines via Group Policy.

This phase follows the exact deployment path confirmed in the email thread between the team and Ranga.

### Step 4.1: Package and sign the extension

On a controlled build machine, package the `extension/` folder into a signed `.crx` file using Chrome's extension packaging tool. Store the `.pem` signing key in the company secrets vault — it is needed for every future update and cannot be replaced.

### Step 4.2: Host the CRX and update manifest

Upload the signed `.crx` and `update_manifest.xml` to an internal HTTPS server (e.g. `https://extensions.company.internal/supplier-tracker/`). The HTTPS certificate must be trusted by all agent machines. Restrict write access to the server.

### Step 4.3: Chrome ADMX policy templates

Download the Chrome Enterprise policy templates from Google. Copy the ADMX and ADML files to the Active Directory Central Store at `\\<domain>\SYSVOL\<domain>\Policies\PolicyDefinitions\`.

### Step 4.4: Create the GPO

In Group Policy Management (`gpmc.msc`):
- Create a GPO named `Chrome - Supplier Tracker - Force Install`
- Link it to the OU containing agent machines
- Navigate to: Computer Configuration → Policies → Administrative Templates → Google → Google Chrome → Extensions → Configure the list of force-installed apps and extensions
- Enable the setting and add: `<extension-id>;https://extensions.company.internal/supplier-tracker/update_manifest.xml`

### Step 4.5: Supporting policies

Apply alongside the extension GPO (subject to IT/Security approval):
- Disable Chrome Incognito mode
- Disable Chrome Guest mode
- Block unapproved extensions
- Restrict unapproved/portable browsers via endpoint application control (flagged in the email as a parallel IT action)

### Step 4.6: Pilot test

Test on one domain-joined machine in the target OU:
- Run `gpupdate /force`, restart Chrome
- Verify `chrome://policy` shows `ExtensionInstallForcelist`
- Verify `chrome://extensions` shows the extension as administrator-installed
- Verify the agent cannot remove or disable it
- Open the internal app, launch a supplier, confirm the session and events reach the backend

### Step 4.7: Full rollout

After pilot success, link the GPO to the full agent-machine OU. All 132 machines pick up the extension on their next Group Policy refresh cycle.

### Deliverable

Extension force-installed on all agent browsers via AD GPO. Agents cannot uninstall it.

---

## Phase 5 — SAO (SuperAgent ONE) integration

**Goal:** Embed the supplier launcher into the existing SuperAgent ONE application.

### Step 5.1: Replace the standalone web app

Move the supplier card UI from the standalone `web-app/index.html` into the SAO application as a new component or page. Update `app-bridge.js` to match the SAO production URL in the extension manifest.

### Step 5.2: Connect to the SAO backend

Replace the local Node.js server with the SAO backend. The session creation, credential delivery, and event ingestion endpoints integrate into the existing SAO API layer.

### Step 5.3: Agent identity

Use the SAO's existing agent authentication to populate the `userId` in session records. Remove the `demo-agent` fallback.

### Step 5.4: Event dashboard

Build an admin-facing dashboard in SAO that displays session audit trails — filterable by agent, supplier, date, and event type. This gives supervisors visibility into which agents accessed which suppliers and what they did.

### Deliverable

Supplier launcher fully embedded in SAO. Audit data visible to supervisors.

---

## Phase 6 — Monitoring, maintenance & compliance

**Goal:** Keep the system working as suppliers change their portals.

### Step 6.1: Automated health checks

Build a scheduled job that attempts a headless login to each supplier portal using the adapter selectors. If a selector breaks (supplier changed their HTML), alert the development team immediately so the adapter can be updated before agents are affected.

### Step 6.2: Extension update pipeline

When adapters need updating, increment the version in `manifest.json`, repackage the CRX with the same signing key, upload to the internal HTTPS server, and update `update_manifest.xml`. All agent machines pick up the update automatically via Chrome's polling interval (usually within a few hours).

### Step 6.3: Supplier legal/compliance review

The email thread flagged that embedding/reframing supplier login systems carries contractual risk. Before going to production, obtain Legal sign-off for each supplier. Document which suppliers have approved the managed-browser, credential-fill, and event-tracking approach.

### Step 6.4: Event retention and audit

Define a retention policy for session audit data. Move from JSON files to a proper database. Implement access controls so only authorized personnel can view session records.

---

## Architecture summary

```
┌─────────────────────────────────────────────────────────────┐
│                        Agent's Browser                       │
│                                                              │
│  ┌──────────────────┐     ┌──────────────────────────────┐  │
│  │  Internal Web App │     │  Supplier Portal Tab         │  │
│  │  (SAO / launcher) │     │  (e.g. app.hotelbeds.com)    │  │
│  │                   │     │                              │  │
│  │  [Supplier Cards] │     │  content script:             │  │
│  │       │           │     │  ┌─ adapter (selectors)      │  │
│  │       ▼           │     │  ├─ cookie dismiss           │  │
│  │  app-bridge.js ───┼─────┤  ├─ credential fill          │  │
│  │  (postMessage)    │     │  ├─ click tracking           │  │
│  └──────────────────┘     │  └─ event reporting          │  │
│                            └──────────────────────────────┘  │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  background.js (service worker)                       │   │
│  │  • Opens supplier tabs                                │   │
│  │  • Maps tabId → sessionId                             │   │
│  │  • Requests credentials from backend                  │   │
│  │  • Relays events to backend                           │   │
│  └───────────────────────┬──────────────────────────────┘   │
│                          │                                   │
└──────────────────────────┼───────────────────────────────────┘
                           │ HTTPS
                           ▼
              ┌────────────────────────┐
              │  Internal Backend      │
              │  • Session creation    │
              │  • Credential vault    │
              │  • Event ingestion     │
              │  • Audit database      │
              └────────────────────────┘
```

## Event types tracked

| Event | When it fires |
|-------|--------------|
| `session.started` | Agent clicks a supplier card, tab opens |
| `session.tab_closed` | Agent closes the supplier tab |
| `page.loaded` | Supplier page finishes loading |
| `page.cookie_accepted` | Cookie/consent banner dismissed |
| `login.prelogin_button_clicked` | Pre-login step completed (e.g. "Sign In" button) |
| `login.form_detected` | Login form found in the DOM |
| `login.credentials_filled` | Username and password filled by extension |
| `login.auto_submit_attempted` | Extension clicked the login button |
| `login.submitted` | Login form submitted |
| `login.otp_required` | OTP input detected, agent enters manually |
| `login.credentials_unavailable` | Backend could not provide credentials |
| `login.form_not_found` | Credentials received but form disappeared |
| `interaction.click` | Any button/link click on the supplier page |
| `navigation.spa_route_change` | URL changed without full page load (SPA) |
| `booking.confirmation_detected` | Booking confirmation indicators found |

## Security controls summary (from emails)

| Control | Implementation |
|---------|---------------|
| Credentials never visible to agent | Extension fills fields programmatically; `type="password"` and `autocomplete="new-password"` prevent Chrome from saving or showing values |
| Extension cannot be removed | AD Group Policy `ExtensionInstallForcelist` |
| Code not publicly accessible | Self-hosted CRX, not Chrome Web Store |
| Credential source | Secrets vault (production), `.env` (local PoC only) |
| Signing key security | `.pem` stored in vault, never on update server or in Git |
| Agent identity | Authenticated via internal app session (production) |
| Bypass prevention | IT restricts unapproved browsers and portable executables (parallel action flagged in emails) |
