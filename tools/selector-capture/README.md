# sil-selector-capture

Standalone tool to **harvest stable CSS selectors from supplier portals**
by riding on the agent's own clicks.  Produces a `selector-rules.json`
file ready to drop into the main app as
`backend/classification/selector-rules.json`.

Self-contained — does **not** depend on the parent `supplier-intelligence`
project.  You can copy the whole `tools/selector-capture/` folder to
another machine and run it there.

---

## What it does

1. Opens a real Chromium window.
2. Injects a tiny JS script into every page you visit.
3. Every time you click a button, change a dropdown, pick a date, or
   submit a form, the script picks the **most stable CSS selector** it
   can find for that element (preferring `data-testid` ⇒ readable
   `id` ⇒ `name` ⇒ `role+aria-label` ⇒ text ⇒ structural path) and
   records it to a file.
4. When you're done, a review step walks you through the unique
   selectors and asks for a canonical name (`booking.cancel`,
   `search.submit`, …) → emits `selector-rules.json`.

Supplier login + OTP flows are no problem because *you* are driving
the browser — the tool is purely passive.

---

## One-time setup

```bash
cd tools/selector-capture
npm install
npm run install:browsers          # downloads Chromium (~130 MB, one-time)
```

Node 18+ required.

---

## Daily use

### 1. Edit `targets.json`

Copy the template:

```bash
cp targets.example.json targets.json
```

Then add/remove suppliers as you need:

```json
[
  { "supplier": "hotelbeds",    "url": "https://discover.hotelbeds.com/" },
  { "supplier": "bedswithease", "url": "https://www.bedswithease.com/login" },
  { "supplier": "w2m",          "url": "https://dmc.w2m.travel/" }
]
```

Fields:

- `supplier` — the key used in the main app's `SUPPLIER_CONFIG`
  (lowercase, no spaces).  Captures get grouped by this.
- `url`     — where to start the browser.  You can navigate anywhere
  after it loads — the script captures on every page.

### 2. Capture

```bash
npm run capture
```

What happens:

- Chromium opens with the first supplier's URL.
- A line prints in the terminal every time a click/change/submit is
  captured, e.g.:

  ```
  [  3] click  id               "Sign in"
  [  4] change text             "Destination or hotel"
  [  5] click  text             "Find"
  ```

- You run through the **real agent flow**:
  1. Log in (type the credentials yourself — nothing is auto-filled).
  2. If the supplier uses OTP, type the code.
  3. Click Search, pick a date, enter guests, click Find.
  4. Click a hotel, click Book Now, go through booking confirmation.
  5. Visit "My Bookings", open one, click Cancel, click Confirm Cancel.
  6. Download a voucher / invoice.
  7. Sign out.
- When the flow is done, come back to the terminal and press **Enter**.
  The captures for that supplier are written to
  `captures/<supplier>-<timestamp>.jsonl` and the browser moves on to
  the next supplier.
- Repeat until the whole `targets.json` is walked.

Each supplier takes roughly 10–20 minutes depending on how many flows
you want covered.

### 3. Review

```bash
npm run review
```

Walks you through every unique selector grouped by supplier, newest
and most-frequent first.  For each one it prints:

```
[12/48]  HIGH  7× fired
  label:    "Cancel booking"
  selector: [data-qa="cancel-booking"]
  kind:     data-qa
  urls:     https://www.bedswithease.com/my-bookings/\d+
  html:     <button data-qa="cancel-booking" class="btn btn-danger">Cancel booking</button>
  canonical (or empty to skip)?
```

- Type one of the canonical names (`booking.cancel`, `search.submit`,
  `auth.signin`, …) and press Enter.
- Press Enter on an empty line to **skip** that selector (common for
  nav items you don't care to track).

When finished the tool writes:

```
./selector-rules.json
```

### 4. Drop into the main app

Copy that file into the main project:

```bash
cp selector-rules.json ../../backend/classification/selector-rules.json
```

Then restart the main server (`npm start` in the project root).  The
server-side `classifyEvent` checks `selector-rules.json` first and
tags matching clicks with your chosen canonical.

---

## Output file shape

### `captures/<supplier>-<timestamp>.jsonl`

One JSON object per captured action:

```jsonc
{
  "event":        "click",                 // "click" | "change" | "submit"
  "supplier":     "bedswithease",
  "url":          "https://www.bedswithease.com/my-bookings/123",
  "pageTitle":    "Booking details",
  "selector":     "[data-qa=\"cancel-booking\"]",
  "selectorKind": "data-qa",               // automation attribute used
  "stability":    "high",                  // high | medium | low
  "candidates":   [ /* every selector we could have picked */ ],
  "label":        "Cancel booking",
  "role":         "button",
  "htmlSnippet":  "<button data-qa=\"cancel-booking\" …>Cancel booking</button>",
  "capturedAt":   "2026-10-05T12:03:17.882Z"
}
```

### `selector-rules.json`

Ready-to-ship for the main app:

```jsonc
{
  "bedswithease": [
    {
      "when": {
        "urlPattern": "^https://www.bedswithease.com/my-bookings/\\d+",
        "selector":   "[data-qa=\"cancel-booking\"]",
        "label":      "Cancel booking"
      },
      "canonical": "booking.cancel",
      "stability": "high",
      "notes":     "Captured 2026-10-05; label \"Cancel booking\""
    }
  ],
  "hotelbeds": [ … ]
}
```

---

## Tips

- **Keep the terminal visible beside the browser** — you can see the
  capture firing in real time, which confirms the script is working
  and shows what label it picked.
- **Capture a button twice** if you want to be sure the selector
  stayed the same (same selector string ⇒ stable; different ⇒
  volatile, pick a canonical that uses URL as well).
- **Password fields are never captured.**  Values from text/email
  inputs are not captured either.  Dropdowns, dates, checkboxes and
  radios DO include the chosen value (bounded UI, not PII).
- You can run capture **multiple times** and the review step merges
  them — handy for adding a flow you forgot the first time.
- **Nothing is sent to the cloud.** Everything stays on your machine
  inside `tools/selector-capture/captures/`.

## Troubleshooting

- *"Browser does not open"* — did you run `npm run install:browsers`?
- *"No captures recorded"* — the console in the browser should print
  `[SIL capture] active on <hostname>` on page load.  If not, the
  page may be inside an `<iframe>` the script wasn't injected into;
  navigate to the top frame.
- *"Stability: low on everything"* — the supplier doesn't use
  `data-*` attributes.  Hand-written rules keyed on URL + label will
  still work fine; just expect to re-capture after major UI redesigns.
