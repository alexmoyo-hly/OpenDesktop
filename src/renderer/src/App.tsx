import clsx from 'clsx'
import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { activeSession, useStore } from './state/store'
import { commandForEvent } from '@shared/commands'
import { Sidebar } from './components/Sidebar'
import { TopBar } from './components/TopBar'
import { RightDock } from './components/RightDock'
import { BottomPanel } from './components/BottomPanel'
import { PANE_FRAME } from './components/ui'
import { ChatView } from './components/ChatView'
import { SettingsPane } from './components/SettingsPane'
import { BoardView } from './components/BoardView'
import { FolderPicker } from './components/FolderPicker'

function Toasts(): ReactNode {
  const toasts = useStore((s) => s.toasts)
  const dismiss = useStore((s) => s.dismissToast)
  if (toasts.length === 0) return null
  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={clsx(
            'pointer-events-auto flex max-w-lg items-start gap-2 rounded-lg border px-3 py-2 text-[12px] shadow-2xl',
            toast.level === 'error'
              ? 'border-bad/50 bg-ink-850 text-bad'
              : toast.level === 'warn'
                ? 'border-warn/50 bg-ink-850 text-warn'
                : 'border-ink-700 bg-ink-850 text-ink-200'
          )}
        >
          <span className="whitespace-pre-wrap">{toast.message}</span>
          <button type="button" onClick={() => dismiss(toast.id)} className="ml-auto shrink-0">
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  )
}

/** Settings is a sheet over the workspace rather than a pane, so the chat stays put. */
function SettingsOverlay(): ReactNode {
  const open = useStore((s) => s.settingsOpen)
  const setOpen = useStore((s) => s.setSettingsOpen)

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-8">
      {/* No title bar: the sidebar says where you are, so the only chrome is a
          way out, floated over the content rather than replacing it. */}
      <div className="border-ink-700 bg-ink-900 relative flex h-full max-h-[880px] w-full max-w-[1040px] flex-col overflow-hidden rounded-xl border shadow-2xl">
        <button
          type="button"
          title="Close"
          onClick={() => setOpen(false)}
          className="text-ink-500 hover:bg-ink-800 hover:text-ink-100 absolute right-3 top-3 z-10 rounded-md p-1.5"
        >
          <X className="h-4 w-4" />
        </button>
        <SettingsPane />
      </div>
    </div>
  )
}

export default function App(): ReactNode {
  const ready = useStore((s) => s.ready)
  const view = useStore((s) => s.view)
  const session = useStore(activeSession)
  const bootstrap = useStore((s) => s.bootstrap)
  const applyEvent = useStore((s) => s.applyEvent)

  useEffect(() => {
    const unsubscribe = window.opendesktop.onEvent(applyEvent)
    void bootstrap()
    return unsubscribe
  }, [applyEvent, bootstrap])

  /*
   * One handler, driven by the command table rather than by keys written here.
   *
   * Every binding lives in `@shared/commands` and config may override any of
   * them; this resolves a keystroke to a command and runs it. That is what
   * makes the settings page authoritative — a shortcut added there works in
   * the window without anything here changing — and it is why ⌘R could move
   * from search to the recent list without touching this file.
   *
   * Not while a bubble-phase listener elsewhere already claimed the key: the
   * composer, the editor and the picker each stop propagation for what they
   * own, and those decisions were made closer to the thing being typed into.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return
      const command = commandForEvent(useStore.getState().config?.keymap, event)
      if (!command) return

      const state = useStore.getState()
      const session = state.sessions.find((s) => s.id === state.activeSessionId)

      // The folder picker and settings belong to a conversation; on the board
      // there is nothing to point at.
      const needsChat = command.startsWith('folder.')
      if (needsChat && (state.view === 'board' || !session)) return

      event.preventDefault()
      switch (command) {
        case 'sidebar.toggle':
          state.toggleSidebar()
          return
        case 'panel.toggle':
          state.togglePanel()
          return
        case 'panel.grow': {
          // Open it tall rather than merely showing it: the reason to want a
          // key for this is reading something long.
          if (!state.layout.panelOpen) state.togglePanel()
          state.setPanelHeight(520)
          return
        }
        case 'panel.terminal':
          state.openPaneInWorkbench('terminal')
          return
        case 'panel.activity':
          state.openPaneInWorkbench('activity')
          return
        case 'panel.background':
          state.openPaneInWorkbench('background')
          return
        case 'panel.tasks':
          state.openPaneInWorkbench('tasks')
          return
        case 'folder.browse':
          if (!state.folderPicker) state.openFolderPicker(session!.id, 'browse')
          return
        case 'folder.recent':
          if (!state.folderPicker) state.openFolderPicker(session!.id, 'recent')
          return
        case 'folder.search':
          if (!state.folderPicker) state.openFolderPicker(session!.id, 'search')
          return
        case 'search.sessions':
          state.toggleSearch()
          return
        case 'session.new':
          void state.newSession({
            cwd: session?.cwd,
            environmentId: session?.environmentId,
            agentId: session?.agentId,
            model: session?.model,
          })
          return
        case 'settings.open':
          state.setSettingsOpen(true)
          return
        case 'editor.save':
          // Belongs to the textarea that has focus, which handles it and
          // prevents it; reaching here means no editor was open.
          return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!ready) {
    return (
      <div className="text-ink-500 flex h-full items-center justify-center text-[13px]">
        Starting OpenDesktop…
      </div>
    )
  }

  return (
    <div className="bg-ink-900 flex h-full flex-col">
      {/* One row across the window, owning the traffic-light gutter, so the
          controls beside them never move and never get overlapped. */}
      <TopBar />

      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <div className={clsx(PANE_FRAME, 'bg-ink-950 flex min-w-0 flex-1 flex-col')}>
          {view === 'board' ? (
            <BoardView />
          ) : session ? (
            <ChatView session={session} />
          ) : (
            <div className="text-ink-500 flex flex-1 items-center justify-center text-[13px]">
              Create a session to begin.
            </div>
          )}
        </div>
        {view === 'board' ? null : <RightDock />}
      </div>

      {/*
        Below the whole row rather than inside the chat column: the panel is
        about the window, and a terminal squeezed under one pane would move
        every time the dock opened. The board owns the full window, so it has
        none.
      */}
      {view === 'board' ? null : <BottomPanel />}

      <SettingsOverlay />
      <FolderPicker />
      <Toasts />
    </div>
  )
}
