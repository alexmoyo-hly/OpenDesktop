import { describe, expect, test } from "vitest";
import {
  DEFAULT_LAYOUT,
  PANEL_MAX_HEIGHT,
  PANEL_MIN_HEIGHT,
  closePane,
  normalizeLayout,
  openPane,
  paneFor,
  panelTab,
  placePane,
  slotOf,
  togglePanel,
  type WorkbenchLayout,
} from "@shared/layout";

const layout = (over: Partial<WorkbenchLayout> = {}): WorkbenchLayout => ({
  ...DEFAULT_LAYOUT,
  panes: { left: [], right: [], bottom: ["terminal"] },
  panelActive: "terminal",
  panelOpen: false,
  ...over,
});

describe("the pane a tab name means", () => {
  test("Files and the editor are one pane, so both names reach it", () => {
    expect(paneFor("files")).toBe("files-editor");
    expect(paneFor("editor")).toBe("files-editor");
    // Everything else is itself.
    expect(paneFor("terminal")).toBe("terminal");
    expect(paneFor("changes")).toBe("changes");
  });
});

describe("placing a pane", () => {
  test("a pane lives in exactly one place", () => {
    const start = layout({
      panes: { left: [], right: ["changes"], bottom: ["terminal"] },
    });
    const moved = placePane(start.panes, "terminal", "right");
    expect(slotOf(moved, "terminal")).toBe("right");
    // Not in both: two columns would mount a terminal twice.
    expect(moved.bottom).toEqual([]);
    expect(moved.right).toEqual(["changes", "terminal"]);
  });

  test("a slot the pane cannot use leaves it where it is", () => {
    // Changes is a diff table; the bottom panel gives it a strip of width.
    const start = { left: [], right: ["changes" as const], bottom: [] };
    const after = placePane(start, "changes", "bottom");
    expect(slotOf(after, "changes")).toBe("right");
    expect(after.bottom).toEqual([]);
  });

  test("a pane that is already elsewhere moves, it does not duplicate", () => {
    const start = { left: ["terminal" as const], right: [], bottom: [] };
    const after = placePane(start, "terminal", "left");
    expect(after.left).toEqual(["terminal"]);
  });
});

describe("opening and closing", () => {
  test("opening a pane that is already in the panel reveals it, not rescopes it", () => {
    const start = layout({
      panes: { left: [], right: [], bottom: ["terminal", "background"] },
      panelActive: "background",
      panelOpen: false,
    });
    const after = openPane(start, "terminal");
    expect(after.panelOpen).toBe(true);
    expect(after.panelActive).toBe("terminal");
    // Revealed where it was: the tab count is unchanged.
    expect(after.panes.bottom).toEqual(["terminal", "background"]);
  });

  test("opening a closed pane puts a terminal in the panel and the rest beside the chat", () => {
    const empty = layout({
      panes: { left: [], right: [], bottom: [] },
      panelActive: null,
    });
    expect(openPane(empty, "terminal").panes.bottom).toEqual(["terminal"]);
    expect(openPane(empty, "changes").panes.right).toEqual(["changes"]);
  });

  test("closing a pane picks another tab, and closes the panel with the last one", () => {
    const start = layout({
      panes: { left: [], right: [], bottom: ["terminal", "background"] },
      panelActive: "terminal",
      panelOpen: true,
    });
    const one = closePane(start, "terminal");
    expect(one.panelActive).toBe("background");

    const none = closePane(one, "background");
    expect(none.panelActive).toBeNull();
    expect(none.panes.bottom).toEqual([]);
  });

  test("the toggle flips the panel and nothing else", () => {
    const start = layout();
    expect(togglePanel(start).panelOpen).toBe(true);
    expect(togglePanel(togglePanel(start))).toEqual(start);
  });

  test("the panel tab is null while the panel is closed", () => {
    expect(panelTab(layout({ panelOpen: false }))).toBeNull();
    expect(panelTab(layout({ panelOpen: true }))).toBe("terminal");
  });
});

describe("reading a layout back", () => {
  test("nothing at all is the default window, not an empty one", () => {
    const fresh = normalizeLayout(undefined);
    expect(fresh.panes.right).toEqual(DEFAULT_LAYOUT.panes.right);
    expect(fresh.panes.bottom).toEqual(DEFAULT_LAYOUT.panes.bottom);
  });

  test("an unknown pane from a newer build is dropped, the rest survives", () => {
    const read = normalizeLayout({
      panes: { right: ["changes", "from-the-future"], bottom: ["terminal"] },
    });
    expect(read.panes.right).toEqual(["changes"]);
    expect(read.panes.bottom).toEqual(["terminal"]);
  });

  test("a pane named twice is kept once", () => {
    const read = normalizeLayout({
      panes: { left: ["terminal"], right: ["terminal"], bottom: [] },
    });
    expect(read.panes.right).toEqual(["terminal"]);
  });

  test("a left column is folded into the one column the window draws", () => {
    // Nothing is lost: a hand-edited layout with a pane on the left still
    // shows that pane, on the right where the dock is.
    const read = normalizeLayout({
      panes: { left: ["changes"], right: ["terminal"], bottom: [] },
    });
    expect(read.panes.left).toEqual([]);
    expect(read.panes.right).toEqual(["terminal", "changes"]);
  });

  test("a pane in a column that cannot draw it falls out", () => {
    const read = normalizeLayout({
      panes: { left: [], right: [], bottom: ["files-editor", "terminal"] },
    });
    expect(read.panes.bottom).toEqual(["terminal"]);
  });

  test("the active tab has to be a tab that is in the panel", () => {
    const read = normalizeLayout({
      panes: { left: [], right: [], bottom: ["terminal", "background"] },
      panelActive: "changes",
    });
    expect(read.panelActive).toBe("terminal");
  });

  test("the panel height is clamped to something drawable", () => {
    expect(normalizeLayout({ panelHeight: 10 }).panelHeight).toBe(
      PANEL_MIN_HEIGHT,
    );
    expect(normalizeLayout({ panelHeight: 99999 }).panelHeight).toBe(
      PANEL_MAX_HEIGHT,
    );
    expect(normalizeLayout({ panelHeight: Number.NaN }).panelHeight).toBe(
      DEFAULT_LAYOUT.panelHeight,
    );
  });

  test('the files side defaults to the left and only "right" is the other answer', () => {
    expect(normalizeLayout({}).filesSide).toBe("left");
    expect(normalizeLayout({ filesSide: "right" }).filesSide).toBe("right");
    expect(normalizeLayout({ filesSide: "sideways" as never }).filesSide).toBe(
      "left",
    );
  });
});
