import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  animateChapterScroll,
  cancelChapterScroll,
  navigateChapterSection,
} from "../src/lib/chapter-motion.ts";

const originalWindow = globalThis.window;
const originalDocument = globalThis.document;
afterEach(() => {
  cancelChapterScroll();
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
  if (originalDocument === undefined) delete globalThis.document;
  else globalThis.document = originalDocument;
});

function setup(reduced = false) {
  let nextFrame = 0;
  const frames = new Map();
  const listeners = new Map();
  const positions = [];
  const preference = { matches: reduced };
  const section = {
    isConnected: true,
    getBoundingClientRect: () => ({ top: 2024 - window.scrollY }),
    focus(options) {
      this.focusOptions = options;
    },
  };
  globalThis.document = {
    documentElement: { scrollHeight: 5000 },
    getElementById: () => section,
  };
  globalThis.window = {
    matchMedia: () => preference,
    scrollY: 0,
    innerHeight: 800,
    getComputedStyle: () => ({ scrollMarginTop: "24px" }),
    requestAnimationFrame(callback) {
      frames.set(++nextFrame, callback);
      return nextFrame;
    },
    cancelAnimationFrame: (id) => frames.delete(id),
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: (name) => listeners.delete(name),
    scrollTo(options) {
      assert.equal(options.behavior, "instant");
      this.scrollY = options.top;
      positions.push(options.top);
    },
  };
  return {
    section,
    preference,
    frames,
    listeners,
    positions,
    tick(time) {
      const callbacks = [...frames.values()];
      frames.clear();
      for (const callback of callbacks) callback(time);
    },
  };
}

test("frame scrolling has intermediate positions and ends at the section margin", () => {
  const state = setup();
  animateChapterScroll(state.section);
  state.tick(0);
  state.tick(325);
  assert.ok(window.scrollY > 0 && window.scrollY < 2000);
  state.tick(650);
  assert.equal(window.scrollY, 2000);
  assert.equal(state.listeners.size, 0);
  assert.equal(state.frames.size, 0);
});

test("manual input, replacement scroll and explicit cleanup cancel pending frames", () => {
  for (const input of ["wheel", "touchstart", "pointerdown", "keydown"]) {
    const state = setup();
    animateChapterScroll(state.section);
    state.listeners.get(input)({ key: "Escape" });
    assert.equal(state.frames.size, 0);
    assert.equal(state.listeners.size, 0);
  }
  const state = setup();
  animateChapterScroll(state.section);
  animateChapterScroll(state.section);
  assert.equal(state.frames.size, 1);
  cancelChapterScroll();
  assert.equal(state.frames.size, 0);
});

test("router owns hashes while explicit motion uses frame scrolling after navigation", async () => {
  for (const reduced of [false, true]) {
    const state = setup(reduced);
    const calls = [];
    await navigateChapterSection("join", async (options) => calls.push(options));
    assert.deepEqual(calls, [
      {
        hash: "join",
        resetScroll: false,
        hashScrollIntoView: false,
      },
    ]);
    state.tick(0);
    assert.deepEqual(state.section.focusOptions, { preventScroll: true });
    assert.equal(state.section.tabIndex, -1);
    assert.equal(state.frames.size, 1);
    cancelChapterScroll();
  }
});

test("rapid link clicks ignore stale navigation callbacks", async () => {
  const state = setup();
  await navigateChapterSection("events", async () => {});
  await navigateChapterSection("join", async () => {});
  state.tick(0);
  assert.equal(state.frames.size, 1);
});

test("enabling system Reduce Motion during navigation still animates to the section", async () => {
  const state = setup();
  await navigateChapterSection("join", async () => {
    state.preference.matches = true;
  });
  state.tick(0);
  assert.equal(state.frames.size, 1);
  state.tick(16);
  state.tick(341);
  assert.ok(window.scrollY > 0 && window.scrollY < 2000);
  state.tick(666);
  assert.equal(window.scrollY, 2000);
  assert.equal(state.frames.size, 0);
});

test("enabling system Reduce Motion during a scroll preserves intermediate frames", () => {
  const state = setup();
  animateChapterScroll(state.section);
  state.tick(0);
  state.preference.matches = true;
  state.tick(325);
  assert.ok(window.scrollY > 0 && window.scrollY < 2000);
  state.tick(650);
  assert.equal(window.scrollY, 2000);
  assert.equal(state.frames.size, 0);
});
