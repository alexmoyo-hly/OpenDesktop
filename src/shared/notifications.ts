/**
 * When this app decides a finished turn is worth interrupting somebody for.
 *
 * The rules live here, apart from Electron, for the same reason the routing and
 * savings rules do: the decision is worth testing on its own, and the module
 * that shows a notification needs a window and an operating system to exist at
 * all. What is left in `main/notifications.ts` is the part that cannot be
 * tested — `new Notification(...)`.
 */

/**
 * What one conversation has asked for.
 *
 * Three answers, because there are three honest ones: tell me about all of it,
 * tell me only when it needs me, or say nothing. `undefined` is not `'all'`:
 * it means this conversation has expressed no opinion and follows the app,
 * which is what every conversation is until somebody chooses from its menu.
 */
export type SessionNotify = "all" | "attention" | "muted";

/** The app-wide switch, as stored in `config.json`. */
export interface NotificationsConfig {
  /** The master switch. Off, nothing is ever shown, whatever a session says. */
  enabled?: boolean;
  /** Only when this app is not the one in front — the usual case for a desktop app. */
  onlyWhenUnfocused?: boolean;
  /** Whether the notification makes a sound. */
  sound?: boolean;
  /** Whether a turn that ended in an error is worth a notification of its own. */
  onError?: boolean;
}

export const DEFAULT_NOTIFICATIONS: Required<NotificationsConfig> = {
  enabled: true,
  // On by default: a notification for a turn that finished while you were
  // looking at the answer is noise, and noise is how people end up turning the
  // whole feature off.
  onlyWhenUnfocused: true,
  sound: true,
  onError: true,
};

/**
 * What the document says, with every field a real boolean.
 *
 * A config file is hand-editable, so `"enabled": "yes"` must not count as on —
 * the same reason `normalizeConfig` tests the savings switches with `=== true`.
 */
export function notificationSettings(
  config: NotificationsConfig | undefined,
): Required<NotificationsConfig> {
  return {
    enabled:
      config?.enabled === undefined
        ? DEFAULT_NOTIFICATIONS.enabled
        : config.enabled === true,
    onlyWhenUnfocused:
      config?.onlyWhenUnfocused === undefined
        ? DEFAULT_NOTIFICATIONS.onlyWhenUnfocused
        : config.onlyWhenUnfocused === true,
    sound:
      config?.sound === undefined
        ? DEFAULT_NOTIFICATIONS.sound
        : config.sound === true,
    onError:
      config?.onError === undefined
        ? DEFAULT_NOTIFICATIONS.onError
        : config.onError === true,
  };
}

/**
 * Why a notification would be shown, which is also the shape of its body.
 *
 * `approval` is not a turn ending — it is a turn asking. A provider failure is
 * `error`, and the answer to an ordinary turn is `done`.
 */
export type NoticeKind = "done" | "error" | "approval";

export interface NoticeDecision {
  /** Whether the notification is worth showing at all. */
  show: boolean;
  /** The reason it is not, for the log line — never shown to anybody. */
  reason: string;
}

/**
 * Whether to interrupt: the whole policy, as one function.
 *
 * The order matters and is the point of it being written down here. A session
 * that said "muted" wins over everything, including an error; a session that
 * said "only when it needs me" is heard before the app's own switch, because it
 * is the more specific instruction; and the app's switch is a master, so it
 * beats the default of a session that said nothing.
 */
export function decideNotice(input: {
  kind: NoticeKind;
  /** The app-wide setting. */
  settings: Required<NotificationsConfig>;
  /** This conversation's own instruction, if it has one. */
  session?: SessionNotify;
  /** Whether this window is the one in front. */
  windowFocused: boolean;
  /** A subagent's turn: its work is reported by its parent. */
  subagent?: boolean;
}): NoticeDecision {
  if (input.subagent)
    return { show: false, reason: "a subagent reports through its parent" };
  if (input.session === "muted")
    return { show: false, reason: "this conversation is muted" };

  // "Only when it needs me" is the session speaking, and a turn that finished
  // is exactly what it asked not to hear about. An error still counts: it is
  // the turn stopping without an answer, which is what needing somebody means.
  if (input.session === "attention" && input.kind === "done") {
    return {
      show: false,
      reason: "this conversation only asks when it needs you",
    };
  }

  if (!input.settings.enabled)
    return { show: false, reason: "notifications are off" };

  if (input.kind === "error" && !input.settings.onError) {
    return { show: false, reason: "errors are not notified" };
  }

  if (input.settings.onlyWhenUnfocused && input.windowFocused) {
    return { show: false, reason: "the window is in front" };
  }

  return { show: true, reason: "shown" };
}

/**
 * What a notification says: the conversation it is about, and the sentence
 * somebody would have read had they been looking.
 *
 * Split into a title and a body because that is the shape the operating system
 * gives us, and because the title is the only part guaranteed to be visible.
 */
export function noticeContent(input: {
  kind: NoticeKind;
  title: string;
  /** The last thing the agent said, if it said anything. */
  said?: string;
  /** Why a turn failed, when that is what happened. */
  failure?: string;
}): { title: string; body: string } {
  const title = input.title.trim() || "Untitled conversation";
  const tail = (input.said ?? "").replace(/\s+/g, " ").trim();

  if (input.kind === "approval") {
    return { title, body: "Waiting for your approval." };
  }
  if (input.kind === "error") {
    const why = (input.failure ?? "").replace(/\s+/g, " ").trim();
    return {
      title,
      body: why
        ? `Stopped: ${trim(why, 160)}`
        : "The turn stopped without answering.",
    };
  }
  return { title, body: tail ? trim(tail, 160) : "The turn finished." };
}

/** A tail of a sentence, cut at a word rather than mid-word, with an ellipsis. */
export function trim(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
