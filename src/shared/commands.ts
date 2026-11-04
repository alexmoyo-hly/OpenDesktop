/**
 * Every key the window can be driven from, and the one table that says which.
 *
 * VS Code's arrangement of the same idea: a command has an id, a title and a
 * default binding; the user overrides the binding in config, and the renderer
 * is the only place a keystroke is resolved to a command. What is *not* copied
 * is the dispatch model — there is no extension host here, so a command is a
 * closed set of things this app can do.
 *
 * Pure: parsing, matching and conflict detection are the parts worth testing,
 * and none of them needs a DOM.
 */

export const COMMAND_IDS = [
  "panel.toggle",
  "panel.terminal",
  "panel.activity",
  "panel.background",
  "panel.tasks",
  "panel.grow",
  "folder.browse",
  "folder.recent",
  "folder.search",
  "sidebar.toggle",
  "search.sessions",
  "session.new",
  "editor.save",
  "settings.open",
] as const;

export type CommandId = (typeof COMMAND_IDS)[number];

export interface CommandSpec {
  id: CommandId;
  title: string;
  /**
   * The default binding, as written in config. `Mod` is ⌘ on macOS and Ctrl
   * elsewhere, so one table serves both platforms and nobody reading it has to
   * work out which machine it was written for.
   */
  defaultKey: string | null;
  /** What the command does, for the settings page rather than for the window. */
  description: string;
}

/**
 * The defaults, in the order the settings page lists them.
 *
 * `Mod+J` for the panel and `Mod+O`/`Mod+R` for the two ways into the folder
 * picker are the three that matter: the panel is the thing you open and close
 * all day, and the folder a session runs in is the setting people change most
 * and used to be buried six segments down a path.
 *
 * `Mod+R` used to be the search half of the picker. It is the recent list now,
 * because the folder you want is usually one you have already been in — and
 * search moved to `Mod+Shift+O`, beside browse, where the two halves of one
 * picker belong.
 */
export const COMMANDS: CommandSpec[] = [
  {
    id: "panel.toggle",
    title: "Toggle panel",
    defaultKey: "Mod+J",
    description:
      "Show or hide the panel across the bottom. Its default tab is the terminal.",
  },
  {
    id: "panel.terminal",
    title: "Terminal",
    defaultKey: "Mod+`",
    description:
      "Reveal the terminal, moving it into the panel if it lives elsewhere.",
  },
  {
    id: "panel.activity",
    title: "Activity",
    defaultKey: null,
    description: "Reveal the activity table.",
  },
  {
    id: "panel.background",
    title: "Background tasks",
    defaultKey: null,
    description: "Reveal the commands running in the background.",
  },
  {
    id: "panel.tasks",
    title: "Task panel",
    defaultKey: null,
    description: "Reveal the message the agent is working on, if any.",
  },
  {
    id: "panel.grow",
    title: "Grow the panel",
    defaultKey: "Mod+Shift+J",
    description: "Open the panel taller, for reading a long output.",
  },
  {
    id: "folder.browse",
    title: "Select folder (browse)",
    defaultKey: "Mod+O",
    description:
      "Choose this conversation's folder by stepping through the tree.",
  },
  {
    id: "folder.recent",
    title: "Select folder (recent)",
    defaultKey: "Mod+R",
    description: "Choose this conversation's folder from the ones used before.",
  },
  {
    id: "folder.search",
    title: "Select folder (search)",
    defaultKey: "Mod+Shift+O",
    description: "Find a folder by typing part of its path.",
  },
  {
    id: "sidebar.toggle",
    title: "Toggle sidebar",
    defaultKey: "Mod+B",
    description: "Show or hide the session list.",
  },
  {
    id: "search.sessions",
    title: "Search sessions",
    defaultKey: "Mod+P",
    description: "Filter the session list as you type.",
  },
  {
    id: "session.new",
    title: "New session",
    defaultKey: "Mod+Shift+N",
    description: "Start a conversation in this conversation's folder.",
  },
  {
    id: "editor.save",
    title: "Save the open file",
    defaultKey: "Mod+S",
    description: "Write the editor's file to disk.",
  },
  {
    id: "settings.open",
    title: "Settings",
    defaultKey: "Mod+,",
    description: "Open settings over the workspace.",
  },
];

export const COMMAND_BY_ID = Object.fromEntries(
  COMMANDS.map((command) => [command.id, command]),
) as Record<CommandId, CommandSpec>;

