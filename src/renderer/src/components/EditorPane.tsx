import clsx from "clsx";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { RotateCw, Save, X } from "lucide-react";
import { highlight, type Span, type TokenKind } from "@shared/highlight";
import { useStore } from "../state/store";
import { Button } from "./ui";

/**
 * A code editor, in this app's own clothes.
 *
 * Not Monaco. Monaco is VS Code's editor and it is five megabytes, a worker
 * pipeline and a theme to fight — for a pane whose job is "open the file the
 * agent just changed and fix a line". What is actually wanted from VS Code
 * here is the *look*: numbered lines, syntax colour, a monospace grid that
 * matches the transcript. That is a transparent textarea over a highlighted
 * copy of the same text, which is the oldest trick there is and the only one
 * that cannot drift from the app's own palette, because it uses it.
 *
 * What it does not have: completion, folding, multiple cursors, a language
 * server. If those are ever wanted, that is the day to take the five
 * megabytes — and not before, because this pane already does the thing it was
 * opened for.
 */
const COLOUR: Record<TokenKind, string> = {
  plain: "text-ink-200",
  keyword: "text-violet",
  string: "text-ok",
  comment: "text-ink-600 italic",
  number: "text-warn",
  call: "text-info",
};

/** The grid both layers share. A pixel of drift here doubles every character. */
const GRID = "font-mono text-[12.5px] leading-[19px]";

/**
 * The gutter never narrows below this, whatever the file has in it.
 *
 * It used to be sized by the digit count of the last line, so a file grew a
 * wider column the moment it reached ten lines and the text jumped sideways
 * under the cursor. Three characters holds a thousand lines, which is as far as
 * anybody reads in a pane this size, and past that the column widens once more
 * rather than clipping the number.
 */
const GUTTER_DIGITS = 3;

function languageOf(path: string): string {
  const name = path.split("/").pop() ?? path;
  const ext = name.includes(".") ? (name.split(".").pop() ?? "") : "";
  if (ext === "tsx" || ext === "ts") return "ts";
  if (ext === "jsx" || ext === "js" || ext === "mjs" || ext === "cjs")
    return "js";
  if (ext === "sh" || ext === "bash" || ext === "zsh") return "bash";
  if (ext === "py") return "python";
  if (ext === "tf" || ext === "hcl") return "hcl";
  if (ext === "json") return "json";
  if (ext === "yml" || ext === "yaml") return "yaml";
  if (ext === "md" || ext === "markdown") return "md";
  return ext;
}

/**
 * The coloured text, cut at the newlines.
 *
 * Cut *after* highlighting and not per line: a string or a block comment that
 * spans three lines is one token, and highlighting each line on its own would
 * lose that and paint the middle of a doc comment as code.
 *
 * Per line rather than one big run of spans because the number has to sit
 * beside the line it belongs to. A single stack of numbers down the left is
 * correct only while every logical line is one visual line — the moment one
 * wraps, it is off by one for everything below, which is what it was.
 */
function pages(text: string, language: string): Span[][] {
  const rows: Span[][] = [[]];
  for (const span of highlight(text, language)) {
    const pieces = span.text.split("\n");
    pieces.forEach((piece, index) => {
      if (index > 0) rows.push([]);
      if (piece) rows[rows.length - 1].push({ text: piece, kind: span.kind });
    });
  }
  return rows;
}

