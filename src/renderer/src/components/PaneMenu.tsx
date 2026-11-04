import clsx from "clsx";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Check,
  PanelBottom,
  PanelLeft,
  PanelRight,
  PanelTop,
  X,
} from "lucide-react";
import {
  PANE_IDS,
  PANE_LABEL,
  PANE_SLOTS,
  placePane,
  slotOf,
  type PaneId,
  type PaneSlot,
} from "@shared/layout";
import { useStore } from "../state/store";
import { IconButton } from "./settings-ui";

const SLOT_LABEL: Record<PaneSlot, string> = {
  left: "Left column",
  right: "Right column",
  bottom: "Bottom panel",
  hidden: "Closed",
};

function SlotIcon({ slot }: { slot: PaneSlot }): ReactNode {
  if (slot === "left") return <PanelLeft className="h-3.5 w-3.5" />;
  if (slot === "right") return <PanelRight className="h-3.5 w-3.5" />;
  if (slot === "bottom") return <PanelBottom className="h-3.5 w-3.5" />;
  return <X className="h-3.5 w-3.5" />;
}

/**
 * Where every pane lives, in one place.
 *
 * The workbench is configurable, so it needs somewhere to be configured — and
 * the answer is not a drag-and-drop implementation in a first pass. A menu
 * that lists every pane and where it currently is answers "how do I get the
 * terminal down here" in one click, works for a pane that is closed, and has
 * no failure mode that leaves the window in a state it cannot draw. Dragging
 * can come later and would use exactly this transition.
 */
export function PaneMenu(): ReactNode {
  const layout = useStore((s) => s.layout);
  const applyLayout = useStore((s) => s.applyLayout);
  const persistLayout = useStore((s) => s.persistLayout);

  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent): void => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const move = (pane: PaneId, slot: PaneSlot): void => {
    applyLayout(placePane(layout.panes, pane, slot));
    // Written on every move: an arrangement that is not saved is one somebody
    // has to redo on Monday.
    void persistLayout();
  };

  return (
    <div className="relative" ref={box}>
      <IconButton
        title="Arrange the panes"
        onClick={() => setOpen(!open)}
        tone={open ? "accent" : "plain"}
      >
        <PanelTop className="h-3.5 w-3.5" />
      </IconButton>

      {open ? (
        <div className="border-ink-700 bg-ink-850 absolute right-0 top-9 z-50 w-[264px] rounded-lg border p-1.5 shadow-2xl">
          <div className="text-ink-600 px-1.5 pb-1 text-[10.5px] uppercase tracking-[0.08em]">
            Panes
          </div>
          {PANE_IDS.map((pane) => {
            const at = slotOf(layout.panes, pane);
            return (
              <div key={pane} className="flex items-center gap-1 py-[3px]">
                <span className="text-ink-300 min-w-0 flex-1 truncate px-1.5 text-[12px]">
                  {PANE_LABEL[pane]}
                </span>
                {PANE_SLOTS[pane].map((slot) => (
                  <button
                    key={slot}
                    type="button"
                    title={`${PANE_LABEL[pane]} to ${SLOT_LABEL[slot].toLowerCase()}`}
                    onClick={() => move(pane, slot)}
                    className={clsx(
                      "rounded p-1 transition-colors",
                      at === slot
                        ? "bg-ink-700 text-ink-100"
                        : "text-ink-600 hover:bg-ink-800 hover:text-ink-200",
                    )}
                  >
                    <SlotIcon slot={slot} />
                  </button>
                ))}
                {/* Only offered where the pane can actually be closed; a pane
                    with no "closed" in its slots is one that is always open. */}
                <button
                  type="button"
                  title={`Hide ${PANE_LABEL[pane]}`}
                  onClick={() => move(pane, "hidden")}
                  className={clsx(
                    "rounded p-1 transition-colors",
                    at === "hidden"
                      ? "text-ink-700"
                      : "text-ink-700 hover:bg-ink-800 hover:text-bad",
                  )}
                >
                  {at === "hidden" ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <X className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            );
          })}
          <div className="border-ink-800 mt-1 border-t px-1.5 pb-0.5 pt-2 text-[11px] leading-[1.5] text-ink-600">
            The panel keeps a tab per pane in it. A pane lives in one place:
            moving it takes it out of wherever it was.
          </div>
        </div>
      ) : null}
    </div>
  );
}
