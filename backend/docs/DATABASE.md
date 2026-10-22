# Bizwoke Nova: Database

MongoDB (Atlas compatible, **5.0+**) accessed through Mongoose 9 from the NestJS API. This document covers the schema, relationships, indexes, configuration, operational commands, backup and retention, and example queries.

Code map:

| Concern | Location |
|---|---|
| Connection, timeouts, shutdown, log redaction | `src/database/database.module.ts`, `src/database/connection.ts` |
| Update validators on every write | `src/database/plugins.ts` |
| Model registry | `src/database/models.ts` |
| Schemas | `src/**/*.schema.ts` |
| Cross-organisation reference checks | `src/core/org-references.service.ts` |
| Authorisation scoping (which records a user may read) | `src/core/scope.service.ts`, `src/tasks/task-access.ts` |
| Bootstrap and development seed | `src/database/seed/`, `src/scripts/db-*.ts` |

Controllers never touch models. All database access goes through services: `UsersService`, `TasksService`, `ReportsService`, `SearchService` and so on.

## 1. Configuration

All database settings live in **`backend/.env`**, which is git-ignored. Next.js never sees them, and no `NEXT_PUBLIC_*` variable contains database information.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `MONGODB_URI` | **yes** | — | `mongodb+srv://user:password@cluster.mongodb.net/?retryWrites=true&w=majority`. URL-encode special characters in the password (`@` → `%40`). |
| `MONGODB_DB_NAME` | no | URI path, else `bizwoke_nova` | Database name. Overrides any database named in the URI. |
| `MONGODB_MAX_POOL_SIZE` | no | `20` | Driver connection pool size. |
| `MONGODB_AUTO_INDEX` | no | `true` | Build indexes on startup. Set to `false` in large production deployments and run `npm run db:indexes` on release instead. |

Startup behaviour:

- `MONGODB_URI` is validated before anything connects. If it is missing or malformed, the process exits with a one-line message telling you to paste it into `backend/.env`.
- Connection: `serverSelectionTimeoutMS` 10 s, `connectTimeoutMS` 10 s, `socketTimeoutMS` 45 s, 3 attempts 2 s apart, then a clear failure naming the host and suggesting what to check (URI, user/password, Atlas network access).
- **Credentials are never logged.** Logs show only `host/database`, and every error message passes through `redactCredentials()`.
- Graceful shutdown: on SIGTERM, Nest closes the connection after in-flight work finishes. This expected disconnect is logged as `Closed MongoDB connection`, not as a warning.
- Global safety: `strictQuery` is on, and every update query runs schema validators (`runValidators`) via a connection-wide plugin.

### Atlas checklist

1. Create a database user with **readWrite on `bizwoke_nova`** only, not an Atlas admin user.
2. Network access: add your IP for local development, and Render's outbound IPs for production.
3. Copy the connection string (*Drivers → Node.js*), paste it into `backend/.env` as `MONGODB_URI=…`, and run `npm run db:check`.

## 2. Commands

Run these from `backend/`. Each command compiles first, then runs.

| Command | Safe in production | What it does |
|---|:-:|---|
| `npm run db:setup` | ✓ (admin only) | **One step:** indexes → organisation + 7 departments + Super Admin (`SEED_ADMIN_*`) → demo data in the *same* organisation when `SEED_DEV_PASSWORD` is set and not in production. Idempotent. |
| `npm run db:check` | ✓ | Connects, pings, and prints host, database, server version and per-collection counts. Never prints the URI. |
| `npm run db:indexes` | ✓ | Creates all collections and declared indexes. Idempotent. |
| `npm run db:indexes -- --sync` | with care | Also **drops** indexes that are no longer declared. Use after schema changes that rename indexes. |
| `npm run db:bootstrap` | ✓ | Creates the organisation, the 7 default departments and the first Super Admin from `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` (≥12 chars, a letter and a number). Idempotent. |
| `npm run db:seed` | ✗ refuses | **Development only.** Loads synthetic data into the `bizwoke-nova-dev` organisation (see §6). Requires `SEED_DEV_PASSWORD`. Idempotent. Exits with an error when `NODE_ENV=production`. |

