# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CoursPool is a mobile-first web app (also packaged as a native iOS app via Capacitor) that connects students and teachers for shared-cost courses. Students discover, book, and pay for courses; teachers create and manage them.

- **Web deployment:** https://courspool.vercel.app
- **Backend API:** https://devoted-achievement-production-fdfa.up.railway.app
- **Bundle ID:** `com.courspool.app`

## Commands

There are no build or lint scripts. The web app is a single static HTML file with no build step.

**Sync web assets to iOS:**
```bash
npx cap sync ios
```

**Open in Xcode:**
```bash
npx cap open ios
```

## Architecture

The frontend is split across three files in `/www/`:
- **`index.html`** (~1572 lines) — HTML markup + one small inline script (dark mode, must stay inline)
- **`style.css`** (~710 lines) — all CSS including dark mode, animations, and component styles
- **`app.js`** (~4223 lines) — all JavaScript (~202 functions)

There is no framework (no React, Vue, etc.) and no bundler.

**`/index_final.html`** at the root is a backup of the original monolithic version — do not edit it.

### Global State

```js
var C = [];         // courses array (fetched from API)
var P = {};         // profiles/people object (keyed by user ID)
var res = {};       // reservations object
var fol = new Set();// followed user IDs
var user = null;    // current authenticated user
```

State is managed entirely in global variables. LocalStorage is used for user preferences:
- `cp_dark` — dark mode toggle (0, 1, or null)
- `cp_filter` — last active filter
- `cp_niv` — last selected level filter
- `cp_unread` — unread message count

### Navigation Model

Pages are shown/hidden via DOM display toggling. Key page IDs: `pgAcc` (account), `pgMsg` (messages). Navigation functions: `navTo()`, `goExplore()`, `goAccount()`.

### API Integration

All API calls go to the Railway backend. Key endpoint groups:
- `/auth/login`, `/auth/register`
- `/cours` (CRUD for courses), `/cours/code/{code}`
- `/reservations/cours/{id}`, `/reservations/{id}`
- `/messages`, `/messages/groupe`
- `/follows/{id}`
- `/stripe/payment-intent`, `/stripe/confirm-payment`, `/stripe/connect/*`
- `/push/subscribe`, `/notations/{id}`

### iOS Integration

Capacitor bridges the webview to native iOS APIs. Plugins used: Haptics, Keyboard, Splash Screen, Status Bar. The iOS app webview serves `/ios/App/App/public/index.html` (a copy of `www/index.html`). After editing `www/index.html`, run `npx cap sync ios` to copy it to the iOS project.

### Key UI Patterns

- Dark mode: `.dk` class on `<html>` element
- Bottom sheets / modals: `.modal` / `.bd` classes
- Loading skeletons: `.skeleton` class with shimmer animation
- iOS safe area insets used throughout for notch/home indicator support
- Primary color: `#FF6B2B` (orange)
