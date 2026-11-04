/**
 * The shape of the window, as a document the renderer and the main process
 * both read.
 *
 * VS Code's arrangement, and deliberately only the part of it worth copying:
 * a workbench of named panes, each of which is either docked to an edge, kept
 * in the bottom panel, or up. The interesting one is `files-editor` — Files
 * and the Editor are one element, not two, because a file tree with nothing
 * open is a directory listing and the editor is what the tree is for.
 *
 * Pure data and pure functions, no DOM and no electron: the headless tests
 * cover the rules here without a renderer, which is also what keeps the
 * rules honest when the interface around them changes.
 */

/** Every pane the workbench knows about. */
export const PANE_IDS = [
  "changes",
  "terminal",
  "browser",
  "files-editor",
  "activity",
  "background",
  "tasks",
] as const;

export type PaneId = (typeof PANE_IDS)[number];

/** An edge of the window, or the panel across the bottom. */
export type PaneSlot = "left" | "right" | "bottom" | "hidden";

/** The three panes that exist before anybody configures anything. */
export const DEFAULT_DOCKED: PaneId[] = ["files-editor", "changes"];
/** The panel's default, which is the terminal. */
export const DEFAULT_PANEL: PaneId[] = ["terminal"];

export const PANE_LABEL: Record<PaneId, string> = {
  changes: "Changes",
  terminal: "Terminal",
  browser: "Browser",
  "files-editor": "Files and editor",
  activity: "Activity",
  background: "Background tasks",
  tasks: "Task panel",
};

/**
 * Where each pane may go.
 *
 * Not every pane is happy everywhere: the bottom panel gives its width to a
 * terminal and nothing to a file tree, and Activity is a table that needs a
 * whole window. What is not listed here is not offered, which is the only way
 * a drag in the editor can fail to produce a layout that renders as an empty
 * strip.
 */
export const PANE_SLOTS: Record<PaneId, PaneSlot[]> = {
  changes: ["right"],
  terminal: ["right", "bottom"],
  browser: ["right", "bottom"],
  "files-editor": ["right"],
  activity: ["right", "bottom"],
  background: ["right", "bottom"],
  tasks: ["right", "bottom"],
};

export interface PaneLayout {
  /**
   * Panes in the side column, in order, outermost first.
   *
   * One column, on the right, which is where the dock has always been. A left
   * column is a place this window could grow into — the type keeps a slot for
   * it and `normalizeLayout` folds it in — but offering a move the window does
   * not draw would be worse than not offering it.
   */
  left: PaneId[];
  right: PaneId[];
  /** Panes in the bottom panel, as tabs. The first one is shown. */
  bottom: PaneId[];
}

export interface WorkbenchLayout {
  panes: PaneLayout;
  /**
   * Which bottom tab is in front. Separate from the list because closing it,
   * or dragging another pane in, must not silently change what is on screen
   * when it comes back.
   */
  panelActive: PaneId | null;
  /** Whether the bottom panel is showing at all. */
  panelOpen: boolean;
  /** How tall the bottom panel is, in pixels. */
  panelHeight: number;
  /**
   * Which side of the editor the file tree sits on.
   *
   * They are one pane and not two — a tree with nothing open is a listing, and
   * the editor is what the tree is for — but which of them comes first is a
   * real preference, and it is the same one VS Code offers.
   */
  filesSide: "left" | "right";
}

export const PANEL_MIN_HEIGHT = 120;
export const PANEL_MAX_HEIGHT = 900;

/** The file tree inside the Files-and-editor pane. */
export const FILES_WIDTH = 220;
export const FILES_MIN_WIDTH = 140;
export const FILES_MAX_WIDTH = 520;

export const DEFAULT_LAYOUT: WorkbenchLayout = {
  panes: { left: [], right: [...DEFAULT_DOCKED], bottom: [...DEFAULT_PANEL] },
  panelActive: "terminal",
  panelOpen: false,
  panelHeight: 260,
  filesSide: "left",
};

/**
 * The layout pane a caller's tab name means.
 *
 * `files` and `editor` are one pane now — a file tree with nothing open is a
 * directory listing, and the editor is what the tree is for — so a caller
 * asking for either gets the pair.
 */
export function paneFor(tab: string): PaneId {
  if (tab === "files" || tab === "editor") return "files-editor";
  return tab as PaneId;
}

/** Where a pane is, if it is anywhere. */
export function slotOf(layout: PaneLayout, pane: PaneId): PaneSlot {
  if (layout.left.includes(pane)) return "left";
  if (layout.right.includes(pane)) return "right";
  if (layout.bottom.includes(pane)) return "bottom";
  return "hidden";
}

/** Every pane in the order the window draws them. */
export function visiblePanes(layout: PaneLayout): PaneId[] {
  return [...layout.left, ...layout.right, ...layout.bottom];
}

function without(layout: PaneLayout, pane: PaneId): PaneLayout {
  return {
    left: layout.left.filter((id) => id !== pane),
    right: layout.right.filter((id) => id !== pane),
    bottom: layout.bottom.filter((id) => id !== pane),
  };
}

/**
 * Puts a pane in a place, taking it out of wherever it was.
 *
 * A pane lives in exactly one place, so this is a move and not an addition:
 * the same pane in two columns would mount a terminal twice and open two
 * shells under one conversation.
 */
