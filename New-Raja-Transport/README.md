# New Raja Transport

**Transport booking, payment and overdue management for PC and mobile browsers.**

This is a working locally hosted web application with a real SQLite database. It is not just an HTML mock-up. All connected devices work with the **same records**, as long as they reach the same running server. No subscriptions, API keys, database installation, or `npm install` are required.

## 1. Start on Windows (easiest)

1. Download and install **Node.js 22.13 or newer**, preferably the current supported LTS version, from https://nodejs.org/ . Node is the server runtime; it is required.
2. Extract the entire `New-Raja-Transport.zip` to a folder such as `C:\New-Raja-Transport`.
3. Double-click **`START_WINDOWS.bat`**. Keep the black terminal window running.
4. Open **http://localhost:3000** in Chrome, Edge, or another current browser.
5. On first use, **create your own administrator username and a strong password**. Save the password securely; the app cannot recover it for you.
6. In the app, open **Customers > Add customer**, then **Bookings / LR > Add booking**, then **Payments > Record payment**.

Alternatively, in the extracted directory, run:

```powershell
node server.js
```

> The first startup creates a new database automatically at `data/new-raja-transport.sqlite`. If you close the terminal, the app server stops, but saved records remain on disk. A warning about `node:sqlite` being experimental may appear on some Node 22 versions; the functionality has been tested on Node.js 22.16.

## 2. Open the same software on a mobile phone

The PC and phone must be on the **same private Wi-Fi network**. The PC must remain on, with the server running.

1. On Windows, open Command Prompt and type `ipconfig`.
2. Under your Wi-Fi adapter, find **IPv4 Address**. For example `192.168.1.25` (this is only an example, not your IP).
3. On your phone, open Chrome or Safari and visit `http://YOUR-PC-IP:3000` (example: `http://192.168.1.25:3000`).
4. Sign in with the same username and password you created on the PC.
5. If the page cannot load, permit Node.js / TCP port **3000** in Windows Firewall **only on Private networks**. Do not open this port publicly to the internet.

**Mobile installation:** The website is responsive. Add it to the phone's home screen for quick access. A true installable PWA may require serving it over HTTPS; plain local-network HTTP is not treated as a secure context by some browsers. The main software works in the mobile browser without installing an app. **Financial records require a connection to the running server**; they are not editable offline.

## 3. What you can manage

| Section | Capabilities |
| --- | --- |
| Dashboard | Total freight, collections, outstanding, overdue, oldest late payers, six-month performance |
| Customers | Account name, phone, WhatsApp, GSTIN, address, customer-wise ledger |
| Bookings / LR | LR/GR number, billing customer, sender, receiver, route, packages, weight, freight, vehicle, driver, goods, promised payment due date, delivery status |
| Payments | Part payments and full settlement, payer name, amount, date, Cash/UPI/Bank/Cheque, reference/UTR, receipt printing |
| Pending collections | Unpaid invoices, due in the next 7 days, overdue days, balances, WhatsApp reminder with a pre-filled message |
| Expenses | Diesel/fuel, toll/FASTag, vehicle repairs, driver advances, wages, office costs |
| Reports | Period-wise billed freight, collected revenue, expenses, net cash flow, customer balances, overdue aging |
| Downloads | LR print, payment receipt print, booking/payment/customer/expense CSV exports, JSON backup/restore |
| Settings | Business name, GSTIN, contact and address on printed documents, default payment term |

### Example accounting flow

- Create booking **NRT-001** for billed freight **₹20,000**, due **1 December**.
- Receive **₹8,000** from **ABC Traders** by UPI and record the UTR.
- Remaining collection automatically becomes **₹12,000**.
- On **5 December**, with ₹12,000 still unpaid, the booking shows **4 days overdue**.
- Receive another ₹12,000, and the booking becomes **Paid**; both transactions remain in its payment history.

**Important distinction:** The expense and collection report shows *cash flow*, not audited accounting profit. Freight billed, collections, expenses, GST, vendor payables and accruals are different concepts.

## 4. Your data, backup and recovery

- Business records are saved in **SQLite**, at `data/new-raja-transport.sqlite`. Data is not stored only in the browser.
- In **Settings & Backup**, use **Download full backup** regularly to save a JSON copy elsewhere (e.g. secure external drive / encrypted cloud storage).
- **Restore from backup** deletes/replaces current customer, booking, payment and expense records. The app asks for confirmation twice. Always download a fresh backup first.
- If moving the installation to a different computer, move the entire folder, including its **data** directory. A restored JSON backup can also transfer data.
- The `data` directory is ignored by Git. Do **not** commit business data or backup files into a public code repository.
- Database access must be limited to trusted users. Backups contain customer contact and financial information and are **not encrypted**.

## 5. Internet access, hosting, production use

The supplied software is a **working local-network MVP**, not a fully hardened multi-user SaaS. It supports one administrator account and records all activity under that account; it is not suitable for multi-branch permissions or audit-compliant workflows without further work.

For access anywhere over the internet, install it on a dedicated server with **persistent disk** and a proper **HTTPS reverse proxy**, ensure routine off-site backups, protect server access, set up monitoring and perform a security review. Avoid free hosting with an ephemeral filesystem; the database will be lost after restart/redeployment. Run the server behind a reverse proxy, not directly on a publicly reachable port.

For example, with HTTPS hosted at `https://transport.example.com`:

```bash
PORT=3000 HOST=127.0.0.1 PUBLIC_ORIGIN=https://transport.example.com COOKIE_SECURE=true node server.js
```

The example domain above is a placeholder; this package does **not** include a registered domain or deployment. `COOKIE_SECURE=true` requires HTTPS, so do not use that for plain HTTP local Wi-Fi use.

**Not included:** Payment gateway integration, SMS delivery, GPS tracking, automated WhatsApp sending, GST-compliant tax invoices/e-way bills, payroll, carrier integrations, separate staff roles, guaranteed offline editing, or a cloud-hosted server. Printed LR and receipt templates are for business records; verify legal/tax document requirements with your accountant before treating them as compliant invoices.

## 6. Tests and development

Requires Python 3 (only for running automated tests; not required for actual usage).

```bash
node --check server.js
node --check public/app.js
python tests/test_api.py
```

The automated API tests use a temporary database, never your real `data` directory. They cover first account setup, login enforcement, customers, bookings, partial payments, overpayment prevention, overdue calculations, CSV export, expenses, backup, and restore.

Environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Web server port |
| `HOST` | `0.0.0.0` | Interfaces to listen on; use `127.0.0.1` for local-only |
| `DATA_DIR` | `<project>/data` | SQLite data location; use a persistent drive |
| `APP_TIMEZONE` | `Asia/Kolkata` | Business date/time |
| `PUBLIC_ORIGIN` | none | Exact HTTPS origin for remote reverse-proxy setup |
| `COOKIE_SECURE` | `false` | Set `true` when accessing only via HTTPS |

Dependencies: **Node.js built-in standard modules only** (`node:http`, `node:sqlite`, etc.). There is no `node_modules` folder to install.

---

Built for **New Raja Transport**. Please validate with actual operational data before full deployment.


## Online deployment fixes

See [HOSTING_ONLINE_README.md](HOSTING_ONLINE_README.md) and `render.yaml` for the fixed hosted deployment.
