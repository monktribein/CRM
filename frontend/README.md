# Bizwoke Nova: Web app

Next.js 16 App Router frontend for Bizwoke Nova. See the [root README](../README.md) for architecture and deployment.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Development server on http://localhost:3000 |
| `npm run build` / `npm start` | Production build / serve |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |

## Environment

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | Yes | Backend base URL **including** `/api/v1`, e.g. `https://api.example.com/api/v1` |
| `NEXT_PUBLIC_DEMO_MODE` | No | `true` enables the in-browser demo API under `next dev` only. Production builds ignore it and strip the demo code |

`NEXT_PUBLIC_*` values are embedded in the browser bundle, so never put secrets in them.

## Structure

```
src/
  app/
    (auth)/           login, forgot/reset password, accept invitation
    (app)/            authenticated workspace (shell + route guard in layout)
      dashboard/ my-tasks/ tasks/ calendar/ projects/ departments/
      employees/ reports/ notifications/ activity/ settings/
    access-denied/  not-found.tsx  error.tsx
  components/
    ui/               shadcn/ui primitives
    layout/           sidebar, topbar, breadcrumbs, global search, nav + route permissions
    tasks/            table, board, calendar, drawer, detail, form, dialogs, badges
    dashboard/ employees/ charts/ common/ providers/
  lib/
    api/              client (envelopes, token refresh), session store, typed services
    demo/             development-only mock API (never shipped)
    types.ts          shared API types (mirror the backend DTOs)
    task-meta.ts      status/priority/deadline semantics
```

Each authenticated page is a small server component (`page.tsx`) that sets metadata and renders a client `view.tsx`.

## How it talks to the API

- **Envelopes:** responses are `{ data, meta? }`; errors are `{ statusCode, message, details? }`. `lib/api/client.ts` unwraps them and raises a typed `ApiError` that carries field errors, which forms map back onto inputs.
- **Sessions:** the access token lives **in memory only**. On load the app calls `POST /auth/refresh`, which uses the HttpOnly `bn_refresh` cookie, to restore the session. A 401 triggers one shared refresh attempt and a retry; if that fails the user is told their session expired and is sent to sign-in with `?next=` set to the page they were on.
- **Permissions:** `/auth/me` returns the user's permission list, which drives navigation and controls. Task actions come from the per-task `capabilities` the API computes. The UI only *hides* controls; the API enforces everything.
- **No mock fallbacks:** if the API fails, the UI shows an error state with a retry button. It never falls back to sample data. Exports report success only after the CSV file has actually downloaded.

## Design system

Defined in `src/app/globals.css` as tokens: a navy sidebar, a light workspace, and a restrained indigo accent. Status colours are semantic (red for overdue or critical, amber for due-soon or blocked, green for completed) and always appear alongside a text label and an icon. Chart series colours were checked with a colour-vision-deficiency validator, and every chart has a "view as table" toggle.
