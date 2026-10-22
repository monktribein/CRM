# Bizwoke Nova

Enterprise task-management CRM for multi-department organisations: role-aware dashboards, task assignment and review workflows, employee and department management, reporting, notifications and an audit trail.

| Part | Stack | Deploys to | Docs |
|---|---|---|---|
| [`frontend/`](frontend/) | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, shadcn/ui, TanStack Query, React Hook Form + Zod, Recharts, Framer Motion | Vercel | [frontend/README.md](frontend/README.md) |
| [`backend/`](backend/) | NestJS 12, TypeScript, MongoDB (Mongoose 9), JWT + rotating refresh tokens, Argon2id, Swagger | Render | [backend/README.md](backend/README.md) · [database](backend/docs/DATABASE.md) |

```
Browser ──HTTPS──▶ Vercel (Next.js UI)
   │  Authorization: Bearer <15-min access token>
   │  Cookie: bn_refresh (HttpOnly, Secure, SameSite=None, path=/api/v1/auth)
   └──────HTTPS──▶ Render (NestJS API, /api/v1) ──▶ MongoDB Atlas
```

**Security model:** the backend is the security boundary. Every request is authenticated, the user's role and status are re-read from the database on each request, and every endpoint applies permission guards and resource-level scoping (organisation → department → assignee). The frontend hides what a user can't do, but never relies on that for protection.

## Run locally