First run, once you have pasted the URI:

```bash
npm run db:check        # confirm connectivity
npm run db:setup        # everything below in one step
npm run start:dev
```

(Individually: `db:indexes`, `db:bootstrap`, `db:seed`.)

## 3. Collections

Every business document carries `organizationId`, and every query filters by the caller's organisation. Timestamps are UTC.

| Collection | Key fields | Notes |
|---|---|---|
| **organizations** | `name`, `slug` (unique), `settings.{dueSoonThresholdDays, reviewRequired}`, `timezone` | One per tenant. |
| **users** | `organizationId`, `employeeId`, `firstName`, `lastName`, `email` (lower-case), `passwordHash` (Argon2id, `select:false`), `securityRole`, `jobFunction`, `departmentId`, `managerId`, `avatar`, `status` (`invited`/`active`/`deactivated`), `invitedAt`, `joinedAt`, `lastLoginAt`, `createdBy`, `deletedAt`, `notificationPreferences` | `securityRole` (what you may do) and `jobFunction` (what you do) are independent. Soft-deleted via `deletedAt`. |
| **departments** | `organizationId`, `name`, `slug`, `description`, `managerId`, `memberIds`, `status` (`active`/`archived`) | `memberIds` is kept in sync with `users.departmentId`, which is the source of truth. The manager is always a member. |
| **projects** | `organizationId`, `name`, `description`, `projectCode`, `departmentId`, `managerId`, `memberIds`, `startDate`, `dueDate`, `status` (`planning`/`active`/`on_hold`/`completed`/`archived`), `createdBy` | `memberIds` lists team members from outside the owning department. |
| **tasks** | `organizationId`, `taskCode`, `title`, `description`, `projectId`, `departmentId`, `createdBy`, `assignedTo[]`, `assignedBy`, `sharedWith[]`, `priority`, `status`, `startDate`, `dueDate`, `estimatedHours`, `actualHours`, `progressPercentage`, `checklist[]`, `tags[]`, `attachments[]`, `timeEntries[]`, `reviewRequired`, `review`, `commentCount`, `completedAt`, `archivedAt` | Multiple assignees are allowed, without duplicates. `reviewRequired` is snapshotted from the organisation setting at creation. Archived tasks are hidden from lists and reports. |
| **comments** | `organizationId`, `taskId`, `authorId`, `body`, `mentions[]`, `attachments[]`, `deletedAt` | Soft delete. Mentions only notify people who can already see the task. |
| **notifications** | `organizationId`, `recipientId`, `actorId`, `type`, `title`, `message`, `entityType`, `entityId`, `readAt`, `dedupeKey` | Expire after 180 days (TTL). `dedupeKey` makes scheduler alerts idempotent. |
| **activityLogs** | `organizationId`, `actorId`, `action`, `entityType`, `entityId`, `changes`, `requestId`, `actorName`, `entityLabel`, `description` | **Append-only**: every update or delete operation throws at the model level. `requestId` matches the `X-Request-Id` header and the API logs. Secret-like keys are stripped from `changes`. |
| **refreshTokens** | `userId`, `tokenHash` (HMAC-SHA256), `expiresAt`, `revokedAt`, `family`, `replacedByHash` | Raw tokens are never stored. Rotation families support reuse detection. TTL on `expiresAt`. |
| **passwordResetTokens** | `userId`, `tokenHash`, `expiresAt`, `usedAt` | Single use (atomic consume), 30-minute lifetime, TTL. |
| **invitationTokens** | `userId`, `tokenHash`, `expiresAt`, `usedAt` | Single use, 72-hour lifetime, TTL. |
| **counters** | `_id` (`<orgId>:task` / `<orgId>:employee`), `seq` | Atomic per-organisation sequences for `taskCode` and `employeeId`. |

### Relationships

