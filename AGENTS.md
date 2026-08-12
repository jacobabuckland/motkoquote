<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Testing conventions

## DOM test environment

The global vitest config defaults to `environment: "node"` for performance and compatibility with the existing test suite. Tests that need DOM access (rendering components, firing user interactions, testing browser APIs) opt in **per-file** via a directive at the top of the test file:

```tsx
/**
 * @vitest-environment happy-dom
 */

import { describe, it, expect } from "vitest";
// ... your test code
```

The `happy-dom` library provides a fast, lightweight DOM implementation for testing. Do **not** migrate existing node-environment tests to DOM unless they actually need it — DOM environments are slower and add unnecessary overhead for tests that don't interact with the DOM.

## Capacitor mocking

All Capacitor plugin mocking should use the shared helpers in `tests/helpers/capacitor.ts`. Do **not** write custom `vi.mock()` calls for Capacitor plugins in individual test files — this ensures consistency and prevents incompatible mocking approaches.

### Usage

```tsx
import { mockNativePlatform, mockCapacitorPlugins } from "../helpers/capacitor";

describe("My feature", () => {
  it("calls Haptics on native platform", () => {
    // Mock as native (pass true)
    mockNativePlatform(true);
    const mocks = mockCapacitorPlugins();

    // Your code that uses Capacitor plugins
    mocks.Haptics.impact({ style: "medium" });

    // Assert the plugin was called
    const calls = mocks.Haptics.getCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("impact");
    expect(calls[0].args[0]).toEqual({ style: "medium" });
  });

  it("skips native features on web platform", () => {
    // Default is web (pass false or omit the argument)
    mockNativePlatform(false);
    const mocks = mockCapacitorPlugins();

    // Your code that guards native features
    // if (Capacitor.isNativePlatform()) { ... }

    // Assert the plugin was never called
    expect(mocks.Haptics.getCalls()).toHaveLength(0);
  });
});
```

### Key points

- **Default is web platform** (`isNativePlatform()` returns `false`) so tests that don't explicitly opt into native mode behave exactly as they do today.
- Only the five installed plugins are mocked: `@capacitor/app`, `@capacitor/haptics`, `@capacitor/push-notifications`, `@capacitor/share`, `@capacitor/splash-screen`.
- Call records reset automatically between tests via `beforeEach` — one test's calls cannot satisfy another's assertions.
- Each plugin mock has a `getCalls()` method that returns an array of `{method: string, args: any[]}` objects for assertion.

## Acceptance tests must pass lint and typecheck

`tsc` and ESLint both cover `tests/`. A test file that fails either is not a
tidiness problem: acceptance tests are frozen once the PM commits them, so
nothing downstream is permitted to repair one, and the item blocks for good.
Run both against your test file before you finish:

```bash
npx eslint tests/acceptance/<issue>.test.tsx
npm run typecheck
```

Two rules bite constantly and are errors here, not warnings:

- **Never name a variable `module`.** `@next/next/no-assign-module-variable`
  rejects it, and `const module = await import("@/…")` is the phrasing that
  comes naturally when asserting a file exists. Use `mod` or `imported`:

  ```ts
  const mod = await import("@/app/q/[id]/loading");
  expect(mod.default).toBeDefined();
  ```

- **Never use `any`.** `@typescript-eslint/no-explicit-any` is an error. Reach
  for `unknown` and narrow, or write the shape out.

Mock signatures need declaring rather than inferring, too: `vi.fn(async () =>
null)` infers `Promise<null>`, so a later `mockResolvedValue({ … })` is a type
error, and a zero-argument mock makes `mock.calls[0][0]` unreachable.

## Rendering React components

A DOM environment on its own only gives you `document` — it does not let you
mount a component. Rendering a real component from `src/` uses
`@testing-library/react`, in a file that has opted into `happy-dom`:

```tsx
/**
 * @vitest-environment happy-dom
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Button } from "@/components/ui/button";

// Required. The vitest config does not set `globals: true`, so Testing
// Library's automatic cleanup never registers itself, and without this each
// test's markup stays in document.body for the next test's query to find.
afterEach(cleanup);

describe("Button", () => {
  it("fires its handler when clicked", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Send quote</Button>);

    fireEvent.click(screen.getByRole("button", { name: "Send quote" }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
```

Query by accessible role and name (`getByRole("button", { name: … })`) rather
than by class name or test id, so the assertion describes what a user can
perceive and does not break when styling changes.

### When to use which environment

- **Node environment** (default): Pure logic tests, utility functions, server-side code, API routes, anything that doesn't interact with the DOM or render components.
- **DOM environment** (opt-in via `@vitest-environment happy-dom`): Component rendering, user interaction simulation, browser API testing, anything that needs `document`, `window`, or DOM manipulation.

Worked examples: `tests/examples/component-render.test.tsx` renders a real
component and asserts an interaction; `tests/examples/dom-capacitor.test.tsx`
covers the DOM environment and the Capacitor native/web paths.
