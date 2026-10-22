# Bizwoke Nova: API

> Database design, indexes, commands, backups and example queries: **[docs/DATABASE.md](docs/DATABASE.md)**.

NestJS 12 + MongoDB REST API. Base path `/api/v1`. Interactive docs are at `/api/v1/docs`: always available outside production, and in production only when `SWAGGER_ENABLED=true`, behind basic auth. See the [root README](../README.md) for deployment.

## Scripts

| Command | Purpose |
|---|---|
| `npm run start:dev` | Watch mode |
| `npm run build` / `npm run start:prod` | Compile to `dist/` / run it |
| `npm run db:setup` | Indexes + organisation + Super Admin + (dev only) demo data in one idempotent step |
| `npm run db:check` | Verify the MongoDB connection (host, database, version, counts; never the URI) |
| `npm run db:indexes` | Create collections and indexes (`-- --sync` also drops undeclared indexes) |
| `npm run db:bootstrap` | Create the organisation, default departments and the first Super Admin (`SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`). Idempotent, production-safe |
| `npm run db:seed` | Development-only synthetic data (`SEED_DEV_PASSWORD`). Idempotent; refuses in production |
| `npm test` | Unit tests (Vitest) |
| `npm run test:e2e` | Integration tests: the real app against an in-memory MongoDB, downloaded on first run |
| `npm run lint` | oxlint |

## Environment

Validated at startup by `src/config/env.ts`; the process refuses to boot with a missing or weak value. See [`.env.example`](.env.example).

