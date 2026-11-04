import { describe, expect, test } from "vitest";
import {
  RECENT_LIMIT,
  filterRecent,
  folderLabel,
  forgetFolder,
  parentOf,
  recentFor,
  rememberFolder,
} from "@shared/recent";

describe("remembering a folder", () => {
  test("the newest goes on the front", () => {
    const recent = rememberFolder({}, "local", "/a");
    expect(recentFor(rememberFolder(recent, "local", "/b"), "local")).toEqual([
      "/b",
      "/a",
    ]);
  });

  test("choosing one already there promotes it rather than duplicating it", () => {
    // Otherwise the newest ten entries are one folder used ten times.
    const recent = { local: ["/a", "/b", "/c"] };
    expect(recentFor(rememberFolder(recent, "local", "/c"), "local")).toEqual([
      "/c",
      "/a",
      "/b",
    ]);
  });

  test("a trailing slash is the same folder", () => {
    const recent = { local: ["/work"] };
    expect(
      recentFor(rememberFolder(recent, "local", "/work/"), "local"),
    ).toEqual(["/work"]);
  });

  test("environments do not see each other's folders", () => {
    // The same path is two different folders on two machines.
    const both = rememberFolder(rememberFolder({}, "local", "/w"), "ssh", "/w");
    expect(recentFor(both, "local")).toEqual(["/w"]);
    expect(recentFor(both, "ssh")).toEqual(["/w"]);
    expect(recentFor(forgetFolder(both, "local", "/w"), "ssh")).toEqual(["/w"]);
  });

  test("the list is capped, oldest falling off the end", () => {
    let recent = {};
    for (let index = 0; index < RECENT_LIMIT + 5; index++) {
      recent = rememberFolder(recent, "local", `/f${index}`);
    }
    const list = recentFor(recent, "local");
    expect(list).toHaveLength(RECENT_LIMIT);
    expect(list[0]).toBe(`/f${RECENT_LIMIT + 4}`);
    expect(list).not.toContain("/f0");
  });

  test("an empty path is not a folder", () => {
    expect(recentFor(rememberFolder({}, "local", ""), "local")).toEqual([]);
  });
});

describe("forgetting a folder", () => {
  test("it goes, and the rest keep their order", () => {
    const recent = { local: ["/a", "/b", "/c"] };
    expect(recentFor(forgetFolder(recent, "local", "/b"), "local")).toEqual([
      "/a",
      "/c",
    ]);
  });

  test("forgetting one that is not there changes nothing", () => {
    const recent = { local: ["/a"] };
    expect(recentFor(forgetFolder(recent, "local", "/nope"), "local")).toEqual([
      "/a",
    ]);
  });
});

describe("showing the list", () => {
  test("an empty filter shows everything", () => {
    expect(filterRecent(["/a", "/b"], "  ")).toHaveLength(2);
  });

  test("the filter is a substring, and case does not matter", () => {
    // Substring rather than fuzzy: these are paths somebody already chose,
    // and typing "dev" must not reorder them by match quality.
    expect(filterRecent(["/Dev/a", "/src/b"], "dev")).toEqual(["/Dev/a"]);
  });

  test("the label is the last segment, the parent is the rest", () => {
    expect(folderLabel("/Users/x/Dev/app")).toBe("app");
    expect(parentOf("/Users/x/Dev/app")).toBe("/Users/x/Dev");
    expect(parentOf("/app")).toBe("/");
  });
});
