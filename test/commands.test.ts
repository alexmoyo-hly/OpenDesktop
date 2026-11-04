import { describe, expect, test } from "vitest";
import {
  COMMAND_IDS,
  COMMANDS,
  bindingFor,
  bindingFromEvent,
  commandForEvent,
  conflicts,
  formatKey,
  keymapTable,
  matches,
  parseKey,
  type KeyEventLike,
} from "@shared/commands";

/** A keystroke as the browser would report it. */
const key = (
  pressed: string,
  mods: Partial<Omit<KeyEventLike, "key">> = {},
): KeyEventLike => ({
  key: pressed,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

describe("reading a binding", () => {
  test("modifiers and the key, in any order", () => {
    expect(parseKey("Mod+Shift+J")).toEqual({
      mod: true,
      ctrl: false,
      alt: false,
      shift: true,
      key: "j",
    });
    expect(parseKey("shift+mod+j")).toEqual(parseKey("Mod+Shift+J"));
  });

  test("a symbol is a key, not a separator", () => {
    // The backtick binding is the whole reason this is not a bare split.
    expect(parseKey("Mod+`")?.key).toBe("`");
    expect(parseKey("Mod+,")?.key).toBe(",");
  });

  test("something that is not a binding is null, not a throw", () => {
    // This reads a hand-edited config: one bad line costs that line.
    expect(parseKey("")).toBeNull();
    expect(parseKey("Mod")).toBeNull();
    expect(parseKey("Mod+J+K")).toBeNull();
  });
});

describe("matching a keystroke", () => {
  test("Mod is the keyboard's command key, whichever it is", () => {
    expect(matches("Mod+J", key("j", { metaKey: true }))).toBe(true);
    expect(matches("Mod+J", key("j", { ctrlKey: true }))).toBe(true);
  });

  test("an explicit Ctrl means Control and nothing else", () => {
    expect(matches("Ctrl+J", key("j", { ctrlKey: true }))).toBe(true);
    expect(matches("Ctrl+J", key("j", { metaKey: true }))).toBe(false);
  });

  test("the modifiers have to agree exactly", () => {
    expect(matches("Mod+J", key("j", { metaKey: true, shiftKey: true }))).toBe(
      false,
    );
    expect(matches("Mod+J", key("j"))).toBe(false);
    expect(matches("Mod+J", key("k", { metaKey: true }))).toBe(false);
  });
});

describe("the command a keystroke belongs to", () => {
  test("the defaults answer when nothing is overridden", () => {
    expect(commandForEvent({}, key("j", { metaKey: true }))).toBe(
      "panel.toggle",
    );
    expect(commandForEvent(undefined, key("r", { metaKey: true }))).toBe(
      "folder.recent",
    );
    expect(commandForEvent({}, key("o", { metaKey: true }))).toBe(
      "folder.browse",
    );
  });

  test("an override beats the default, in both directions", () => {
    const keymap = { "panel.toggle": "Mod+Shift+T", "settings.open": "Mod+J" };
    expect(commandForEvent(keymap, key("j", { metaKey: true }))).toBe(
      "settings.open",
    );
    expect(
      commandForEvent(keymap, key("t", { metaKey: true, shiftKey: true })),
    ).toBe("panel.toggle");
  });

  test("an empty binding unbinds without falling back to the default", () => {
    const keymap = { "panel.toggle": "" };
    expect(bindingFor(keymap, "panel.toggle")).toBeNull();
    expect(commandForEvent(keymap, key("j", { metaKey: true }))).toBeNull();
  });

  test("a key nothing claims claims nothing", () => {
    expect(commandForEvent({}, key("j"))).toBeNull();
    expect(commandForEvent({}, key("q", { metaKey: true }))).toBeNull();
  });
});

describe("the table the settings page draws", () => {
  test("every default binding is one this app can actually match", () => {
    for (const command of COMMANDS) {
      if (command.defaultKey === null) continue;
      expect(parseKey(command.defaultKey), command.id).not.toBeNull();
    }
  });

  test("no two defaults are the same key", () => {
    const keys = COMMANDS.filter((c) => c.defaultKey).map((c) => ({
      id: c.id,
      binding: c.defaultKey!,
    }));
    expect(conflicts(keys)).toEqual({});
  });

  test("each command appears once, with its override marked", () => {
    const table = keymapTable({ "panel.toggle": "Mod+K" });
    expect(table).toHaveLength(COMMANDS.length);
    const toggle = table.find((entry) => entry.command.id === "panel.toggle");
    expect(toggle?.binding).toBe("Mod+K");
    expect(toggle?.overridden).toBe(true);
    expect(table.filter((entry) => entry.overridden)).toHaveLength(1);
  });

  test("two commands on one key are reported, and named by that key", () => {
    const found = conflicts([
      { id: "panel.toggle", binding: "Mod+J" },
      { id: "settings.open", binding: "mod+j" },
    ]);
    expect(Object.keys(found)).toEqual(["mod+j"]);
    expect(found["mod+j"]).toEqual(["panel.toggle", "settings.open"]);
  });
});

describe("recording a binding from a keystroke", () => {
  test("the modifiers are written the way the config spells them", () => {
    expect(bindingFromEvent(key("j", { metaKey: true, shiftKey: true }))).toBe(
      "Mod+Shift+j",
    );
  });

  test("a key with no modifier is not a shortcut", () => {
    // Binding plain "j" would take that letter away from every text box.
    expect(bindingFromEvent(key("j"))).toBeNull();
    // ...and neither is a modifier on its own, which is somebody mid-chord.
    expect(bindingFromEvent(key("Shift", { shiftKey: true }))).toBeNull();
  });
});

describe("printing a binding", () => {
  test("it says something for every default", () => {
    for (const command of COMMANDS) {
      if (command.defaultKey === null) continue;
      expect(formatKey(command.defaultKey), command.id).not.toBe("");
    }
  });

  test("named keys read as keys, not as identifiers", () => {
    expect(formatKey("Mod+ArrowDown")).toContain("↓");
    expect(formatKey("Mod+Enter")).toContain("⏎");
  });

  test("an unknown command id is not in the table", () => {
    expect(COMMAND_IDS).not.toContain("panel.fromTheFuture");
  });
});
