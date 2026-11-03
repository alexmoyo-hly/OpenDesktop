import { useEffect, useState, type ReactNode } from "react";
import { BellRing } from "lucide-react";
import { notificationSettings } from "@shared/notifications";
import { useConfigDraft } from "../lib/settings";
import { Button } from "./ui";
import { Hint, IconButton, Row, Section, Toggle } from "./settings-ui";

/**
 * What the app tells you about turns that ended while you were elsewhere.
 *
 * Two levels, and this is the first: the app's own answer, used by every
 * conversation that has not said anything different. The second is on each
 * conversation — three dots, Notifications — because "this one may be loud" is
 * a judgement about a piece of work, not about the app.
 *
 * Kept apart from Hooks, where the same job used to be a shell command: a hook
 * is for what the machine does, and this is for what the window says. The old
 * example is still there and still works, for anyone who wants it.
 */
export function NotificationsTab(): ReactNode {
  const { draft, setDraft, error } = useConfigDraft();
  const [supported, setSupported] = useState<boolean | null>(null);
  const [sent, setSent] = useState<"ok" | "no" | null>(null);

  useEffect(() => {
    void window.opendesktop.notifications
      .supported()
      .then(setSupported)
      .catch(() => setSupported(false));
  }, []);

  if (!draft) return null;
  const settings = notificationSettings(draft.notifications);

  const put = (patch: Partial<typeof settings>): void =>
    setDraft({ ...draft, notifications: { ...draft.notifications, ...patch } });

  const test = (): void => {
    void window.opendesktop.notifications
      .test()
      .then((ok) => {
        setSent(ok ? "ok" : "no");
        setTimeout(() => setSent(null), 4000);
      })
      .catch(() => setSent("no"));
  };

  return (
    <Section
      title="Notifications"
      description={
        <>
          A turn ends, and the window is not the one in front — so the app says
          so from itself, and clicking what it says brings back that
          conversation. Each chat can overrule this from its own menu:{" "}
          <span className="font-mono">···</span> → Notifications.
        </>
      }
      action={
        <>
          {sent === "ok" ? <Hint tone="ok">Sent</Hint> : null}
          {sent === "no" ? (
            <Hint tone="bad">This system refused it</Hint>
          ) : null}
          {error ? <Hint tone="bad">{error}</Hint> : null}
          <IconButton title="Send a test notification" onClick={test}>
            <BellRing className="h-4 w-4" />
          </IconButton>
        </>
      }
    >
      {supported === false ? (
        <Row
          label="This system does not support notifications"
          description="Nothing to switch on here. A turn hook can still run a command when one ends."
        />
      ) : null}

      <Row
        label="Tell me when a turn ends"
        description="The app's own notification, for every conversation that has no opinion of its own. Off, nothing is ever shown, whatever a chat asks for."
      >
        <Toggle
          checked={settings.enabled}
          onChange={(next) => put({ enabled: next })}
        />
      </Row>

      <Row
        label="Only when the app is not in front"
        description="A notification for an answer you are reading is noise, and noise is how the whole thing gets switched off."
      >
        <Toggle
          checked={settings.onlyWhenUnfocused}
          onChange={(next) => put({ onlyWhenUnfocused: next })}
        />
      </Row>

      <Row
        label="Tell me when a turn fails"
        description="A turn that broke, with the reason it gave."
      >
        <Toggle
          checked={settings.onError}
          onChange={(next) => put({ onError: next })}
        />
      </Row>

      <Row
        label="Play a sound"
        description="The system's own notification sound, not one of ours."
      >
        <Toggle
          checked={settings.sound}
          onChange={(next) => put({ sound: next })}
        />
      </Row>

      <Row
        label="Not seeing anything?"
        description="macOS asks the first time, and keeps the answer in System Settings → Notifications, where a development build appears as Electron. macOS may drop notifications from a build that is not signed; the test says so when the system refuses one."
      >
        <Button variant="outline" size="sm" onClick={test}>
          Send a test
        </Button>
      </Row>
    </Section>
  );
}
