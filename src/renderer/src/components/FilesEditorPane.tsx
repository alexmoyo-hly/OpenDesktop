import clsx from "clsx";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Files,
  Maximize2,
  Minimize2,
  PanelLeft,
  PanelRight,
} from "lucide-react";
import { useStore } from "../state/store";
import { EditorPane } from "./EditorPane";
import { FilesPane } from "./FilesPane";
import { FILES_MAX_WIDTH, FILES_MIN_WIDTH, FILES_WIDTH } from "@shared/layout";

/**
 * Files and the editor as one element.
 *
 * They were two dock tabs, which meant the tree and the file you opened from
 * it could never be looked at together: opening a file closed the tree, and
 * going back to the tree hid the file. But they are one job — the tree is for
 * finding, the editor is for changing — so they share a pane, a header and a
 * lifetime, the way they do in VS Code.
 *
 * The tree can be on either side, because which one is "nearer the chat" is a
 * real preference and cost one field in the layout to offer.
 */
export function FilesEditorPane(): ReactNode {
  const filesSide = useStore((s) => s.layout.filesSide);
  const setFilesSide = useStore((s) => s.setFilesSide);
  const open = useStore((s) => s.editorFile);

  const [treeOpen, setTreeOpen] = useState(true);
  const [width, setWidth] = useState(FILES_WIDTH);
  const dragging = useRef<{
    startX: number;
    startWidth: number;
    side: "left" | "right";
  } | null>(null);

  const onMove = useCallback((event: MouseEvent) => {
    const drag = dragging.current;
    if (!drag) return;
    const delta =
      drag.side === "left"
        ? event.clientX - drag.startX
        : drag.startX - event.clientX;
    setWidth(
      Math.min(
        FILES_MAX_WIDTH,
        Math.max(FILES_MIN_WIDTH, drag.startWidth + delta),
      ),
    );
  }, []);

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

  // Nothing open yet: the tree is the whole pane, because there is nothing to
  // put beside it and an empty editor is a worse answer than more tree.
  const showTree = treeOpen;
  const showEditor = open !== null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-ink-800 bg-ink-900 flex h-9 shrink-0 items-center gap-1 border-b px-2">
        <button
          type="button"
          title={treeOpen ? "Hide the file tree" : "Show the file tree"}
          onClick={() => setTreeOpen(!treeOpen)}
          className={clsx(
            "rounded p-1 transition-colors",
            treeOpen
              ? "bg-ink-800 text-ink-100"
              : "text-ink-500 hover:bg-ink-800 hover:text-ink-200",
          )}
        >
          <Files className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          title={
            filesSide === "left"
              ? "Put the tree on the right"
              : "Put the tree on the left"
          }
          onClick={() => setFilesSide(filesSide === "left" ? "right" : "left")}
          className="text-ink-500 hover:bg-ink-800 hover:text-ink-200 rounded p-1"
        >
          {filesSide === "left" ? (
            <PanelLeft className="h-3.5 w-3.5" />
          ) : (
            <PanelRight className="h-3.5 w-3.5" />
          )}
        </button>
        <button
          type="button"
          title={width > FILES_WIDTH ? "Narrow the tree" : "Widen the tree"}
          onClick={() => setWidth(width > FILES_WIDTH ? FILES_WIDTH : 360)}
          disabled={!showTree}
          className="text-ink-500 hover:bg-ink-800 hover:text-ink-200 rounded p-1 disabled:opacity-30"
        >
          {width > FILES_WIDTH ? (
            <Minimize2 className="h-3.5 w-3.5" />
          ) : (
            <Maximize2 className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        {/*
         * Mounted whether it is shown or not, and merely hidden: the pane
         * keeps its scrolled folder and its loaded listing, which is what
         * makes folding it away and back cheap.
         */}
        <div
          className={clsx(
            "min-h-0 shrink-0 flex-col",
            showTree ? "flex" : "hidden",
          )}
          style={{ width, order: filesSide === "left" ? 0 : 2 }}
        >
          <FilesPane />
        </div>
        {showTree && showEditor ? (
          <div
            onMouseDown={(event) => {
              event.preventDefault();
              dragging.current = {
                startX: event.clientX,
                startWidth: width,
                side: filesSide,
              };
              document.body.style.cursor = "col-resize";
            }}
            className="hover:bg-brand/40 w-1 shrink-0 cursor-col-resize bg-transparent"
            style={{ order: 1 }}
          />
        ) : null}
        <div
          className={clsx(
            "min-h-0 flex-1 flex-col",
            showEditor ? "flex" : "hidden",
          )}
          style={{ order: filesSide === "left" ? 2 : 0 }}
        >
          <EditorPane />
        </div>
        {!showEditor && !showTree ? (
          <div className="text-ink-600 flex flex-1 items-center justify-center text-[12px]">
            Nothing open.
          </div>
        ) : null}
      </div>
    </div>
  );
}
