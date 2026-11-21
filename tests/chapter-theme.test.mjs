import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { runInNewContext } from "node:vm";
import { chapterThemeInitialization, mountChapterTheme } from "../src/lib/chapter-theme.ts";

const previousWindow = globalThis.window;
const previousDocument = globalThis.document;
afterEach(() => {
  if (previousWindow === undefined) delete globalThis.window;
  else globalThis.window = previousWindow;
  if (previousDocument === undefined) delete globalThis.document;
  else globalThis.document = previousDocument;
});

function setup(saved = null, dark = false, blocked = false) {
  const changes = [];
  const listeners = new Set();
  const preference = {
    matches: dark,
    addEventListener: (_, listener) => listeners.add(listener),
    removeEventListener: (_, listener) => listeners.delete(listener),
  };
  const storage = new Map(saved ? [["chapter-theme", saved]] : []);
  globalThis.document = { documentElement: { dataset: {} } };
  globalThis.window = {
    matchMedia: () => preference,
    localStorage: {
      getItem: (key) => {
        if (blocked) throw new Error("Blocked");
        return storage.get(key) ?? null;
      },
      setItem: (key, value) => {
        if (blocked) throw new Error("Blocked");
        storage.set(key, value);
      },
    },
  };
  const controller = mountChapterTheme((theme) => changes.push(theme));
  return { controller, preference, listeners, changes, storage };
}

test("follows system preference until an explicit choice is made", () => {
  const state = setup(null, true);
  assert.equal(document.documentElement.dataset.chapterTheme, "dark");
  state.preference.matches = false;
  for (const listener of state.listeners) listener();
  assert.equal(state.changes.at(-1), "light");
  state.controller.toggle();
  assert.equal(state.storage.get("chapter-theme"), "dark");
  for (const listener of state.listeners) listener();
  assert.equal(state.changes.at(-1), "dark");
  state.controller.dispose();
  assert.equal(state.listeners.size, 0);
  assert.equal(document.documentElement.dataset.chapterTheme, undefined);
});

test("saved theme survives remount and overrides system preference", () => {
  const state = setup("light", true);
  assert.equal(state.changes.at(-1), "light");
  state.controller.toggle();
  state.controller.dispose();
  const reloaded = mountChapterTheme((theme) => state.changes.push(theme));
  assert.equal(state.changes.at(-1), "dark");
  reloaded.dispose();
});

test("invalid saved values follow the system and blocked storage remains usable", () => {
  const invalid = setup("invalid", true);
  assert.equal(invalid.changes.at(-1), "dark");
  invalid.controller.dispose();
  const blocked = setup(null, false, true);
  assert.doesNotThrow(() => blocked.controller.toggle());
  assert.equal(blocked.changes.at(-1), "dark");
  blocked.controller.dispose();
});

test("pre-paint bootstrap resolves saved, system, and blocked-storage preferences", () => {
  for (const [saved, systemDark, expected] of [
    ["dark", false, "dark"],
    ["light", true, "light"],
    [null, true, "dark"],
    ["blocked", false, "light"],
  ]) {
    const root = { dataset: {} };
    runInNewContext(chapterThemeInitialization, {
      document: { documentElement: root },
      localStorage: {
        getItem: () => {
          if (saved === "blocked") throw new Error("Blocked");
          return saved;
        },
      },
      matchMedia: () => ({ matches: systemDark }),
    });
    assert.equal(root.dataset.chapterTheme, expected);
  }
});
