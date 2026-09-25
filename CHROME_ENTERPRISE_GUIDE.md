# Chrome Enterprise Core — Deployment & Policy Guide

This document covers how to deploy the Supplier Session Tracker extension and enforce the required browser security policies using Chrome Enterprise Core. It follows the approach discussed in the email thread and replaces the AD/GPO-only route with Chrome Enterprise Core as the primary management platform.

---

## Why Chrome Enterprise Core

Chrome Enterprise Core is free (no Google Workspace required) and gives centralized, cloud-based control over Chrome browsers across the agent estate. It provides:

- Force-install the extension on every enrolled browser
- Enforce password manager and autofill policies
- Browser-level reporting and visibility
- Coverage for any off-domain or non-Windows machines if needed later
- Policy management from a web console rather than on-premises GPO

If AD/GPO is also in place, policies can be set in both so neither can be overridden by the other.

---

## Step 1: Set up Chrome Enterprise Core

### 1.1 Create a Chrome Enterprise Core account

Go to https://chromeenterprise.google/ and sign up. No Google Workspace subscription is required — Chrome Enterprise Core is a separate, free product.

### 1.2 Get the enrollment token

In the Admin Console → Devices → Chrome → Managed browsers:
- Click **Enroll browser** (or **+ New enrollment token**)
- Give it a name like "Teletext Agent Machines"
- Copy the token string — this is what each agent machine needs

### 1.3 Deploy the enrollment token to agent machines

The enrollment token can be distributed by:

**Via Group Policy (since AD is already in place):**
- Download the Chrome ADMX templates from https://chromeenterprise.google/browser/download/
- Copy ADMX/ADML files to the AD Central Store
- Create a GPO linked to the agent-machine OU
- Set: Computer Configuration → Administrative Templates → Google Chrome → Cloud management enrollment token → paste the token
- After the next `gpupdate` cycle, Chrome on each machine enrolls itself with Chrome Enterprise Core

**Or via registry (for a quick test):**
```
reg add HKLM\SOFTWARE\Policies\Google\Chrome -v CloudManagementEnrollmentToken -t REG_SZ -d "YOUR_TOKEN_HERE"
```

### 1.4 Verify enrollment

On a test machine:
- Open `chrome://policy` and confirm the `CloudManagementEnrollmentToken` policy is set
- In the Admin Console → Managed browsers, the machine should appear within minutes

---

## Step 2: Force-install the extension

### 2.1 Host the extension internally

**Do not publish to the Chrome Web Store** (public or unlisted). The extension handles credential flows and the code should not be publicly accessible.

Package and host internally:

1. Package the `extension/` folder into a signed `.crx`:
   ```
   chrome.exe --pack-extension="C:\path\to\extension" --pack-extension-key="C:\path\to\key.pem"
   ```
   On first run, omit `--pack-extension-key` to generate a new `.pem`. **Store the `.pem` in a secrets vault** — it is needed for every future update and cannot be replaced.

2. Upload `supplier-tracker-1.2.0.crx` and `update_manifest.xml` to an internal HTTPS server:
   ```
   https://extensions.company.internal/supplier-tracker/supplier-tracker-1.2.0.crx
   https://extensions.company.internal/supplier-tracker/update_manifest.xml
   ```

3. `update_manifest.xml` content:
   ```xml
   <?xml version="1.0" encoding="UTF-8"?>
   <gupdate xmlns="http://www.google.com/update2/response" protocol="2.0">
     <app appid="REPLACE_WITH_EXTENSION_ID">
       <updatecheck
         codebase="https://extensions.company.internal/supplier-tracker/supplier-tracker-1.2.0.crx"
         version="1.2.0" />
     </app>
   </gupdate>
   ```

### 2.2 Configure force-install in the Admin Console

In the Admin Console → Devices → Chrome → Settings → Users & Browsers:

- Search for **Extensions** → **Force-installed apps and extensions**
- Add: `EXTENSION_ID;https://extensions.company.internal/supplier-tracker/update_manifest.xml`
- Apply to the OU covering agent machines

**Result:** Chrome installs the extension automatically on every enrolled browser. Agents cannot remove or disable it.

---

## Step 3: Enforce browser security policies

These policies are set in the Admin Console → Devices → Chrome → Settings → Users & Browsers. Apply them to the agent-machine OU.

### 3.1 Disable Chrome's password manager

**Policy:** `PasswordManagerEnabled` → **Disabled** ("Never allow use of the password manager")

What this does:
- Chrome's built-in password manager is turned off completely
- The "Save password?" prompt never appears
- Agents cannot save supplier credentials to their browser profile
- Previously saved passwords are no longer accessible through the browser

This is a **mandatory control** for the extension deployment. Without it, an agent could have supplier passwords saved in `chrome://settings/passwords`, visible and accessible outside the managed workflow entirely.

### 3.2 Disable autofill

**Policy:** `AutofillAddressEnabled` → **Disabled**

Stops Chrome from autofilling address fields in supplier booking forms.

**Policy:** `AutofillCreditCardEnabled` → **Disabled**