export function EditorPane(): ReactNode {
  const session = useStore((s) =>
    s.sessions.find((x) => x.id === s.activeSessionId),
  );
  const open = useStore((s) => s.editorFile);
  const setOpen = useStore((s) => s.openInEditor);

  const [text, setText] = useState("");
  const [original, setOriginal] = useState("");
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const area = useRef<HTMLTextAreaElement | null>(null);

  const path = open?.path ?? "";
  const environmentId =
    open?.environmentId ?? session?.environmentId ?? "local";
  const sessionId = open?.sessionId ?? session?.id;

  useEffect(() => {
    if (!path) {
      setText("");
      setOriginal("");
      return;
    }
    let alive = true;
    setLoading(true);
    setFailure(null);
    void window.opendesktop.files
      .open(environmentId, path, sessionId)
      .then((result) => {
        if (!alive) return;
        if (result.error) setFailure(result.error);
        setText(result.text);
        setOriginal(result.text);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [path, environmentId, sessionId]);

  const dirty = text !== original;
  const rows = useMemo(() => pages(text, languageOf(path)), [text, path]);
  const gutter = `calc(${Math.max(GUTTER_DIGITS, String(rows.length).length)}ch + 12px)`;

  const save = async (): Promise<void> => {
    if (!path || !dirty) return;
    const result = await window.opendesktop.files.save(
      environmentId,
      path,
      text,
      sessionId,
    );
    if (result.error) return setFailure(result.error);
    setOriginal(text);
    setFailure(null);
    setSaved(true);
    setTimeout(() => setSaved(false), 1200);
  };

  if (!path) {
    return (
      <div className="text-ink-600 flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-[12px]">
        <span className="text-ink-300 text-[14px]">Nothing open.</span>
        <span>
          Open a file from the Files pane, or the pencil on a card in the
          conversation.
        </span>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        data-editor-head
        className="border-ink-800 bg-ink-900 flex h-8 shrink-0 items-center gap-1.5 border-b px-3"
      >
        <span className="text-ink-600 min-w-0 flex-1 truncate font-mono text-[11px]">
          {path}
        </span>
        <span className="text-ink-700 shrink-0 text-[10.5px] tabular-nums">
          {rows.length} {rows.length === 1 ? "line" : "lines"}
        </span>
        {dirty ? (
          <span className="text-warn shrink-0 text-[11px]">unsaved</span>
        ) : null}
        {saved ? (
          <span className="text-ok shrink-0 text-[11px]">saved</span>
        ) : null}
        <Button
          size="sm"
          onClick={() => void save()}
          disabled={!dirty}
          title="Save (⌘S)"
        >
          <Save className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="sm"
          title="Reload from disk"
          onClick={() => setOpen(open ? { ...open } : null)}
          disabled={loading}
        >
          <RotateCw
            className={clsx("h-3.5 w-3.5", loading && "animate-spin")}
          />
        </Button>
        <Button size="sm" title="Close" onClick={() => setOpen(null)}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {failure ? (
        <div className="text-bad border-ink-800 border-b px-3 py-1.5 text-[11.5px]">
          {failure}
        </div>
      ) : null}

      <div className="relative min-h-0 flex-1 overflow-auto">
        <div className="relative min-h-full">
          {/*
           * Two layers on the same grid: the colours underneath, the real
           * textarea on top with transparent text and a visible caret. The
           * textarea is what has focus, selection and undo — none of which
           * is worth reimplementing — and the layer under it never has to
           * know anything about editing.
           *
           * The number lives inside the row of the line it numbers, and the
           * textarea is inset by exactly that column's width. So a line that
           * wraps pushes the numbers below it down with it, instead of
           * leaving them counting visual lines they cannot see.
           */}
          <pre
            aria-hidden
            className={clsx("m-0 whitespace-pre-wrap break-words py-2", GRID)}
          >
            {rows.map((spans, index) => (
              <div key={index} className="flex">
                <span
                  className="text-ink-600 shrink-0 select-none pr-3 text-right tabular-nums"
                  style={{ width: gutter }}
                >
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">
                  {spans.map((span, at) => (
                    <span key={at} className={COLOUR[span.kind]}>
                      {span.text}
                    </span>
                  ))}
                  {/* An empty line has no row height of its own without this. */}
                  {"\u200b"}
                </span>
              </div>
            ))}
          </pre>
          <textarea
            ref={area}
            value={text}
            spellCheck={false}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "s") {
                event.preventDefault();
                void save();
                return;
              }
              if (event.key === "Tab") {
                // A tab in a code editor indents; it does not leave.
                event.preventDefault();
                const target = event.currentTarget;
                const at = target.selectionStart;
                const next = `${text.slice(0, at)}  ${text.slice(target.selectionEnd)}`;
                setText(next);
                requestAnimationFrame(() =>
                  target.setSelectionRange(at + 2, at + 2),
                );
              }
            }}
            style={{ paddingLeft: gutter, paddingRight: 0 }}
            className={clsx(
              "absolute inset-0 resize-none overflow-hidden whitespace-pre-wrap break-words bg-transparent py-2 text-transparent caret-ink-100 outline-none",
              GRID,
            )}
          />
        </div>
      </div>
    </div>
  );
}