export function placePane(
  layout: PaneLayout,
  pane: PaneId,
  slot: PaneSlot
): PaneLayout {
  /*
   * Refused before anything is removed. Taking the pane out first and then
   * declining the slot left it nowhere at all — the pane vanished from the
   * window rather than staying where it was, which is a lost terminal.
   */
  if (slot === "hidden") return without(layout, pane);
  if (!PANE_SLOTS[pane].includes(slot)) return layout;
  const next = without(layout, pane);
  return { ...next, [slot]: [...next[slot], pane] };
}

/**
 * Adds a pane that is closed, or brings one back to the front.
 *
 * The difference matters for the bottom panel: a terminal that is merely
 * hidden should be revealed where it was, not reopened beside it.
 */
export function openPane(
  layout: WorkbenchLayout,
  pane: PaneId,
): WorkbenchLayout {
  const slot = slotOf(layout.panes, pane);
  if (slot === "bottom") {
    return { ...layout, panelOpen: true, panelActive: pane };
  }
  if (slot !== "hidden") return layout;
  // A pane that has never been placed goes where it is most useful: a
  // terminal to the panel, everything else beside the chat.
  const preference: PaneSlot[] = PANE_SLOTS[pane].includes("bottom")
    ? ["bottom", "right", "left"]
    : ["right", "left"];
  const target = preference[0];
  const panes = placePane(layout.panes, pane, target);
  return target === "bottom"
    ? { ...layout, panes, panelOpen: true, panelActive: pane }
    : { ...layout, panes };
}

/** Takes a pane out of the window entirely. The panes it displaced stay put. */
export function closePane(
  layout: WorkbenchLayout,
  pane: PaneId,
): WorkbenchLayout {
  const panes = without(layout.panes, pane);
  const stillThere = panes.bottom.includes(layout.panelActive ?? "terminal");
  return {
    ...layout,
    panes,
    panelActive: stillThere ? layout.panelActive : (panes.bottom[0] ?? null),
    // The panel itself stays open: closing the last tab and closing the panel
    // are the same click, and VS Code keeps it open with an empty panel rather
    // than collapsing the window under the cursor.
    panelOpen: layout.panelOpen,
  };
}

/** The panel toggle: one key, and it always means the bottom panel. */
export function togglePanel(layout: WorkbenchLayout): WorkbenchLayout {
  return { ...layout, panelOpen: !layout.panelOpen };
}

/** Which pane a toggle acts on when the panel is already showing it. */
export function panelTab(layout: WorkbenchLayout): PaneId | null {
  if (!layout.panelOpen) return null;
  const active = layout.panelActive;
  if (active && layout.panes.bottom.includes(active)) return active;
  return layout.panes.bottom[0] ?? null;
}

export function clampPanelHeight(height: number): number {
  if (!Number.isFinite(height)) return DEFAULT_LAYOUT.panelHeight;
  return Math.min(
    PANEL_MAX_HEIGHT,
    Math.max(PANEL_MIN_HEIGHT, Math.round(height)),
  );
}

/**
 * A layout from something that might not be one.
 *
 * The renderer stores this in the config file, which is hand-editable, so
 * every field is checked rather than trusted. A pane named twice, a pane in a
 * column that cannot render it, or an unknown id from a newer build all have
 * to leave a window that still draws.
 */
export function normalizeLayout(raw: unknown): WorkbenchLayout {
  const source = (raw ?? {}) as Partial<WorkbenchLayout> & {
    panes?: Partial<PaneLayout>;
    /** The shape written before the workbench existed: one pane, on the right. */
    dock?: { tab?: string; width?: number; open?: boolean };
  };

  const seen = new Set<PaneId>();
  const column = (value: unknown, slot: PaneSlot): PaneId[] =>
    (Array.isArray(value) ? value : []).filter((id): id is PaneId => {
      if (typeof id !== "string") return false;
      if (!PANE_IDS.includes(id as PaneId)) return false;
      if (!PANE_SLOTS[id as PaneId].includes(slot)) return false;
      if (seen.has(id as PaneId)) return false;
      seen.add(id as PaneId);
      return true;
    });

  const panes: PaneLayout = {
    left: column(source.panes?.left, "left"),
    right: column(source.panes?.right, "right"),
    bottom: column(source.panes?.bottom, "bottom"),
  };

  /*
   * A left column is not drawn, so anything a hand-edited file put there is
   * folded into the one column that is. Dropping it would make a pane vanish
   * from a window somebody had arranged.
   */
  for (const entry of Array.isArray(source.panes?.left) ? source.panes!.left! : []) {
    if (typeof entry !== "string") continue;
    if (!PANE_IDS.includes(entry as PaneId)) continue;
    if (seen.has(entry as PaneId)) continue;
    seen.add(entry as PaneId);
    panes.right.push(entry as PaneId);
  }
  panes.left = [];

  // Nothing said at all: the defaults. Not an empty window, which is what a
  // missing key would otherwise mean for somebody's first launch.
  if (panes.left.length + panes.right.length + panes.bottom.length === 0) {
    const fresh = DEFAULT_LAYOUT.panes;
    panes.left = [...fresh.left];
    panes.right = [...fresh.right];
    panes.bottom = [...fresh.bottom];
  }

  const active =
    typeof source.panelActive === "string" &&
    panes.bottom.includes(source.panelActive as PaneId)
      ? (source.panelActive as PaneId)
      : (panes.bottom[0] ?? null);

  return {
    panes,
    panelActive: active,
    panelOpen: source.panelOpen === true,
    panelHeight: clampPanelHeight(
      source.panelHeight ?? DEFAULT_LAYOUT.panelHeight,
    ),
    filesSide: source.filesSide === "right" ? "right" : "left",
  };
}