Prerequisites: **Node.js 24+** and **MongoDB 5.0+** (local install or a free [MongoDB Atlas](https://www.mongodb.com/atlas) cluster).

```bash
# 1. API — backend/.env already exists with generated JWT secrets.
#    Paste your Atlas connection string into it:  MONGODB_URI=mongodb+srv://...
#    The Super Admin and demo-data passwords are already filled in there.
cd backend
npm install
npm run db:check                   # verifies the connection (never prints the URI)
npm run db:setup                   # indexes + organisation + Super Admin + demo data (one step, idempotent)
npm run start:dev                  # http://localhost:4000/api/v1 · docs at /api/v1/docs

# 2. Web app (second terminal) — frontend/.env.local already points at the local API
cd frontend
npm install
npm run dev                        # http://localhost:3000 → sign in as the Super Admin
```

Both env files are git-ignored. On a fresh clone, copy `backend/.env.example` → `backend/.env` and `frontend/.env.example` → `frontend/.env.local` first. Database design, indexes, backups and example queries: [backend/docs/DATABASE.md](backend/docs/DATABASE.md).

### Accounts for checking everything

`npm run db:setup` (development) creates these in one organisation, so the admin sees all demo data:

| Role | Email | Password |
|---|---|---|
| **Super Admin** (everything) | `SEED_ADMIN_EMAIL` | `SEED_ADMIN_PASSWORD` |
| Manager (Development) | `daniel.brooks@example.com` | `SEED_DEV_PASSWORD` |
| HR Manager | `rachel.owens@example.com` | `SEED_DEV_PASSWORD` |
| Employee | `sarah.mitchell@example.com` | `SEED_DEV_PASSWORD` |

Passwords are never committed: set them in your local, git-ignored `backend/.env`. Use a strong, unique `SEED_ADMIN_PASSWORD` for any shared or production environment.

Values come from `SEED_ADMIN_*` / `SEED_DEV_PASSWORD` in `backend/.env`; change them there before running `db:setup` if you prefer. In production only the Super Admin is created — demo users are never loaded.

Public sign-up does not exist. `db:bootstrap` creates the first Super Admin, and administrators create every other account from **Employees → Add employee**.

**UI-only development without a backend:** set `NEXT_PUBLIC_DEMO_MODE=true` in `frontend/.env.local` and run `npm run dev`. This starts an in-browser mock API with sample data and demo accounts that use the password `Demo@1234` (`admin@`, `manager@`, `hr@`, `employee@bizwoke.dev`). It is development-only: production builds strip the demo code completely.

## Deploy

### 1. Database: MongoDB Atlas
1. Create a cluster (MongoDB 5.0+), a database user with a strong password, and allow access from Render. Render's outbound IPs are listed in the service's *Connect* tab. Allowing `0.0.0.0/0` only works because authentication is still enforced.
2. Copy the connection string, e.g. `mongodb+srv://user:pass@cluster.example.mongodb.net/bizwoke-nova`.

### 2. API: Render
1. In the Render dashboard, choose **New → Blueprint** and select this repository. [`render.yaml`](render.yaml) defines the service (root `backend/`, Node 24, health check `/api/v1/health`) and generates both JWT secrets.
2. Set the secret environment variables in the dashboard:
   - `MONGODB_URI`: the Atlas connection string.
   - `FRONTEND_URL`: your Vercel URL, e.g. `https://bizwoke-nova.vercel.app`. Use commas to list several origins; each must be `https://`.
   - Optional: `SMTP_*` and `MAIL_FROM` for email, `SWAGGER_*` for protected docs.
3. After the first deploy, open the service's **Shell** and run once:
   `npm run db:indexes` then `SEED_ADMIN_EMAIL=you@company.com SEED_ADMIN_PASSWORD='…' npm run db:bootstrap`
   (never run `db:seed` in production; it refuses to anyway)
4. Check `https://<service>.onrender.com/api/v1/health`. It should return `{"data":{"status":"ok","database":"up",…}}`.

### 3. Web app: Vercel
1. Choose **Add New → Project**, import the repository, and set **Root Directory** to `frontend`. Vercel detects the framework as Next.js.
2. Add the environment variable `NEXT_PUBLIC_API_URL=https://<service>.onrender.com/api/v1`, then deploy.
3. If the Vercel URL changes, for example when you add a custom domain, update `FRONTEND_URL` on Render to match. Otherwise CORS and the refresh-cookie origin check will reject the frontend.

> **Cookies across sites.** `*.vercel.app` and `*.onrender.com` are different sites, so the refresh cookie is sent with `SameSite=None; Secure`. Some browsers with strict third-party-cookie blocking can drop it, which means users have to sign in again after a reload. The robust fix is to serve both apps from one domain, e.g. `app.example.com` and `api.example.com`, with `COOKIE_DOMAIN=.example.com`.

## Verification status

What has actually been run in this repository:

| Check | Result |
|---|---|
| `frontend`: `tsc --noEmit`, `eslint`, `next build` | Pass. 24 routes generated, no type errors |
| `frontend`: every route compiled and requested on `next dev` | Pass. Each route returns 200 with zero framework diagnostics |
| `frontend`: production bundle inspected for demo code | Pass. The demo API and dataset are absent |
| `backend`: `tsc`, `nest build`, `oxlint` | Pass. The linter reports only stylistic warnings |
| `backend`: unit tests (`npm test`) | 41/41 pass: workflow rules, role grants, access scoping, sanitisation, credential redaction, env validation |
| `backend`: integration tests (`npm run test:e2e`, real app + in-memory MongoDB 8.2) | 76/76 pass: auth, token rotation and reuse detection, permissions and scoping, assignments, transitions, deadlines, reports/CSV, rate limiting, plus database constraints/validators/TTL indexes, cross-organisation isolation, request-ID auditing and seed idempotency, per-account rate limiting |
| **Full stack in a real browser** (Playwright/Chromium → Next.js production build → NestJS → MongoDB 8.2, seeded with `db:setup`) | 63 page loads across Super Admin, Manager, HR Manager and Employee with **0** console errors, exceptions, failed API calls, error states or mobile overflow; 14/14 workflows pass (manager creates & assigns a task → employee starts it, logs time, comments with @mention, submits for review → manager approves → notifications; admin creates an employee with invitation link, exports CSV, edits org settings, global search, board view); screenshots reviewed manually |
| `backend`: `db:check` / `db:indexes` / `db:bootstrap` / `db:seed` run against a real mongod | Pass. Idempotent re-runs create nothing; `db:seed` refuses `NODE_ENV=production`; an unreachable host fails fast without printing the password |
| `backend`: production-mode boot of `dist/` + seed + HTTP smoke test | 17/17 pass: health, helmet headers, Secure/SameSite=None cookie, CORS allow/deny, refresh, protected Swagger, error format, graceful SIGTERM shutdown, no secrets in logs |

**Not verified:** actual deployment to Render or Vercel, and connectivity to *your* MongoDB Atlas cluster (run `npm run db:check` after pasting the URI). Those have not been run. 

## Known limitations

- **Attachments are links plus metadata.** No binary upload or storage is included; users attach https links to files in existing storage such as Drive, SharePoint or S3.
- **Email requires SMTP.** Without it, invitation links are shown once to the admin to share, and password-reset emails cannot be sent. No admin-triggered password reset exists yet.
- **Exports are CSV only.** XLSX and PDF are not implemented.
- **Some API features have no UI yet:** editing/archiving departments and projects, and project team membership (`memberIds`). The API supports them.
- **Not implemented:** task deletion (tasks are cancelled instead, which keeps history), avatar uploads (initials are shown), the daily digest email (the preference is stored), real-time push (notifications poll every 60 s), and dark mode.
- **Rate limiting and the deadline scheduler are per instance.** Scaling to several Render instances needs a shared throttler store (e.g. Redis). The scheduler is safe to run on several instances because its notifications are de-duplicated. On plans that sleep, deadline notifications are only generated while the instance is awake.
- No automated accessibility audit (axe or a screen reader) has been run. Components use labelled controls, keyboard support and text-plus-icon status indicators, but this has not been verified with assistive technology.