Stops Chrome from autofilling payment fields in supplier forms.

### 3.3 Lock browser sign-in

**Policy:** `BrowserSignin` → **Force-disabled** or **Managed accounts only**

This prevents agents from signing into Chrome with a personal Google account. Without this, a personal password vault would sync into the managed browser — including any supplier passwords the agent may have saved at home or on a personal device.

### 3.4 Block unapproved extensions

**Policy:** `ExtensionInstallBlocklist` → `*` (block all)

**Policy:** `ExtensionInstallAllowlist` → `SUPPLIER_TRACKER_EXTENSION_ID`

This ensures agents cannot install any extension other than the managed Supplier Session Tracker — including third-party password managers (LastPass, Bitwarden, etc.) that would bypass the `PasswordManagerEnabled` policy.

### 3.5 Disable Incognito and Guest mode

**Policy:** `IncognitoModeAvailability` → **Disabled** (Incognito mode not available)

**Policy:** `BrowserGuestModeEnabled` → **Disabled**

Prevents agents from opening an unmanaged browser session where policies would not apply.

### 3.6 Summary of all policies

| Policy | Setting | Purpose |
|--------|---------|---------|
| `PasswordManagerEnabled` | Disabled | No "Save password?" prompt, no saved credentials |
| `AutofillAddressEnabled` | Disabled | No address autofill in supplier forms |
| `AutofillCreditCardEnabled` | Disabled | No payment autofill in supplier forms |
| `BrowserSignin` | Force-disabled or managed-only | No personal Google account sync |
| `ExtensionInstallBlocklist` | `*` | Block all extensions |
| `ExtensionInstallAllowlist` | `<extension-id>` | Allow only the managed extension |
| `IncognitoModeAvailability` | Disabled | No Incognito mode |
| `BrowserGuestModeEnabled` | Disabled | No Guest mode |
| `ExtensionInstallForcelist` | `<extension-id>;update-manifest-url` | Force-install the extension |

---

## Step 4: Apply the same policies via AD/GPO (belt and braces)

If you are running both Chrome Enterprise Core and AD/GPO, set every policy in both places so neither can be overridden.

In Group Policy Management → create a GPO linked to the agent-machine OU:

Computer Configuration → Administrative Templates → Google Chrome:

| GPO path | Setting |
|----------|---------|
| Password manager → Enable saving passwords to the password manager | **Disabled** |
| → Allow users to use the built-in password manager | **Disabled** |
| Autofill → Enable AutoFill for addresses | **Disabled** |
| Autofill → Enable AutoFill for payment methods | **Disabled** |
| Browser sign-in settings | **Disable browser sign-in** |
| Extensions → Configure the list of force-installed apps and extensions | `<ext-id>;update-manifest-url` |
| Extensions → Configure extension installation blocklist | `*` |
| Extensions → Configure extension installation allowlist | `<ext-id>` |
| Incognito mode availability | **Incognito mode disabled** |
| Allow guest mode | **Disabled** |

---

## Step 5: Verify on a test machine

1. Enroll a test machine (enrollment token deployed via GPO or registry)
2. Run `gpupdate /force` and restart Chrome
3. Open `chrome://policy` — verify all policies appear:
   - `PasswordManagerEnabled` = false
   - `AutofillAddressEnabled` = false
   - `AutofillCreditCardEnabled` = false
   - `BrowserSignin` = 0 or 2
   - `ExtensionInstallBlocklist` = *
   - `ExtensionInstallAllowlist` = [extension-id]
   - `ExtensionInstallForcelist` = [extension-id;url]
4. Open `chrome://extensions` — confirm the extension shows as "Installed by enterprise policy"
5. Try to remove the extension — it should be greyed out
6. Open `chrome://settings/passwords` — password manager should show as "Controlled by your organization" and be disabled
7. Open the internal launcher → click a supplier → verify credentials are filled under the overlay → agent sees "Signing in…" shield → dashboard loads → overlay removed

---

## Step 6: Roll out to all agent machines

After pilot verification:

1. Link the enrollment-token GPO to the full agent-machine OU
2. All 132 machines enroll on their next policy refresh
3. Chrome Enterprise Core policies apply automatically to enrolled browsers
4. The extension is force-installed on every browser

---

## Ongoing: Extension updates

1. Increment `version` in `manifest.json`
2. Repackage the CRX with the same `.pem` signing key
3. Upload the new CRX to the internal HTTPS server
4. Update `update_manifest.xml` with the new version and CRX filename
5. All enrolled browsers pick up the update within Chrome's polling interval (usually a few hours)
6. No touching individual machines

---

## Gap that policies alone do not close

Force-installing via Chrome Enterprise Core and blocking extensions prevents credential leakage within managed Chrome. It does **not** prevent an agent from:

- Opening a supplier portal directly in a different browser (Firefox, Edge)
- Running a portable browser from a USB drive
- Accessing credentials from a personal device

This gap requires **endpoint policy** — application control to restrict unapproved browsers and portable executables on agent machines. This is an IT/Security action alongside the Chrome management work, not a Chrome policy decision.
