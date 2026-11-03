import { BrowserWindow, Notification, app } from "electron";
import type { Session } from "@shared/types";
import {
  decideNotice,
  noticeContent,
  notificationSettings,
  type NoticeKind,
} from "@shared/notifications";
import { bus } from "./bus";
import { rawConfig } from "./config";
import { logLine } from "./log";
import { listMessages, listSessions } from "./store";

/**
 * Telling somebody a turn ended, from the app itself.
 *
 * The alternative was a `turn` hook running `osascript`, and it was the wrong
 * shape twice over: a shell command that works on one platform, and a click
 * that goes nowhere because the operating system has no idea which
 * conversation it was about. A notification sent by this app knows its sender,
 * so a click brings back the window and the session it belongs to.
 *
 * Where the turn ends is not here. This listens to the store's own
 * `session.updated` events and reads the change off them: a turn has finished
 * when a session that was running is not running any more, which is true
 * however it ended — answered, failed, or stopped by a person.
 */

/** Sessions seen running, so an ending is a transition rather than a state. */
const working = new Set<string>();
/** Sessions already told about an approval prompt, so it is said once. */
const asked = new Set<string>();

let started = false;

export function startNotifications(): void {
  if (started) return;
  started = true;

  // Windows groups notifications by this id; without it they are anonymous and
  // an installed build's toasts may not appear at all. Harmless elsewhere.
  if (process.platform === "win32")
    app.setAppUserModelId("com.opendesktop.app");

  // A turn that was already running when the app started — a queued board task
  // picked up on launch — has to be in here, or its end looks like the first
  // status it ever had and nothing is said.
  for (const session of listSessions()) {
    if (
      session.status === "running" ||
      session.status === "awaiting-approval"
    ) {
      working.add(session.id);
    }
  }

  bus.subscribe((event) => {
    if (event.type === "session.updated") onSession(event.session);
    else if (event.type === "session.deleted") {
      working.delete(event.sessionId);
      asked.delete(event.sessionId);
    }
  });
}

function onSession(session: Session): void {
  const status = session.status;

  if (status === "running") {
    working.add(session.id);
    // Whatever it was waiting on was answered; another request later is still
    // worth saying, so the "already said" flag goes when the work carries on.
    asked.delete(session.id);
    return;
  }

  if (status === "awaiting-approval" || status === "blocked") {
    working.add(session.id);
    if (asked.has(session.id)) return;
    asked.add(session.id);
    show(session, "approval");
    return;
  }

  if (status === "idle" || status === "error" || status === "done") {
    if (!working.has(session.id)) return;
    working.delete(session.id);
    asked.delete(session.id);
    show(session, status === "error" ? "error" : "done");
    return;
  }

  // Queued: it has not started, so it has neither ended nor needs anybody.
  if (status === "queued") working.delete(session.id);
}

/** Whether any window of this app is the one in front. */
function windowFocused(): boolean {
  return BrowserWindow.getAllWindows().some(
    (win) => !win.isDestroyed() && win.isFocused(),
  );
}

/**
 * What the agent said last, for the body of the notification.
 *
 * The last assistant message rather than the last block: a turn usually ends
 * with prose, and a tool's output is not an answer to anything.
 */
function lastSaid(sessionId: string): string | undefined {
  const messages = listMessages(sessionId);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant") continue;
    const text = message.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text ?? "")
      .join("\n\n");
    if (text.trim()) return text;
  }
  return undefined;
}

function show(session: Session, kind: NoticeKind): void {
  const settings = notificationSettings(rawConfig().notifications);
  const decision = decideNotice({
    kind,
    settings,
    session: session.notify,
    windowFocused: windowFocused(),
    subagent: Boolean(session.parentSessionId),
  });

  if (!decision.show) {
    // Worth a line only to somebody asking why the app was silent.
    if (process.env.OPENDESKTOP_DEBUG) {
      logLine(
        "info",
        `notification ${session.id} not shown: ${decision.reason}`,
      );
    }
    return;
  }

  send(
    noticeContent({
      kind,
      title: session.taskLabel ?? session.title,
      said: kind === "done" ? lastSaid(session.id) : undefined,
    }),
    settings.sound,
    session.id,
  );
  logLine("info", `notified ${session.id} (${kind})`);
}

function send(
  content: { title: string; body: string },
  sound: boolean,
  sessionId?: string,
): void {
  if (!Notification.isSupported()) {
    logLine("warn", "notifications are not supported on this system");
    return;
  }

  const notification = new Notification({
    title: content.title,
    body: content.body,
    silent: !sound,
  });

  notification.on("click", () => {
    // Both halves matter: the window that is nowhere, and the conversation in
    // it. Selecting the session is the renderer's job — it is the only side
    // that knows what the panes are showing — so it is asked for as an event.
    const win = BrowserWindow.getAllWindows()[0];
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
    if (sessionId) bus.emit({ type: "session.focus", sessionId });
  });

  notification.show();
}

/**
 * One notification, right now, whatever the settings say.
 *
 * Because the point of it is to answer "does this work on this machine?" — a
 * button that honoured the switch beside it could only ever answer "yes, and
 * also, it is off".
 */
export function testNotification(): boolean {
  if (!Notification.isSupported()) return false;
  send(
    {
      title: "OpenDesktop",
      body: "Notifications from this app look like this.",
    },
    true,
  );
  return true;
}

/** What the settings page needs to know before offering to turn it on. */
export function notificationsSupported(): boolean {
  return Notification.isSupported();
}
