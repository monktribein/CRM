import { ApiError, getErrorMessage } from "@/lib/api/client";
import { config } from "@/lib/config";
import { sessionStore } from "@/lib/api/session";
import { monitoringApi } from "@/lib/api/services";
import { displaySurfaceOf, grabFrame, isCaptureSupported, requestScreenStream } from "@/lib/monitoring/capture";
import * as queue from "@/lib/monitoring/queue";
import type { ConsentDecision, MyMonitoringStatus } from "@/lib/types";

export type MonitoringPhase =
  | "off"
  | "needs_consent"
  | "declined"
  | "needs_permission"
  | "starting"
  | "active"
  | "unsupported";

export interface MonitoringState {
  phase: MonitoringPhase;
  status: MyMonitoringStatus | null;
  sessionId: string | null;
  lastCaptureAt: string | null;
  /** Screenshots waiting in this browser's queue for the current user. */
  pending: number;
  /** False when the queue is memory-only (lost if the tab closes). */
  durable: boolean;
  notice: string | null;
}

const INITIAL: MonitoringState = {
  phase: "off",
  status: null,
  sessionId: null,
  lastCaptureAt: null,
  pending: 0,
  durable: true,
  notice: null,
};

const FLUSH_INTERVAL_MS = 30_000;
const FIRST_CAPTURE_DELAY_MS = 5_000;

function phaseFor(status: MyMonitoringStatus, hasSession: boolean): MonitoringPhase {
  if (!status.required) return "off";
  if (status.needsConsent) {
    const declinedCurrent = status.consent.decision === "declined" && status.consent.policyVersion === status.policy?.version;
    return declinedCurrent ? "declined" : "needs_consent";
  }
  if (!isCaptureSupported()) return "unsupported";
  return hasSession ? "active" : "needs_permission";
}

/**
 * Owns the screen-sharing stream, the capture/heartbeat timers and the upload
 * queue for the signed-in employee. One instance per tab. A session is only
 * ever started from an explicit click, and every page load, sign-in or
 * interruption requires a fresh browser permission grant.
 */
