/**
 * The folders a conversation has been pointed at, most recent first.
 *
 * Kept per environment, because the list is full of paths that only mean
 * something there: `/home/me/w` on a workstation and `/home/me/w` on this
 * machine are two different folders, and offering the wrong one is a folder
 * that does not exist. The picker shows the list for the environment the
 * conversation runs in, and never mixes them.
 *
 * Pure, so the trimming rules are tested without a filesystem.
 */

export interface RecentFolders {
  /** Keyed by environment id. */
  [environmentId: string]: string[];
}

/**
 * How many are kept per environment.
 *
 * The list exists to be scanned, not scrolled: past a dozen entries the search
 * half of the picker is the faster way, and a list nobody can scan is one that
 * gets scrolled past rather than read.
 */
export const RECENT_LIMIT = 12;

/** Trailing slashes are the same folder; a root is not the empty string. */
function clean(path: string): string {
  if (path.length > 1) return path.replace(/\/+$/, "");
  return path;
}

/**
 * The list with one folder on the front.
 *
 * Moving rather than adding: choosing a folder that is already in the list
 * promotes it, not duplicates it — otherwise the newest ten entries are one
 * folder used ten times.
 */
export function rememberFolder(
  recent: RecentFolders | undefined,
  environmentId: string,
  path: string,
): RecentFolders {
  const next = clean(path);
  if (!next) return { ...(recent ?? {}) };
  const existing = recent?.[environmentId] ?? [];
  return {
    ...(recent ?? {}),
    [environmentId]: [
      next,
      ...existing.filter((entry) => entry !== next),
    ].slice(0, RECENT_LIMIT),
  };
}

/** The list with one folder gone. Only that environment's, and only once. */
export function forgetFolder(
  recent: RecentFolders | undefined,
  environmentId: string,
  path: string,
): RecentFolders {
  const next = clean(path);
  const existing = recent?.[environmentId] ?? [];
  return {
    ...(recent ?? {}),
    [environmentId]: existing.filter((entry) => entry !== next),
  };
}

/** The list for one environment, as it should be shown: newest first. */
export function recentFor(
  recent: RecentFolders | undefined,
  environmentId: string,
): string[] {
  return [...(recent?.[environmentId] ?? [])];
}

/**
 * What to show, given a filter.
 *
 * The same box the search half uses, so a recent list behaves like a tree.
 * Substring rather than fuzzy: these are paths somebody already chose, and
 * typing `dev` should not reorder them by how good a match it thinks it is.
 */
export function filterRecent(list: string[], query: string): string[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return list;
  return list.filter((path) => path.toLowerCase().includes(needle));
}

/** The last segment, for a list where the rest of the path is the context. */
export function folderLabel(path: string): string {
  const parts = clean(path).split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/** The parent, for the line under it. */
export function parentOf(path: string): string {
  const cleaned = clean(path);
  const at = cleaned.lastIndexOf("/");
  if (at <= 0) return "/";
  return cleaned.slice(0, at);
}