/**
 * A keystroke, as far as this app cares about it.
 *
 * `Mod` is the platform's command key; `Ctrl`, `Alt` and `Shift` are the
 * others. Named rather than positional so the config file and the interface
 * print the same string.
 */
export interface KeyChord {
  mod: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  /** Lower-cased, so `Mod+S` and `mod+s` are the same key. */
  key: string;
}

const MODIFIERS = ["mod", "ctrl", "alt", "shift"] as const;

/**
 * The parts of a keyboard event this module reads.
 *
 * Structural rather than the DOM's `KeyEventLike`, because `@shared` is
 * compiled by both the node and the web TypeScript projects and the node one
 * has no DOM library to name that type from.
 */
export interface KeyEventLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/**
 * A binding as written, as a chord.
 *
 * `null` for anything that is not a binding, rather than a throw: this reads a
 * hand-edited config, and one bad line must cost that line and nothing else.
 */
export function parseKey(binding: string): KeyChord | null {
  if (typeof binding !== "string") return null;
  const parts = binding
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  const chord: KeyChord = {
    mod: false,
    ctrl: false,
    alt: false,
    shift: false,
    key: "",
  };
  for (const part of parts) {
    const lower = part.toLowerCase();
    if ((MODIFIERS as readonly string[]).includes(lower)) {
      chord[lower as (typeof MODIFIERS)[number]] = true;
      continue;
    }
    // Two real keys is not a chord.
    if (chord.key) return null;
    chord.key = lower;
  }
  if (!chord.key) return null;
  return chord;
}

/** Whether the platform's command key is the one `Mod` means. */
const isMac = (): boolean =>
  typeof navigator !== "undefined" &&
  /mac/i.test(navigator.platform || navigator.userAgent);

/**
 * How a key reads on a keycap.
 *
 * `event.key` gives "ArrowDown" and " " for the space bar; a settings row that
 * printed those would be unreadable. Only names and single letters are
 * rewritten, so a symbol is left exactly as it is.
 */
const KEY_NAMES: Record<string, string> = {
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  enter: "⏎",
  return: "⏎",
  escape: "Esc",
  backspace: "⌫",
  delete: "Del",
  " ": "Space",
  space: "Space",
  tab: "⇥",
  pageup: "PgUp",
  pagedown: "PgDn",
};

function displayKey(key: string): string {
  return (
    KEY_NAMES[key] ??
    (key.length === 1
      ? key.toUpperCase()
      : key.charAt(0).toUpperCase() + key.slice(1))
  );
}

/**
 * The string a chord is shown as, for this platform.
 *
 * Each platform has its own order for modifiers and its own glyphs; a menu
 * that says `Ctrl+Shift+J` on a Mac teaches the wrong muscle memory.
 */
export function formatKey(binding: string): string {
  const chord = parseKey(binding);
  if (!chord) return "";
  const mac = isMac();
  const pieces: string[] = [];
  if (mac) {
    if (chord.ctrl) pieces.push("⌃");
    if (chord.alt) pieces.push("⌥");
    if (chord.shift) pieces.push("⇧");
    if (chord.mod) pieces.push("⌘");
  } else {
    if (chord.mod || chord.ctrl) pieces.push("Ctrl");
    if (chord.alt) pieces.push("Alt");
    if (chord.shift) pieces.push("Shift");
  }
  pieces.push(displayKey(chord.key));
  return mac && pieces.length > 1 ? pieces.join("") : pieces.join("+");
}

/** The event as a chord, in the shape the bindings are parsed into. */
export function chordOf(event: KeyEventLike): KeyChord | null {
  const key = event.key;
  if (
    !key ||
    key === "Meta" ||
    key === "Control" ||
    key === "Alt" ||
    key === "Shift"
  )
    return null;
  return {
    // Both are `Mod`: a keyboard with a Windows layout still sends metaKey for
    // the key beside the space bar, and that is not a reason for the panel to
    // stop opening.
    mod: event.metaKey || event.ctrlKey,
    ctrl: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
    key: key.toLowerCase(),
  };
}

/**
 * Whether a keystroke is a binding.
 *
 * `Mod` stands for "meta or control" rather than for one of them, which keeps
 * ⌘J and Ctrl+J the same shortcut on the two platforms. An explicit `Ctrl+X`
 * still means Control on every platform, so it matches that key and nothing
 * else — which is the whole point of spelling it out.
 */
