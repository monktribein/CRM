# Screenshot monitoring

Consent-based screen monitoring for enrolled employees. Built on the existing
accounts, JWT auth, role permissions and audit log. No separate login exists.

## How it works

1. An admin turns on the organisation policy and enrols employees (Screenshot
   Monitoring page, or **Employees → ⋯ → Screen monitoring**).
2. After an enrolled employee signs in, the app shows the policy notice. The
   employee's decision (granted or declined) and the policy version are stored
   in `monitoringConsents` and the audit log. Changing the policy version asks
   everyone to consent again.
3. The employee clicks **Start screen sharing**. The browser shows its own
   prompt (video only, no audio). Only after the browser grants a stream does
   the API create a `monitoringSessions` record for the authenticated user.
4. While the stream is live, one JPEG is captured every 5 minutes. Each image
   is encrypted into an IndexedDB queue, then uploaded to
   `POST /monitoring/screenshots`. The API stores it in MongoDB
   (GridFS) and only then confirms. The browser deletes its copy after that
   confirmation.
5. Heartbeats are sent every 60 s. A session ends on logout, a stopped stream,
   a closed tab (best effort), a policy change, or after 3 minutes with no
   heartbeat (browser closed, computer asleep, network lost). A session that
   has ended can't be resumed. The next sign-in or reload needs a fresh browser
   permission grant.

## Data

| Collection / field | Purpose |
| --- | --- |
| `organizations.monitoring` | Policy: enabled, version, notice text, retention days, local-queue retention hours |
| `users.monitoring` | Enrolment, latest consent decision and version |
| `monitoringSessions` | One per screen-sharing grant. Status, heartbeat, end reason. A partial unique index allows only one active session per user |
| `screenshots` | Metadata and upload ledger: unique `captureId` per org, status, attempts, GridFS file ID, SHA-256, `expiresAt` |
| `screenshotFiles.files` / `.chunks` | GridFS image storage, indexed by organisation and capture ID |
| `monitoringConsents` | Append-only consent history |

## Access

- `monitoring.view` (admins org-wide, managers for their departments and
  direct reports): status, sessions, screenshot list and images.
- `monitoring.manage` (admins): policy, enrolment, deletion.
- HR and employees have neither permission.
- Each image view and deletion is written to the activity log.

## Super Admin dashboard

`GET /monitoring/admin/{sessions, sessions/:id, screenshots,
screenshots/:id/preview, uploads, access-logs}` require `monitoring.super`
(Super Admin only — not Admin, HR or managers) and are bounded to the
caller's organisation from the verified token. Settings reuse
`GET/PATCH /monitoring/policy`.

- **Status**: `ended` = confirmed logout or stop by the employee;
  `expired` = heartbeat timeout; `interrupted` = stream stopped, tab closed,
  superseded or monitoring disabled. `logoutAt` is set only for a confirmed
  logout and is never inferred.
- **Times** are stored and returned in UTC. Date filters (`from`/`to`,
  `YYYY-MM-DD`) are calendar days in the organisation timezone; the UI
  renders times in that zone.
- **Images** are streamed through the authenticated API; there are no
  public image links. Previews, downloads, deletions and retention
  purges are written to the append-only `screenshotAccessLogs` collection.
  The gallery loads thumbnails lazily, and each loaded thumbnail counts as
  a preview.
- **Sync status** combines server upload state with the browser queue size
  reported on each heartbeat.

## Retention

An hourly job permanently deletes the stored image (file and chunks) once they
pass `expiresAt` (capture time + `retentionDays`, fixed when the screenshot is
captured). The metadata row stays with status `deleted` for audit. Admins can
also delete a single screenshot. Unsent browser copies are discarded after
`localRetentionHours`.

## Storage

Images are stored in the application's own MongoDB database (the one in
`MONGODB_URI`) using GridFS, in the `screenshotFiles.files` and
`screenshotFiles.chunks` collections. No extra configuration or credentials
are needed. A failed write returns 503 `storage_failed`; browsers keep the
screenshot queued and retry with backoff.

Plan database size accordingly: a 1920-px JPEG is typically 100–300 KB, so
one employee for an 8-hour day (96 captures) is roughly 10–30 MB, kept for
`retentionDays`. MongoDB Atlas free (M0) clusters are limited to 512 MB.

## Limitations

- **Browser-only capture.** Capture runs only while a CRM tab is open with an
  active screen share. Closing the browser stops capture. Queued screenshots
  upload the next time that employee signs in on the same browser profile,
  within the local retention window. Browsers can't upload in the background
  after they close.
- **Local encryption is limited.** The AES-GCM key is non-extractable but sits
  in the same browser profile. It protects against casual inspection of disk
  files, not against malware or other code running on the CRM's origin. In
  private windows or browsers without IndexedDB, the queue is memory-only.
- Employees can stop sharing at any time (browser control or the banner). This
  is recorded as the session's end reason.
- Each browser tab needs its own grant. Starting in a second tab ends the
  session in the first.
- Changing `retentionDays` applies only to screenshots captured after the
  change.
- Unattended capture, capture outside the browser, or capture that survives a
  closed browser would need a separately authorised desktop agent. That is not
  part of this module.