```mermaid
erDiagram
    ORGANIZATIONS ||--o{ USERS : "has"
    ORGANIZATIONS ||--o{ DEPARTMENTS : "has"
    ORGANIZATIONS ||--o{ PROJECTS : "has"
    DEPARTMENTS ||--o{ USERS : "employs (users.departmentId)"
    DEPARTMENTS ||--o{ PROJECTS : "owns"
    USERS |o--o{ DEPARTMENTS : "manages (managerId)"
    USERS |o--o{ PROJECTS : "manages (managerId)"
    USERS |o--o{ USERS : "reports to (managerId)"
    PROJECTS ||--o{ TASKS : "contains"
    DEPARTMENTS ||--o{ TASKS : "scopes"
    USERS ||--o{ TASKS : "creates (createdBy)"
    USERS }o--o{ TASKS : "assigned (assignedTo[])"
    TASKS ||--o{ COMMENTS : "has"
    USERS ||--o{ COMMENTS : "writes"
    TASKS ||--o{ ACTIVITYLOGS : "history (entityId)"
    USERS ||--o{ ACTIVITYLOGS : "acts"
    USERS ||--o{ NOTIFICATIONS : "receives (recipientId)"
    USERS ||--o{ REFRESHTOKENS : "owns"
    USERS ||--o{ PASSWORDRESETTOKENS : "owns"
    USERS ||--o{ INVITATIONTOKENS : "owns"
```

### Organisation isolation

- References use ObjectIds and are validated **before** being written. `OrgReferencesService` checks that each referenced department, project, manager, assignee or team member exists, is active, and belongs to the caller's organisation; otherwise the request fails with a 422 naming the field.
- Reads are always filtered by `organizationId` from the authenticated principal, never from client input. Records from other organisations return 404.
- Notifications are only delivered to active users of the same organisation.

## 4. Indexes

Indexes follow the actual query patterns. Fields are deliberately not indexed one by one.

| Collection | Index | Serves |
|---|---|---|
| organizations | `{slug}` unique | lookup by slug (login disambiguation) |
| users | `{organizationId, email}` unique, partial `deletedAt: null` | per-org email uniqueness; a soft-deleted user frees the address |
| users | `{email}` | login lookup |
| users | `{organizationId, employeeId}` unique | employee IDs are never reused |
| users | `{organizationId, departmentId, status}` · `{organizationId, securityRole, status}` · `{organizationId, managerId}` | directory filters, manager pickers, team workload |
| departments | `{organizationId, slug}` unique, partial `status: "active"` | archived departments release their name |
| departments | `{organizationId, managerId}` | "departments I manage" (authorisation scope) |
| projects | `{organizationId, projectCode}` unique · `{organizationId, departmentId, status}` · `{organizationId, memberIds}` | |
| tasks | `uniq_org_task_code` `{organizationId, taskCode}` unique | |
| tasks | `my_tasks` `{organizationId, assignedTo, status, dueDate}` | My Tasks, employee dashboard, overdue |
| tasks | `team_tasks` `{organizationId, departmentId, status, dueDate}` | manager lists, dashboards, reports |
| tasks | `org_status_due` `{organizationId, status, dueDate}` | admin counts, overdue sweep, scheduler |
| tasks | `project_progress` `{organizationId, projectId, status}` | project progress |
| tasks | `created_by_me` `{organizationId, createdBy, status}` · `shared_with` `{organizationId, sharedWith}` | "assigned by me", shared tasks |
| tasks | `completed_at` `{organizationId, completedAt}` partial | productivity reports |
| comments | `{organizationId, taskId, createdAt}` | task thread |
| notifications | `inbox` `{recipientId, createdAt}` · `inbox_unread` `{recipientId, readAt, createdAt}` | inbox and unread badge |
| notifications | `{dedupeKey}` unique partial · `ttl_180d` `{createdAt}` TTL | idempotent alerts, retention |
| activityLogs | `{organizationId, createdAt}` · `{organizationId, entityType, entityId, createdAt}` · `{organizationId, actorId, createdAt}` | audit views, task history |
| refreshTokens | `{tokenHash}` unique · `{userId, revokedAt}` · `{family}` · `ttl_expires_at` | rotation, revocation, cleanup |
| passwordResetTokens / invitationTokens | `{tokenHash}` unique · `{userId, usedAt}` · `ttl_expires_at` | single-use consume, cleanup |

