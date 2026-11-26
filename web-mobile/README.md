# PokeIdle Multi — Web Mobile

> Work in progress. This folder is the planned browser-based companion; it does not replace or modify the existing Electron desktop app.

## Product target

- Mobile-first PWA, usable from Android Chrome.
- Four independent PokeIdle browser sessions.
- One visible account at a time, with a quick account switcher.
- Persistent login per account, isolated cookies and local storage.
- Server-side browser execution: the phone is a remote control/display, not the host for four heavy game tabs.

## Architecture

```
Android browser (PWA)
  ├─ account switcher (1–4)
  ├─ active remote browser view
  └─ touch / keyboard input
          │ authenticated realtime channel
          ▼
Node.js service
  ├─ session manager (max 4)
  ├─ account 1 → isolated persistent Chromium profile
  ├─ account 2 → isolated persistent Chromium profile
  ├─ account 3 → isolated persistent Chromium profile
  └─ account 4 → isolated persistent Chromium profile
```

The service must never expose Chromium's debugging port directly to the public internet. Browser sessions and their profile directories must be scoped to the authenticated user.

## Delivery stages

1. **Foundation:** service skeleton, authentication boundary, four isolated persistent browser contexts, health checks.
2. **Mobile UI:** responsive account switcher, active account view, touch-friendly controls, reconnect/error states.
3. **Remote interaction:** low-latency video/frame transport plus pointer, touch, and keyboard input. Select the transport after a small prototype and mobile-network tests.
4. **Compatibility:** audit desktop features one by one; port only those that make sense in a browser-hosted service.
5. **Deployment:** HTTPS, secure secrets, persistent storage, resource limits, and operational documentation.

## Run locally

Requirements: Node.js 22.12+ and npm.

```bash
npm install
npx playwright install chromium
# Linux servers may also need: npx playwright install-deps chromium
PKMOBILE_TOKEN="$(node -e \"console.log(require('node:crypto').randomBytes(32).toString('hex'))\")" npm run web:start
```

Open `http://localhost:3000` on the phone or computer. Enter the same `PKMOBILE_TOKEN` in the settings button (⚙). For local-only development, `npm run web:dev` skips API authentication; never use that mode on a public server.

Persistent browser profiles are written to `web-mobile/data/profiles/account-1` through `account-4`. Back up this directory securely if you need to preserve logins. Do not publish it or commit it.

The current MVP refreshes a JPEG screenshot about once per second and forwards basic taps, scrolls and keyboard input. This is functional for an initial test, but it is not a low-latency video stream. Put the service behind HTTPS before accessing it outside a trusted local network.

## Compatibility notes

The desktop application is built around Electron `BaseWindow` / `WebContentsView` and Electron session partitions. A web version cannot simply reuse those APIs. The web service needs independent Chromium profiles and a remote-view layer.

The existing extension integrations, Twitch/Kick helpers, native dialogs, updater, and desktop-specific controls need separate compatibility work. They are not assumed to work in the first mobile MVP.

## Initial acceptance criteria

- Four accounts can be created and remain logged in independently.
- Switching accounts changes the visible remote session without mixing cookies or local storage.
- Reloading the PWA or restarting the service does not silently merge or erase profiles.
- The interface works in a narrow Android viewport.
- All remote-browser access is authenticated; no public CDP endpoint.