| Variable | Required | Notes |
|---|---|---|
| `PORT` | Yes (Render sets it) | Defaults to 4000 |
| `NODE_ENV` | Yes | `development` / `production` / `test` |
| `MONGODB_URI` | Yes | MongoDB 5.0+ (`mongodb+srv://…`). Backend-only, never logged |
| `MONGODB_DB_NAME`, `MONGODB_MAX_POOL_SIZE`, `MONGODB_AUTO_INDEX` | No | Defaults: `bizwoke_nova` (or the URI path), 20, true |
| `JWT_ACCESS_SECRET` | Yes | ≥ 32 chars. Signs 15-minute access JWTs (HS256) |
| `JWT_REFRESH_SECRET` | Yes | ≥ 32 chars. HMAC pepper for stored refresh and one-time tokens |
| `FRONTEND_URL` | Yes | Allowed origin(s), comma-separated. Must be `https://` in production |
| `APP_NAME` | Yes | Defaults to `Bizwoke Nova` |
| `COOKIE_DOMAIN` | No | Only needed when the API and frontend share a parent domain |
| `ACCESS_TOKEN_TTL_SECONDS`, `REFRESH_TOKEN_TTL_DAYS`, `AUTH_RATE_LIMIT`, `LOG_LEVEL` | No | Defaults: 900, 7, 10/min, info |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` | No | Email delivery |
| `SWAGGER_ENABLED`, `SWAGGER_USER`, `SWAGGER_PASSWORD` | No | Production docs; basic auth is required |

## Modules

`AuthModule` (+ `TokensModule`) · `UsersModule` · `RolesModule` · `DepartmentsModule` · `ProjectsModule` · `TasksModule` · `CommentsModule` · `NotificationsModule` (+ deadline scheduler) · `ReportsModule` (dashboard + reports) · `ActivityLogsModule` · `SettingsModule` · `SearchModule` · `HealthModule` · `CoreModule` (shared models, `ScopeService`, `RefsService`) · `MailModule`

Business rules live in plain, tested modules (`tasks/task-workflow.ts`, `tasks/task-access.ts`, `roles/permissions.ts`). Controllers stay thin.

## Endpoints

| Area | Endpoints |
|---|---|
| Auth | `POST auth/login` · `POST auth/refresh` · `POST auth/logout` · `POST auth/forgot-password` · `POST auth/reset-password` · `POST auth/accept-invitation` · `POST auth/change-password` · `GET auth/me` |
| Users | `POST users` · `GET users` · `GET users/:id` · `PATCH users/:id` · `PATCH users/:id/status` · `DELETE users/:id` (soft) · `POST users/:id/invitation` · `PATCH users/me` |
| Departments | `GET/POST departments` · `PATCH departments/:id` · `PATCH departments/:id/archive` |
| Projects | `GET/POST projects` · `PATCH projects/:id` · `PATCH projects/:id/archive` |
| Tasks | `POST/GET tasks` · `GET/PATCH tasks/:id` · `PATCH tasks/:id/status` · `PATCH tasks/:id/progress` · `POST tasks/:id/assignments` · `POST tasks/:id/comments` · `POST tasks/:id/submit-review` · `POST tasks/:id/approve` · `POST tasks/:id/request-changes` · `GET tasks/:id/activity` · `POST tasks/:id/time-entries` · `POST tasks/:id/attachments` · `POST tasks/:id/checklist` · `PATCH tasks/:id/checklist/:itemId` · `GET tasks/assignable-users` |
| Dashboard | `GET dashboard/summary` · `GET dashboard/team-performance` · `GET dashboard/workload` |
| Reports | `GET reports/tasks` · `GET reports/employees` · `GET reports/departments`: all accept `from`, `to`, `departmentId`, `projectId`, and `format=csv` |
| Other | `GET/PATCH settings/organization` · `GET/PUT settings/notifications` · `GET notifications` · `GET notifications/unread-count` · `PATCH notifications/:id/read` · `POST notifications/read-all` · `GET activity-logs` · `GET search?q=` · `GET roles` · `GET health` |

Successful responses look like `{ "data": … }`, and paginated ones like `{ "data": [...], "meta": { "total", "page", "pageSize" } }`. Errors look like `{ "statusCode", "error", "message", "details"?, "requestId", "timestamp", "path" }`.

## Roles & permissions

Security **role** and **job function** are independent fields: a Developer can be an Employee or a Manager.

| Capability | Super Admin | Admin | HR Manager | Manager | Employee |
|---|:-:|:-:|:-:|:-:|:-:|
| Organisation settings | ✓ | ✓ | | | |
| Create accounts / grant roles | any role | all but Super Admin | Employee, Manager | | |
| Manage departments & projects | ✓ | ✓ | | | |
| View employees | org | org | org | own departments | |
| Create, assign & review tasks | org | org | | own departments | |
| See tasks | all | all | own only | team + own | assigned + shared |
| Reports & exports | org | org | | team | |

Managers are scoped to their own department plus any department they manage. Users can only modify accounts whose role they could grant, and never their own role or status.

## Task workflow

`todo → in_progress ⇄ blocked → (submit) in_review → (approve) completed`, or `(request changes) → in_progress`.

- New tasks start as **To Do**. Assignees can move them between **In Progress** and **Blocked** and submit them for review.
- When `reviewRequired` is on (the default), only manager approval completes a task. If it is turned off, assignees can complete tasks directly.
- Managers can cancel tasks and reopen closed ones. **In Review** can only be reached through a submission. Progress is an integer from 0 to 100; completion forces 100, and requesting changes caps it at 90.
- `isOverdue` and `isDueSoon` are computed at read time from UTC timestamps, using the organisation's `dueSoonThresholdDays`. An open task at 100% progress still counts as overdue.
- Assignees must be active, inside the actor's authorised departments, and members of the task's department or project team.
- Every transition, reassignment, review, time entry and attachment is written to the append-only activity log.

## Security notes

- Passwords are hashed with Argon2id (OWASP parameters). Unknown-user logins run a dummy hash check so response timing doesn't reveal which accounts exist.
- Access JWTs last 15 minutes and are verified for issuer, audience and algorithm. The user is re-loaded from the database on every request, so deactivation takes effect immediately.
- Refresh tokens are opaque random values stored only as an HMAC. They rotate on every use, and reusing an old token revokes its whole family. They travel in an HttpOnly cookie scoped to `/api/v1/auth`, with an Origin check on cookie-authenticated endpoints. Changing or resetting a password revokes all sessions.
- Invitation and reset tokens are single-use and time-limited (72 h and 30 min), stored hashed.
- Requests are validated with whitelisting. Unknown properties are rejected, which blocks mass assignment and `$` operator injection. Search input is regex-escaped and CSV output neutralises spreadsheet formulas.
- Helmet headers, strict CORS (exact origins, credentials), a 100 kB body limit, global and auth-specific rate limits, and `trust proxy` for Render.
- Structured pino logs with request IDs; authorization headers, cookies, passwords and tokens are redacted. Audit metadata is sanitised of secret-like keys.
- Errors go through one exception filter; internal errors are logged but never returned to clients. Shutdown hooks provide graceful termination.