Soft deletion is handled consistently: users soft-delete via `deletedAt`, so uniqueness applies to live users only. Departments archive via `status`, so uniqueness applies to active departments only. Projects (by code), tasks (by code) and employee IDs stay unique forever to keep references stable.

## 5. Validation

| Rule | Where |
|---|---|
| ObjectIds are valid and belong to the organisation | DTOs (`@IsMongoId`), `ParseObjectIdPipe`, `OrgReferencesService` |
| Emails are trimmed, lower-cased and pattern-checked | DTO transform + schema (`lowercase`, `match`) |
| Roles, statuses, priorities, job functions use allowed values | schema `enum` + DTO `@IsIn` |
| Valid dates, `dueDate ≥ startDate` | schema `pre('validate')` on tasks and projects + service checks |
| `progressPercentage` is an integer from 0 to 100; completed means 100 | schema validator + workflow rules |
| No duplicate assignees, members, mentions or checklist/attachment IDs; tasks need ≥1 assignee | schema array validators |
| Update queries are validated too | `enforceUpdateValidation` plugin (`runValidators`, `strict`) |
| `passwordHash`, `organizationId` and privileged roles can't come from requests | DTO whitelisting rejects unknown fields (422); role grants are checked against the actor's role |

## 6. Seed data

- **Bootstrap** (`db:bootstrap`) is meant for production. It creates exactly one organisation, the 7 default departments and one Super Admin, all from environment variables. It never creates demo users.
- **Development seed** (`db:seed` / `db:setup`) loads into the configured organisation (`SEED_ORG_NAME`/`APP_NAME`, i.e. the same one as your Super Admin) and adds 7 departments, 1 Super Admin (`admin@example.com`), 7 managers (the HR one as HR Manager), 15 employees, 7 projects, 42 tasks (codes `DEMO-1001…`, never clashing with real `BN-…` codes) covering every status (including overdue and due-soon ones), and comments. All names are fictional and all emails use the reserved `example.com` domain. Every user's password is `SEED_DEV_PASSWORD`, hashed with Argon2id. The seed matches records on natural keys and only inserts what is missing, so re-running it creates nothing new.

## 7. Backup and restore

- **Atlas (recommended):** use a dedicated M10+ cluster with **Cloud Backup** and continuous backup (point-in-time restore), 7–30 days of retention, and a scheduled snapshot exported off-cluster. Test a restore into a staging cluster every quarter.
- **Manual / free tier:**
  ```bash
  # Backup (store the archive encrypted, outside the repository)
  mongodump --uri="$MONGODB_URI" --db=bizwoke_nova --gzip --archive=bizwoke_nova-$(date +%F).gz
  # Restore into a NEW database first, verify, then switch MONGODB_DB_NAME
  mongorestore --uri="$MONGODB_URI" --gzip --archive=bizwoke_nova-2026-10-22.gz \
    --nsFrom='bizwoke_nova.*' --nsTo='bizwoke_nova_restore.*'
  ```
- Don't restore over a live database. Restore into a new database, run `npm run db:check`, then point `MONGODB_DB_NAME` at it.
- After a restore, run `npm run db:indexes` to make sure TTL and unique indexes exist.

## 8. Retention and deletion

| Data | Retention | Mechanism |
|---|---|---|
| Refresh, reset and invitation tokens | until expiry (7 days / 30 min / 72 h) | TTL indexes delete expired documents automatically |
| Notifications | 180 days | TTL index on `createdAt` |
| Activity logs | indefinite by default (audit evidence) | append-only. If policy requires a limit, add a TTL index on `createdAt` (e.g. 2 years) through a migration. Never edit entries. |
| Users | soft delete (`deletedAt`) | keeps task and audit history intact; the email becomes reusable |
| Departments and projects | archive (`status: "archived"`) | hidden from pickers and lists |
| Tasks | archive (`archivedAt`) or cancel | history is preserved |

