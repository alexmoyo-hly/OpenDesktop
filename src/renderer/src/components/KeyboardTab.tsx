import clsx from "clsx";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { RotateCcw, TriangleAlert } from "lucide-react";
import {
  COMMANDS,
  bindingFromEvent,
  conflicts,
  formatKey,
  keymapTable,
  type CommandId,
} from "@shared/commands";
import { useStore } from "../state/store";
import { Hint, Row, Section } from "./settings-ui";

/**
 * The keyboard, as a table of commands rather than a list of key names.
 *
 * The same choice VS Code makes and for the same reason: nobody thinks "I want
 * ⌘J", they think "I want the panel", and a settings page that begins with the
 * key cannot answer that. Each row starts from what the command does, shows
 * what it is bound to, and takes a new binding by being clicked and pressed.
 *
 * A binding is recorded by pressing the chord, not by spelling it: `Mod+Shift+J`
 * is a thing the config file can say and a thing nobody should have to type.
 */
function BindingEditor({
  command,
  value,
  overridden,
  onRecord,
  onReset,
}: {
  command: CommandId;
  value: string | null;
  overridden: boolean;
  onRecord: (binding: string | null) => void;
  onReset: () => void;
}): ReactNode {
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    if (!recording) return;
    const onKey = (event: KeyboardEvent): void => {
      // The recorder swallows everything while it is up, including the keys
      // the window would otherwise act on: binding a shortcut must not also
      // run the old one.
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        setRecording(false);
        return;
      }
      if (event.key === "Backspace" || event.key === "Delete") {
        onRecord(null);
        setRecording(false);
        return;
      }
      const binding = bindingFromEvent(event);
      if (!binding) return;
      onRecord(binding);
      setRecording(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording, onRecord]);

  return (
    <div className="flex items-center gap-1.5">
      {overridden ? (
        <button
          type="button"
          title="Back to the default"
          onClick={onReset}
          className="text-ink-500 hover:bg-ink-800 hover:text-ink-100 rounded-md p-1.5"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      ) : null}
      <button
        type="button"
        data-command={command}
        onClick={() => setRecording(!recording)}
        title={
          recording
            ? "Press a key, or Escape to cancel"
            : "Click, then press the keys"
        }
        className={clsx(
          "min-w-[92px] rounded-md border px-2.5 py-1 font-mono text-[11.5px] transition-colors",
          recording
            ? "border-brand text-brand bg-brand/10"
            : value
              ? "border-ink-700 text-ink-200 hover:border-ink-600 bg-ink-850"
              : "border-ink-800 text-ink-600 hover:border-ink-600 bg-ink-850",
        )}
      >
        {recording ? "press…" : value ? formatKey(value) : "unbound"}
      </button>
    </div>
  );
}

export function KeyboardTab(): ReactNode {
  const config = useStore((s) => s.config);
  const refreshConfig = useStore((s) => s.refreshConfig);
  const [error, setError] = useState<string | null>(null);

  const keymap = config?.keymap ?? {};

  /*
   * One write per change rather than a draft and a timer: a keymap is a
   * handful of short strings, and a shortcut that is not saved when the page
   * is closed is a shortcut that appeared to work and then did not.
   */
  const save = async (patch: Record<string, string>): Promise<void> => {
    if (!config) return;
    setError(null);
    try {
      await window.opendesktop.config.save({
        ...config,
        keymap: { ...keymap, ...patch },
      });
      await refreshConfig();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const table = useMemo(() => keymapTable(keymap), [keymap]);

  // Named, because "two commands share a key" is only useful if it says which.
  const clashes = useMemo(() => {
    const found = conflicts(
      table
        .filter((entry) => entry.binding)
        .map((entry) => ({ id: entry.command.id, binding: entry.binding! })),
    );
    const titles = (ids: CommandId[]): string =>
      ids
        .map((id) => COMMANDS.find((c) => c.id === id)?.title ?? id)
        .join(" and ");
    return Object.entries(found).map(
      ([key, ids]) => `${titles(ids)} share ${key}`,
    );
  }, [table]);

  return (
    <Section
      title="Keyboard"
      description={
        <>
          Every key the window answers to. Click a binding and press the keys to
          replace it, or press ⌫ to unbind.{" "}
          <span className="font-mono">Mod</span> is ⌘ on a Mac and Ctrl
          elsewhere, so one file works on both. On the folder picker, ⌘O opens
          browse, ⌘R the recent list and ⌘⇧O the search.
        </>
      }
      action={
        error ? (
          <Hint tone="bad">{error}</Hint>
        ) : clashes.length > 0 ? (
          <Hint tone="warn">
            <TriangleAlert className="mr-1 inline h-3.5 w-3.5" />
            {clashes.length} key{clashes.length === 1 ? "" : "s"} bound twice
          </Hint>
        ) : null
      }
    >
      {table.map(({ command, binding, overridden }) => (
        <Row
          key={command.id}
          label={command.title}
          description={
            <>
              {command.description}
              {command.defaultKey ? (
                <span className="text-ink-600">
                  {" "}
                  Default {formatKey(command.defaultKey)}.
                </span>
              ) : null}
            </>
          }
        >
          <BindingEditor
            command={command.id}
            value={binding}
            overridden={overridden}
            // An empty string is stored rather than the key removed: absent
            // means "follow the default", and unbinding must survive that.
            onRecord={(next) => void save({ [command.id]: next ?? "" })}
            onReset={() => void save({ [command.id]: "" })}
          />
        </Row>
      ))}

      {clashes.length > 0 ? (
        <div className="text-warn py-2 text-[12px]">
          {clashes.map((clash) => (
            <div key={clash}>{clash}.</div>
          ))}
          <div className="text-ink-500 mt-1">
            A custom binding wins over a default, so the other command will not
            fire on that key.
          </div>
        </div>
      ) : null}
    </Section>
  );
}
