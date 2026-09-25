# Supplier Session Tracker

Internal Chrome extension and web application for Teletext Holidays. Gives agents managed access to 9 supplier portals with automatic credential fill, hidden passwords, and full session audit logging.

## Suppliers supported

| Supplier | OTP required |
|----------|-------------|
| Hotelbeds | No |
| Beds With Ease | No |
| Altura Beds | No |
| SunHotels (WebBeds) | No |
| Sun International | No |
| SunTransfers | No |
| S Tours | No |
| Yalago | Yes |
| W2M | Yes |

## How it works

1. Agent opens the launcher page and clicks a supplier card.
2. The web app creates a backend session (unique `sessionId`).
3. The Chrome extension opens the supplier portal in a new tab.
4. The extension dismisses cookie banners, clicks any pre-login buttons, detects the login form, requests credentials from the backend, and fills them automatically.
5. The agent never sees the username or password.
6. If the supplier requires an OTP, the agent enters it manually.
7. Every action (page load, click, navigation, booking confirmation, tab close) is logged to the session audit record.

## Local setup

**Requirements:** Node.js 20 or later, Google Chrome.

1. Copy `.env.example` to `.env` and fill in the supplier credentials.
2. Start the server:

```bash
npm start
```

3. Open `http://localhost:3000` in Chrome.
4. Open `chrome://extensions`, enable Developer mode.
5. Click **Load unpacked** and select the `extension/` folder.
6. Reload the launcher page. The status badge should show **Extension connected**.
7. Click a supplier card to test.

Session audit files are written to `backend/session-data/`.

## Project structure

```
supplier-tracker/
├── extension/                    Chrome extension
│   ├── manifest.json             Extension config and permissions
│   ├── background.js             Service worker: tab management, credential flow
│   ├── app-bridge.js             Relays messages from web app to extension
│   ├── supplier-tracker.js       Content script: login fill, tracking, OTP detection
│   └── adapters/                 Per-supplier selectors and rules
│       ├── hotelbeds.js
│       ├── beds-with-ease.js
│       ├── alturabeds.js
│       ├── sunhotels.js
│       ├── sun-international.js
│       ├── suntransfers.js
│       ├── stours.js
│       ├── yalago.js
│       └── w2m.js
├── web-app/                      Agent-facing launcher dashboard
├── backend/                      Session management and event logging
├── deployment/                   GPO deployment template
├── BUILD_PHASES.md               Full build roadmap document
├── .env                          Local credentials (never commit)
└── .env.example                  Safe credential template
```

## Adding a new supplier

See `BUILD_PHASES.md` for the full process. In short:

1. Add the supplier to `SUPPLIERS` in `backend/supplier-sessions/create-session`
2. Add credential mapping in `getSessionCredentials()` in the same file
3. Add environment variables to `.env`
4. Create an adapter file in `extension/adapters/`
5. Add the supplier's domain to `manifest.json` (both `host_permissions` and `content_scripts.matches`)
6. Add the domain to `ALLOWED_HOSTS` in `extension/background.js`
7. Add a card button in `web-app/index.html`
8. Reload the extension and test

## Production deployment

See `BUILD_PHASES.md`, Phase 4 for the full Active Directory GPO deployment instructions.