**Erasure requests (GDPR-style):** soft-delete the user, then anonymise their personal fields (`firstName` = "Former", `lastName` = "employee", `email` = `deleted+<id>@invalid`, `avatar` and `title` = null) and revoke their tokens. Keep `_id` so tasks and audit entries still resolve. Activity log snapshots (`actorName`) should be handled under your legal basis for keeping audit records.

## 9. Example queries (mongosh)

```js
use bizwoke_nova
const org = db.organizations.findOne({ slug: "bizwoke-nova" })._id;
const now = new Date();

// Dashboard counts by status (excluding archived tasks) — uses org_status_due
db.tasks.aggregate([
  { $match: { organizationId: org, archivedAt: null } },
  { $group: { _id: "$status", count: { $sum: 1 } } },
]);

// Overdue tasks: open, past due — computed at read time, never stored
db.tasks.find(
  { organizationId: org, archivedAt: null, status: { $nin: ["completed", "cancelled"] }, dueDate: { $lt: now } },
  { taskCode: 1, title: 1, dueDate: 1, assignedTo: 1 },
).sort({ dueDate: 1 });

// One employee's open work (My Tasks) — uses my_tasks
db.tasks.find({ organizationId: org, assignedTo: ObjectId("<userId>"), status: { $in: ["todo", "in_progress", "blocked"] } })
  .sort({ dueDate: 1 });

// Department performance: completed vs overdue vs on-time
db.tasks.aggregate([
  { $match: { organizationId: org, archivedAt: null, status: { $ne: "cancelled" } } },
  { $group: {
      _id: "$departmentId",
      total: { $sum: 1 },
      completed: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } },
      overdue: { $sum: { $cond: [{ $and: [{ $lt: ["$dueDate", now] }, { $not: [{ $in: ["$status", ["completed", "cancelled"]] }] }] }, 1, 0] } },
      onTime: { $sum: { $cond: [{ $and: [{ $eq: ["$status", "completed"] }, { $lte: ["$completedAt", "$dueDate"] }] }, 1, 0] } },
  } },
  { $lookup: { from: "departments", localField: "_id", foreignField: "_id", as: "dept" } },
  { $project: { department: { $first: "$dept.name" }, total: 1, completed: 1, overdue: 1, onTime: 1 } },
]);

// Weekly productivity (requires MongoDB 5.0+)
db.tasks.aggregate([
  { $match: { organizationId: org, completedAt: { $gte: new Date(Date.now() - 56 * 864e5) } } },
  { $group: { _id: { $dateTrunc: { date: "$completedAt", unit: "week", startOfWeek: "monday" } }, completed: { $sum: 1 } } },
  { $sort: { _id: 1 } },
]);

// Unread notifications for a user — uses inbox_unread
db.notifications.countDocuments({ recipientId: ObjectId("<userId>"), readAt: null });

// Audit trail for one task — uses entity_history
db.activityLogs.find({ organizationId: org, entityType: "task", entityId: ObjectId("<taskId>") }).sort({ createdAt: -1 });
```

## 10. Known limitations

- **Multi-organisation login UX:** the API supports the same email in several organisations (login returns `409 organization_required` and accepts an `organization` slug), but the web login form doesn't show an organisation field yet.
- **Atlas connectivity has not been verified:** no real Atlas cluster has been used yet. Everything was tested against MongoDB 8.2 started by `mongodb-memory-server`. Run `npm run db:check` once you have pasted your URI.
- **Existing databases need an index sync:** if a database was created with an earlier version of this schema (before the field renames such as `role` → `securityRole` and `key` → `taskCode`), there is no data migration script. Run `npm run db:indexes -- --sync` on an empty or disposable database, or write a migration for existing data.
- **Attachments are metadata only:** files live in external storage referenced by https URL.