export function matches(binding: string, event: KeyEventLike): boolean {
  const chord = parseKey(binding);
  const actual = chordOf(event);
  if (!chord || !actual) return false;
  if (chord.key !== actual.key) return false;
  if (chord.alt !== actual.alt) return false;
  if (chord.shift !== actual.shift) return false;

  const commandKey = event.metaKey || event.ctrlKey;
  /*
   * `Mod` is the platform's command key: meta or control, either one, which
   * is what makes ⌘J and Ctrl+J the same shortcut on the two platforms.
   */
  if (chord.mod && !commandKey) return false;
  // With no `Mod`, a bare `Ctrl` is the only way the command key is allowed.
  if (!chord.mod && commandKey && !chord.ctrl) return false;
  // `Ctrl`, spelled out, is Control and nothing else — the whole point of it.
  if (chord.ctrl && !event.ctrlKey) return false;
  return true;
}

export type Keymap = Partial<Record<CommandId, string>>;

/** A binding as stored, or the command's default when it has none of its own. */
export function bindingFor(
  keymap: Keymap | undefined,
  id: CommandId,
): string | null {
  const custom = keymap?.[id];
  if (typeof custom === "string") return custom.trim() === "" ? null : custom;
  return COMMAND_BY_ID[id].defaultKey;
}

/**
 * The command a keystroke belongs to, if any.
 *
 * Custom bindings are tried first, because somebody who rebound a key meant it
 * to beat whatever the default was.
 */
export function commandForEvent(
  keymap: Keymap | undefined,
  event: KeyEventLike,
): CommandId | null {
  for (const id of COMMAND_IDS) {
    const custom = keymap?.[id];
    if (typeof custom === "string" && custom.trim() && matches(custom, event))
      return id;
  }
  for (const command of COMMANDS) {
    if (keymap?.[command.id] !== undefined) continue;
    if (command.defaultKey && matches(command.defaultKey, event))
      return command.id;
  }
  return null;
}

/** The same keystroke, written the same way, for comparing two bindings. */
function canonical(binding: string): string | null {
  const chord = parseKey(binding);
  if (!chord) return null;
  return [
    chord.mod ? "mod" : "",
    chord.ctrl ? "ctrl" : "",
    chord.alt ? "alt" : "",
    chord.shift ? "shift" : "",
    chord.key,
  ]
    .filter(Boolean)
    .join("+");
}

/**
 * Two commands on one key.
 *
 * Reported rather than prevented: the settings page says so and the window
 * still opens, because refusing to save a config is a worse way to find out.
 * Custom bindings win at dispatch, so the loser is the one worth naming.
 */
export function conflicts(
  keys: { id: CommandId; binding: string }[],
): Record<string, CommandId[]> {
  const byKey = new Map<string, CommandId[]>();
  for (const { id, binding } of keys) {
    const key = canonical(binding);
    if (!key) continue;
    byKey.set(key, [...(byKey.get(key) ?? []), id]);
  }
  return Object.fromEntries(
    [...byKey.entries()].filter(([, ids]) => ids.length > 1),
  );
}

/** Every command's binding, default or overridden, for the settings page. */
export function keymapTable(
  keymap: Keymap | undefined,
): { command: CommandSpec; binding: string | null; overridden: boolean }[] {
  return COMMANDS.map((command) => ({
    command,
    binding: bindingFor(keymap, command.id),
    overridden: keymap?.[command.id] !== undefined,
  }));
}

/**
 * A binding typed into the settings page, from the key that was pressed.
 *
 * The inverse of `matches`, and the only way to record a shortcut without
 * asking somebody to spell it: modifiers in the order the config writes them,
 * then the key. Undefined for a keystroke that is nothing but modifiers, which
 * is somebody still reaching for the chord.
 */
export function bindingFromEvent(event: KeyEventLike): string | null {
  const chord = chordOf(event);
  if (!chord) return null;
  const pieces: string[] = [];
  if (chord.mod) pieces.push("Mod");
  if (chord.alt) pieces.push("Alt");
  if (chord.shift) pieces.push("Shift");
  // The key alone, with no modifier, is a typing key: binding it would take
  // that letter away from every text box in the window.
  if (pieces.length === 0) return null;
  pieces.push(chord.key);
  return pieces.join("+");
}
