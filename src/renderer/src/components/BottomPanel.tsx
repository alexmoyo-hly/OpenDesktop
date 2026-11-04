import clsx from "clsx";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { PanelBottomClose, X } from "lucide-react";
import { PANE_LABEL, panelTab, type PaneId } from "@shared/layout";
import { useStore } from "../state/store";
import { PANE_FRAME } from "./ui";
import { TerminalPane } from "./TerminalPane";
import { BackgroundTasksPane } from "./BackgroundTasksPane";
import { ActivityPane } from "./ActivityPane";

/**
 * The bottom panel: the terminal, and whatever else has been dragged into it.
 *
 * Which panes are here, which one is in front and how tall it is all live in
 * `@shared/layout`, because the main process reads the same document. This
 * component only draws it and hands clicks back as layout transitions.
 */
export function BottomPanel(): ReactNode {
  const layout = useStore((s) => s.layout);
  const togglePanel = useStore((s) => s.togglePanel);
  const setPanelActive = useStore((s) => s.setPanelActive);
  const closePaneInWorkbench = useStore((s) => s.closePaneInWorkbench);
  const setPanelHeight = useStore((s) => s.setPanelHeight);

  // Which panes have ever been shown. The terminal holds a PTY in the main
  // process: unmounting it kills the shell, and Electron then throws
  // "Invalid guestInstanceId" when the pane comes back. Mounted once, then
  // hidden, is the only lifetime it survives.
  const [opened, setOpened] = useState<Set<PaneId>>(() => new Set());

  useEffect(() => {
    if (!layout.panelOpen) return;
    const active = panelTab(layout);
    if (!active || opened.has(active)) return;
    setOpened((current) => new Set(current).add(active));
  }, [layout, opened]);

  /*
   * A drag is deltas, not a position: the pointer starts wherever it is on the
   * top edge and the panel grows by how far it has moved up since then. Both
   * ends are kept in the ref so the panel does not follow a pointer that was
   * already halfway up the window when the drag began.
   */
  const dragging = useRef<{ startY: number; startHeight: number } | null>(null);

  const onMove = useCallback(
    (event: MouseEvent) => {
      const drag = dragging.current;
      if (!drag) return;
      setPanelHeight(drag.startHeight + (drag.startY - event.clientY));
    },
    [setPanelHeight],
  );

  useEffect(() => {
    const onUp = (): void => {
      dragging.current = null;
      document.body.style.cursor = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [onMove]);

  // Null while the panel is closed, which is why the panes below are keyed off
  // `opened` rather than off this value: a closed panel must not unmount them.
  const active = panelTab(layout);

  return (
    // Hidden rather than unmounted when closed, for the shell's sake.
    <div
      data-bottom-panel="true"
      className={clsx(
        PANE_FRAME,
        "bg-ink-850 relative shrink-0 flex-col",
        layout.panelOpen ? "flex" : "hidden",
      )}
      style={{ height: layout.panelHeight }}
    >
      {/* In the top gutter, so it never sits on a tab or on pane content. */}
      <div
        onMouseDown={(event) => {
          event.preventDefault();
          dragging.current = {
            startY: event.clientY,
            startHeight: layout.panelHeight,
          };
          document.body.style.cursor = "row-resize";
        }}
        className="hover:bg-brand/40 absolute left-0 top-0 z-10 h-1 w-full cursor-row-resize"
      />

      <div className="border-ink-800 flex h-9 shrink-0 items-center gap-1 border-b px-2">
        {layout.panes.bottom.map((pane) => (
          <div
            key={pane}
            className={clsx(
              "flex items-center gap-1 rounded-md py-[2px] pl-2 pr-1",
              active === pane
                ? "bg-ink-800 text-ink-100"
                : "text-ink-400 hover:bg-ink-850 hover:text-ink-200",
            )}
          >
            <button
              type="button"
              title={PANE_LABEL[pane]}
              onClick={() => setPanelActive(pane)}
              className="text-[12px]"
            >
              {PANE_LABEL[pane]}
            </button>
            <button
              type="button"
              title={`Close ${PANE_LABEL[pane]}`}
              onClick={() => closePaneInWorkbench(pane)}
              className="text-ink-600 hover:bg-ink-700 hover:text-ink-100 rounded p-[2px]"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}

        <button
          type="button"
          title="Hide the bottom panel"
          onClick={togglePanel}
          className="text-ink-600 hover:bg-ink-800 hover:text-ink-200 ml-auto rounded p-1"
        >
          <PanelBottomClose className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {/* Mounted on first show, then kept alive and merely hidden. */}
        {opened.has("terminal") ? (
          <div
            className={clsx(
              "min-h-0 flex-1 flex-col",
              active === "terminal" ? "flex" : "hidden",
            )}
          >
            <TerminalPane />
          </div>
        ) : null}
        {opened.has("background") ? (
          <div
            className={clsx(
              "min-h-0 flex-1 flex-col",
              active === "background" ? "flex" : "hidden",
            )}
          >
            <BackgroundTasksPane />
          </div>
        ) : null}
        {/* Nothing to lose by unmounting, and it polls while it is up. */}
        {active === "activity" ? <ActivityPane /> : null}
        {/*
          * The task panel is the card the board has open, and there is only
          * ever one: it is drawn by the chat itself, so a panel tab for it
          * would be a second view of the same conversation. Offered as a move
          * and answered honestly rather than silently doing nothing.
        */}
        {active === "tasks" ? (
          <div className="text-ink-600 flex flex-1 items-center justify-center px-6 text-center text-[12px]">
            The task panel is the card the board has open, so it lives beside
            the chat rather than in the panel.
          </div>
        ) : null}
        {active === "browser" ? (
          <div className="text-ink-600 flex flex-1 items-center justify-center text-[12px]">
            {PANE_LABEL[active]} has no panel view yet.
          </div>
        ) : null}
        {/* Closing the last tab keeps the panel open, so it needs a face. */}
        {active === null ? (
          <div className="text-ink-600 flex flex-1 items-center justify-center text-[12px]">
            Nothing open. ⌘J hides the panel.
          </div>
        ) : null}
      </div>
    </div>
  );
}