class MonitoringRuntime {
  private state: MonitoringState = INITIAL;
  private readonly listeners = new Set<() => void>();
  private userId: string | null = null;
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private timers: ReturnType<typeof setInterval>[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private flushing = false;

  getState = () => this.state;
  getServerState = () => INITIAL;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private set(patch: Partial<MonitoringState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  /** Called once the user is authenticated. Checks policy and consent. */
  async init(userId: string) {
    if (this.userId === userId) return;
    if (this.userId) await this.stop("logout");
    this.userId = userId;
    window.addEventListener("online", this.onOnline);
    window.addEventListener("pagehide", this.onPageHide);
    // Drains screenshots left over from earlier sessions, even if capture is no longer required.
    this.flushTimer = setInterval(() => void this.flush(), FLUSH_INTERVAL_MS);
    this.set({ durable: await queue.isDurable() });
    await this.refresh();
    void this.flush();
  }

  async refresh() {
    try {
      const status = await monitoringApi.me();
      this.set({ status, phase: phaseFor(status, !!this.state.sessionId) });
    } catch {
      // Monitoring unavailable (older API, demo mode, offline): leave the CRM usable.
      this.set({ phase: this.state.sessionId ? "active" : "off" });
    }
  }

  async consent(decision: ConsentDecision) {
    const version = this.state.status?.policy?.version;
    if (!version) return;
    const status = await monitoringApi.consent(decision, version);
    this.set({ status, phase: phaseFor(status, false), notice: null });
  }

  /**
   * Must run inside a click handler so the browser shows its permission prompt.
   * `grantConsent` records consent in the same gesture, so agreeing to the
   * notice goes straight to the browser's screen-sharing popup — no extra step.
   */
  async start(opts: { grantConsent?: boolean } = {}) {
    if (this.state.phase === "starting" || this.state.phase === "active") return;
    this.set({ phase: "starting", notice: null });

    let stream: MediaStream;
    try {
      // getDisplayMedia must be called synchronously within the gesture, so the
      // browser prompt comes first; consent is recorded once a stream exists.
      stream = await requestScreenStream();
    } catch (error) {
      const denied = error instanceof DOMException && error.name === "NotAllowedError";
      if (denied) void monitoringApi.permissionDenied().catch(() => undefined);
      this.set({
        phase: opts.grantConsent ? "needs_consent" : "needs_permission",
        notice: denied
          ? "Screen sharing was not allowed. Monitoring is required for your account — allow screen sharing to continue."
          : `Screen sharing could not start: ${getErrorMessage(error)}`,
      });
      if (opts.grantConsent) await this.refresh();
      return;
    }

    const surface = displaySurfaceOf(stream);
    if (surface && surface !== "monitor") {
      stream.getTracks().forEach((t) => t.stop());
      this.set({ phase: opts.grantConsent ? "needs_consent" : "needs_permission", notice: "Please choose “Entire screen” when the browser asks what to share." });
      return;
    }

    if (opts.grantConsent) {
      const version = this.state.status?.policy?.version;
      try {
        if (version) {
          const status = await monitoringApi.consent("granted", version);
          this.set({ status });
        }
      } catch (error) {
        stream.getTracks().forEach((t) => t.stop());
        this.set({ phase: "needs_consent", notice: getErrorMessage(error) });
        await this.refresh();
        return;
      }
    }

    try {
      const session = await monitoringApi.startSession(surface);
      this.stream = stream;
      this.set({ sessionId: session.id, phase: "active", notice: null });
    } catch (error) {
      stream.getTracks().forEach((t) => t.stop());
      this.set({ phase: "needs_permission", notice: getErrorMessage(error) });
      await this.refresh();
      return;
    }

    stream.getVideoTracks()[0]?.addEventListener("ended", () =>
      this.interrupt("stream_ended", "Screen sharing stopped, so monitoring has paused. Share your screen again to continue.")
    );
    this.video = Object.assign(document.createElement("video"), { muted: true, playsInline: true });
    this.video.srcObject = stream;
    void this.video.play().catch(() => undefined);

    const status = this.state.status!;
    const first = setTimeout(() => void this.capture(), FIRST_CAPTURE_DELAY_MS);
    this.timers.push(
      first,
      setInterval(() => void this.capture(), status.captureIntervalSeconds * 1000),
      setInterval(() => void this.heartbeat(), status.heartbeatIntervalSeconds * 1000)
    );
  }

  /**
   * Stops capture. "logout" and "session_expired" also tear the runtime down
   * for this user; "user_stopped" leaves it waiting for a new permission grant.
   */
  async stop(reason: "logout" | "user_stopped" | "session_expired") {
    const sessionId = this.state.sessionId;
    this.stopLocal();
    // After an expired sign-in there is no token; the server closes the session when heartbeats stop.
    if (sessionId && reason !== "session_expired") {
      await monitoringApi.endSession(sessionId, reason).catch(() => undefined);
    }
    if (reason === "user_stopped") {
      this.set({ phase: this.state.status ? phaseFor(this.state.status, false) : "off", notice: "You stopped screen sharing. Monitoring is paused until you share your screen again." });
      return;
    }
    window.removeEventListener("online", this.onOnline);
    window.removeEventListener("pagehide", this.onPageHide);
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushTimer = null;
    this.userId = null;
    this.state = INITIAL;
    this.listeners.forEach((l) => l());
  }

  private stopLocal() {
    this.timers.forEach((t) => clearInterval(t));
    this.timers = [];
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.video) this.video.srcObject = null;
    this.video = null;
    this.set({ sessionId: null });
  }

  private interrupt(reason: "stream_ended" | null, notice: string) {
    const sessionId = this.state.sessionId;
    if (!sessionId) return;
    this.stopLocal();
    if (reason) void monitoringApi.endSession(sessionId, reason).catch(() => undefined);
    this.set({ phase: this.state.status ? phaseFor(this.state.status, false) : "off", notice });
    void this.refresh();
  }

  private async heartbeat() {
    const sessionId = this.state.sessionId;
    if (!sessionId) return;
    try {
      // Report the unsent backlog so administrators can see sync status honestly.
      const mine = (await queue.list().catch(() => [])).filter((i) => i.userId === this.userId);
      await monitoringApi.heartbeat(sessionId, { pendingUploads: mine.length, oldestPendingAt: mine[0]?.capturedAt });
    } catch (error) {
      // 409: the server closed the session (sleep/timeout, another tab, policy change).
      if (error instanceof ApiError && (error.status === 409 || error.status === 404)) {
        this.interrupt(null, "Monitoring was interrupted (for example, the computer slept or another tab took over). Share your screen again to continue.");
      }
      // Network errors are ignored here; prolonged silence lets the server expire the session.
    }
  }

  private async capture() {
    const { stream, video, userId } = this;
    const sessionId = this.state.sessionId;
    if (!stream || !video || !userId || !sessionId) return;
    let image: Blob;
    try {
      image = await grabFrame(stream, video);
    } catch {
      if (stream.getVideoTracks()[0]?.readyState !== "live") {
        this.interrupt("stream_ended", "Screen sharing stopped, so monitoring has paused. Share your screen again to continue.");
      }
      return;
    }
    const capturedAt = new Date().toISOString();
    await queue.enqueue({ captureId: crypto.randomUUID(), userId, sessionId, capturedAt, mimeType: image.type || "image/jpeg" }, image);
    this.set({ lastCaptureAt: capturedAt });
    void this.flush();
  }

  /** Uploads queued screenshots oldest-first; stops at the first transient failure and backs off. */
  async flush() {
    const userId = this.userId;
    if (this.flushing || !userId || !sessionStore.get()) return;
    this.flushing = true;
    try {
      await queue.purgeOlderThan((this.state.status?.localRetentionHours ?? 72) * 3_600_000);
      for (const item of await queue.list()) {
        if (item.userId !== userId || item.nextAttemptAt > Date.now()) continue;
        if (typeof navigator !== "undefined" && navigator.onLine === false) break;
        const image = await queue.read(item.captureId);
        if (!image) {
          await queue.remove(item.captureId);
          continue;
        }
        const form = new FormData();
        form.append("sessionId", item.sessionId);
        form.append("captureId", item.captureId);
        form.append("capturedAt", item.capturedAt);
        form.append("file", image, `${item.captureId}.jpg`);
        try {
          // Removed locally only after the API confirms the screenshot is stored.
          await monitoringApi.upload(form);
          await queue.remove(item.captureId);
        } catch (error) {
          const status = error instanceof ApiError ? error.status : 0;
          if (status === 401) break;
          if (status === 0 || status === 408 || status === 409 || status === 429 || status >= 500) {
            const attempts = item.attempts + 1;
            await queue.update(item.captureId, { attempts, nextAttemptAt: Date.now() + queue.backoffMs(attempts) });
            break;
          }
          // Permanently rejected (invalid, session unknown, monitoring disabled): don't retry forever.
          await queue.remove(item.captureId);
        }
      }
    } catch {
      /* storage errors: try again on the next tick */
    } finally {
      this.flushing = false;
      if (this.userId === userId) this.set({ pending: await queue.count(userId).catch(() => 0) });
    }
  }

  private onOnline = () => {
    void this.flush();
  };

  /** Best-effort close when the tab is closed or reloaded; heartbeat expiry is the fallback. */
  private onPageHide = () => {
    const sessionId = this.state.sessionId;
    const session = sessionStore.get();
    if (!sessionId || !session || config.demoMode || !config.apiUrl) return;
    void fetch(`${config.apiUrl}/monitoring/sessions/${encodeURIComponent(sessionId)}/end`, {
      method: "POST",
      keepalive: true,
      credentials: "include",
      headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "page_closed" }),
    }).catch(() => undefined);
  };
}

export const monitoringRuntime = new MonitoringRuntime();
