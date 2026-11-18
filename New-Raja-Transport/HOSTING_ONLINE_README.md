# Deploy New Raja Transport online (full functionality)

## Why the Netlify Drop deploy shows 404

Netlify Drop publishes static files. In the original ZIP the page is nested at `New-Raja-Transport/public/index.html`, not at the uploaded root. Uploading the whole ZIP directly can lead to a **404 Site not found**. Upload the separate `New-Raja-Transport-Netlify-Frontend-Only.zip` to fix the page, but **the booking and payment features still require a backend server and durable SQLite database**.

## Recommended: deploy the entire working app to Render

This folder includes `render.yaml` for a Node.js web service with a **paid** persistent disk mounted at `/var/data`, which is where the SQLite database is stored. Do not use an ephemeral/free filesystem for real customer records.

1. Extract this ZIP and push the **contents** (not a parent directory) to a new private GitHub repository. Do **not** add `data/` or any customer records.
2. At https://dashboard.render.com choose **New > Blueprint**; connect the repository. Render reads `render.yaml`.
3. Review the service and persistent disk charges. The service needs a plan that supports a persistent disk. Confirm it includes `DATA_DIR=/var/data`, `TRUST_PROXY=true`, `COOKIE_SECURE=true` and Node 24.
4. Once deployment is Live, use the Render URL such as `https://new-raja-transport-xxxx.onrender.com/`. (This is an example; Render determines the real address.)
5. Check `https://YOUR-RENDER-URL/api/status`: it must return JSON containing `setup_required`. If the service is healthy, open the home page and immediately create your admin account with a strong password. **Before creating the admin, keep the URL private**: the first visitor can register the first administrator on a newly initialized database.
6. Test Customers > Add customer, Bookings > Add booking, Payments > Record payment. Verify the data survives a restart. Download backups regularly via Settings & Backup and store them off-server.

### Security and origin handling

This edition fixes HTTPS reverse-proxy origin checks using `TRUST_PROXY=true` (only enable behind a trusted proxy such as Render). If you set `PUBLIC_ORIGIN`, use the exact public website origin without a trailing slash, e.g. `https://example.com`. `COOKIE_SECURE=true` requires HTTPS. When running locally over HTTP keep `TRUST_PROXY=false` and `COOKIE_SECURE=false`.

### Existing Netlify domain

If you want the current Netlify domain `https://nrajat.netlify.app` to direct visitors to your working service, after your Render service is live you can deploy a Netlify `_redirects` file with a redirect such as:

```
/*  https://YOUR-RENDER-SERVICE.onrender.com/:splat  302!
```

This changes the visitor's URL to your Render site, and avoids mixing frontend and backend origins. Using Netlify as a reverse proxy would require additional tested authentication/proxy configuration and is not part of this package.

## Local Windows use

Install Node.js 22.13+ and run `START_WINDOWS.bat`. Your local database is stored in `data/`. The bundled `render.yaml` has no effect on local Windows startup.

## Test

```
node --check server.js
node --check public/app.js
python tests/test_api.py
```

Important: This deployment package does not make changes to your existing Netlify account or deploy a server on your behalf.
