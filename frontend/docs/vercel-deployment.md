# Vercel deployment

Set the Vercel project Root Directory to `frontend`. The checked-in
`vercel.json` builds the Vite app with `VITE_API_SAME_ORIGIN=true`, proxies
`/api/*` to `https://planit-control-core.onrender.com/api/*`, and serves
`index.html` for application routes such as `/sign-in`, `/sites/...` and
`/settings/account`. Static assets and API errors do not use the SPA fallback.

The browser sends login, refresh, password changes, logout and other API calls
to the frontend origin. Core's host-only, HttpOnly, SameSite=Lax refresh cookie
is therefore first-party, including in browsers that block third-party cookies.
Keep Core in production mode so it sets Secure cookies. No token lifetime,
backend cookie policy, database or ML changes are required.

An existing `VITE_API_BASE_URL` pointing at Render does not bypass the proxy
in Vercel builds. Other hosts and local development retain that setting.
If the Core hostname changes, update the API destination in `vercel.json`.

After deployment, sign in again once: cookies previously set for Render cannot
be read on the Vercel domain. Check that `/api/auth/login` sets an HttpOnly
cookie for the frontend domain, then hard-refresh `/` and a nested route.
`/api/auth/refresh` should return 200 and retain the workspace. A rejected
refresh cookie redirects to sign-in; a temporary 5xx displays retry recovery.
An unauthenticated refresh should return the API's JSON 401, never index.html.
