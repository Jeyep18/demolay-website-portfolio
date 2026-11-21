import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { observeChapterReveals, navigateChapterSection } from "../src/lib/chapter-motion.ts";

const previousWindow = globalThis.window;
test("individual content reveals include dynamically mounted reports and clean up observers", () => {
  let mutate;
  let disconnected = false;
  const observed = new Set();
  const makeElement = () => ({
    parentElement: null,
    setAttribute() {},
    removeAttribute() {},
    getBoundingClientRect: () => ({ top: 1200 }),
  });
  const elements = [makeElement()];
  globalThis.window = {
    innerHeight: 900,
    IntersectionObserver: class {
      observe(element) {
        observed.add(element);
      }
      disconnect() {
        observed.clear();
      }
    },
    MutationObserver: class {
      constructor(callback) {
        mutate = callback;
      }
      observe() {}
      disconnect() {
        disconnected = true;
      }
    },
  };
  const page = {
    querySelectorAll: (selector) => (selector.startsWith("main section") ? [] : elements),
    addEventListener() {},
    removeEventListener() {},
  };
  const stop = observeChapterReveals(page, true);
  assert.equal(observed.size, 1);
  elements.push(makeElement());
  mutate();
  assert.equal(observed.size, 2);
  mutate();
  assert.equal(observed.size, 2);
  stop();
  assert.equal(disconnected, true);
  assert.equal(observed.size, 0);
});
afterEach(() => {
  if (previousWindow === undefined) delete globalThis.window;
  else globalThis.window = previousWindow;
});

function setup(reduced = false) {
  const listeners = new Set();
  const preference = {
    matches: reduced,
    addEventListener: (_, listener) => listeners.add(listener),
    removeEventListener: (_, listener) => listeners.delete(listener),
  };
  let observer;
  const animations = [];
  const attributes = new Set();
  const focusListeners = new Set();
  const element = {
    parentElement: null,
    getBoundingClientRect: () => ({ top: 1000 }),
    setAttribute: (name) => attributes.add(name),
    removeAttribute: (name) => attributes.delete(name),
    contains: (target) => target === element,
    animate: () => {
      const animation = {
        cancelled: false,
        finished: new Promise(() => {}),
        cancel() {
          this.cancelled = true;
        },
      };
      animations.push(animation);
      return animation;
    },
  };
  class Observer {
    observed = new Set();
    constructor(callback) {
      this.callback = callback;
      observer = this;
    }
    observe(target) {
      this.observed.add(target);
    }
    unobserve(target) {
      this.observed.delete(target);
    }
    disconnect() {
      this.observed.clear();
    }
    enter() {
      this.callback([...this.observed].map((target) => ({ target, isIntersecting: true })));
    }
  }
  globalThis.window = {
    innerHeight: 800,
    matchMedia: () => preference,
    IntersectionObserver: Observer,
  };
  const cleanup = observeChapterReveals({
    querySelectorAll: () => [element],
    addEventListener: (_, listener) => focusListeners.add(listener),
    removeEventListener: (_, listener) => focusListeners.delete(listener),
  });
  return {
    cleanup,
    preference,
    listeners,
    get observer() {
      return observer;
    },
    animations,
    attributes,
    element,
    focusListeners,
  };
}

test("content reveals while the system requests reduced motion", () => {
  const state = setup(true);
  assert.ok(state.attributes.has("data-reveal-pending"));
  state.observer.enter();
  assert.equal(state.animations.length, 1);
  assert.equal(state.listeners.size, 0);
  state.cleanup();
  assert.equal(state.listeners.size, 0);
});

test("each section reveals only once, and cleanup cancels active animation", () => {
  const state = setup();
  state.observer.enter();
  state.observer.enter();
  assert.equal(state.animations.length, 1);
  assert.equal(state.observer.observed.size, 0);
  state.cleanup();
  assert.equal(state.animations[0].cancelled, true);
  assert.equal(state.listeners.size, 0);
});

test("switching to reduced motion leaves active reveals running", () => {
  const state = setup();
  state.observer.enter();
  state.preference.matches = true;
  for (const listener of state.listeners) listener();
  assert.equal(state.animations[0].cancelled, false);
  assert.equal(state.observer.observed.size, 0);
  state.cleanup();
});

test("missing IntersectionObserver leaves the readable fallback in place", () => {
  globalThis.window = {};
  assert.doesNotThrow(() => observeChapterReveals({})());
});

test("offscreen content is prepared, then restored on cleanup", () => {
  const state = setup();
  assert.ok(state.attributes.has("data-reveal-pending"));
  state.cleanup();
  assert.equal(state.attributes.size, 0);
  assert.equal(state.focusListeners.size, 0);
});

test("keyboard focus reveals its target without disabling later scroll reveals", () => {
  const state = setup();
  for (const listener of state.focusListeners) listener({ target: state.element });
  assert.equal(state.attributes.size, 0);
  assert.equal(state.observer.observed.size, 0);
  state.cleanup();
});
