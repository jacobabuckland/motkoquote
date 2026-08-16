/**
 * @vitest-environment happy-dom
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { mockNativePlatform, mockCapacitorPlugins } from "../helpers/capacitor";

afterEach(cleanup);

describe("Issue #96: Add haptics utility and wire it to resolved actions", () => {
  describe("src/lib/haptics.ts module", () => {
    it("exports the five required functions", async () => {
      const haptics = await import("@/lib/haptics");

      expect(haptics.tap).toBeDefined();
      expect(haptics.press).toBeDefined();
      expect(haptics.success).toBeDefined();
      expect(haptics.error).toBeDefined();
      expect(haptics.select).toBeDefined();
    });

    it("all functions are synchronous and return undefined", async () => {
      mockNativePlatform(false);
      const haptics = await import("@/lib/haptics");

      expect(haptics.tap()).toBeUndefined();
      expect(haptics.press()).toBeUndefined();
      expect(haptics.success()).toBeUndefined();
      expect(haptics.error()).toBeUndefined();
      expect(haptics.select()).toBeUndefined();
    });
  });

  describe("Web platform (isNativePlatform = false)", () => {
    beforeEach(() => {
      mockNativePlatform(false);
      vi.resetModules();
    });

    it("tap() is a no-op, does not call Capacitor", async () => {
      const mocks = mockCapacitorPlugins();
      const haptics = await import("@/lib/haptics");

      haptics.tap();

      expect(mocks.Haptics.getCalls()).toHaveLength(0);
    });

    it("success() is a no-op, does not call Capacitor", async () => {
      const mocks = mockCapacitorPlugins();
      const haptics = await import("@/lib/haptics");

      haptics.success();

      expect(mocks.Haptics.getCalls()).toHaveLength(0);
    });

    it("error() is a no-op, does not call Capacitor", async () => {
      const mocks = mockCapacitorPlugins();
      const haptics = await import("@/lib/haptics");

      haptics.error();

      expect(mocks.Haptics.getCalls()).toHaveLength(0);
    });

    it("select() is a no-op, does not call Capacitor", async () => {
      const mocks = mockCapacitorPlugins();
      const haptics = await import("@/lib/haptics");

      haptics.select();

      expect(mocks.Haptics.getCalls()).toHaveLength(0);
    });
  });

  describe("Native platform (isNativePlatform = true)", () => {
    beforeEach(() => {
      mockNativePlatform(true);
      vi.resetModules();
    });

    it("tap() calls Haptics.impact with light style", async () => {
      const mocks = mockCapacitorPlugins();
      const haptics = await import("@/lib/haptics");

      haptics.tap();

      const calls = mocks.Haptics.getCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0].method).toBe("impact");
      // Uppercase: @capacitor/haptics exports ImpactStyle.Light = "LIGHT".
      // The lowercase form asserted here made the test unsatisfiable — an
      // implementation correct on a device could never pass it.
      expect(calls[0].args[0]).toEqual({ style: "LIGHT" });
    });

    it("press() calls Haptics.impact with medium style", async () => {
      const mocks = mockCapacitorPlugins();
      const haptics = await import("@/lib/haptics");

      haptics.press();

      const calls = mocks.Haptics.getCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0].method).toBe("impact");
      expect(calls[0].args[0]).toEqual({ style: "MEDIUM" });
    });

    it("success() calls Haptics.notification with success type", async () => {
      const mocks = mockCapacitorPlugins();
      const haptics = await import("@/lib/haptics");

      haptics.success();

      const calls = mocks.Haptics.getCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0].method).toBe("notification");
      expect(calls[0].args[0]).toEqual({ type: "SUCCESS" });
    });

    it("error() calls Haptics.notification with error type", async () => {
      const mocks = mockCapacitorPlugins();
      const haptics = await import("@/lib/haptics");

      haptics.error();

      const calls = mocks.Haptics.getCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0].method).toBe("notification");
      expect(calls[0].args[0]).toEqual({ type: "ERROR" });
    });

    it("select() calls Haptics.selection", async () => {
      const mocks = mockCapacitorPlugins();
      const haptics = await import("@/lib/haptics");

      haptics.select();

      const calls = mocks.Haptics.getCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0].method).toBe("selectionChanged");
    });
  });

  describe("Error handling", () => {
    it("haptics failures do not throw into calling code", async () => {
      mockNativePlatform(true);
      vi.resetModules();

      // Mock Haptics to reject
      const mocks = mockCapacitorPlugins();
      vi.mocked(mocks.Haptics.impact).mockRejectedValueOnce(
        new Error("Haptics unavailable")
      );

      const haptics = await import("@/lib/haptics");

      // Should not throw
      expect(() => haptics.tap()).not.toThrow();
    });
  });

  describe("Button integration", () => {
    beforeEach(() => {
      mockNativePlatform(true);
      vi.resetModules();
    });

    it("primary button fires haptics.tap() on press", async () => {
      const mocks = mockCapacitorPlugins();
      const { Button } = await import("@/components/ui/button");
      const onClick = vi.fn();

      const { getByRole } = render(
        <Button variant="primary" onClick={onClick}>
          Send quote
        </Button>
      );

      fireEvent.click(getByRole("button", { name: "Send quote" }));

      // Should have called haptics
      const calls = mocks.Haptics.getCalls();
      expect(calls.length).toBeGreaterThanOrEqual(1);
      expect(calls.some((c) => c.method === "impact")).toBe(true);

      // Should also have called the user's onClick
      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it("secondary button does not fire haptics.tap()", async () => {
      const mocks = mockCapacitorPlugins();
      const { Button } = await import("@/components/ui/button");

      const { getByRole } = render(
        <Button variant="secondary">Cancel</Button>
      );

      fireEvent.click(getByRole("button", { name: "Cancel" }));

      // Should not have called haptics
      expect(mocks.Haptics.getCalls()).toHaveLength(0);
    });

    it("tertiary button does not fire haptics.tap()", async () => {
      const mocks = mockCapacitorPlugins();
      const { Button } = await import("@/components/ui/button");

      const { getByRole } = render(
        <Button variant="tertiary">+ Add</Button>
      );

      fireEvent.click(getByRole("button", { name: "+ Add" }));

      // Should not have called haptics
      expect(mocks.Haptics.getCalls()).toHaveLength(0);
    });
  });

  describe("Checkbox integration", () => {
    beforeEach(() => {
      mockNativePlatform(true);
      vi.resetModules();
    });

    it("checkbox fires haptics.select() on change", async () => {
      const mocks = mockCapacitorPlugins();
      const { Checkbox } = await import("@/components/ui/checkbox");
      const onChange = vi.fn();

      const { getByRole } = render(
        <Checkbox label="Accept terms" onChange={onChange} />
      );

      fireEvent.click(getByRole("checkbox"));

      // Should have called haptics
      const calls = mocks.Haptics.getCalls();
      expect(calls.length).toBeGreaterThanOrEqual(1);
      expect(calls.some((c) => c.method === "selectionChanged")).toBe(true);

      // Should also have called the user's onChange
      expect(onChange).toHaveBeenCalledTimes(1);
    });
  });

  describe("navigator.vibrate removal", () => {
    it("jobs/new/page.tsx does not call navigator.vibrate", async () => {
      const pageModule = await import("@/app/jobs/new/page");

      // The module should exist
      expect(pageModule.default).toBeDefined();

      // Read the source to verify navigator.vibrate is not present
      // This is a static check - the actual runtime check would require
      // mounting the component and triggering the code path
      const fs = await import("fs/promises");
      const path = await import("path");
      const pagePath = path.join(
        process.cwd(),
        "src/app/jobs/new/page.tsx"
      );
      const source = await fs.readFile(pagePath, "utf-8");

      expect(source).not.toContain("navigator.vibrate");
    });
  });

  describe("Dynamic import tree-shaking", () => {
    it("haptics module uses dynamic import for Capacitor plugin", async () => {
      // Read the source to verify dynamic import is used
      const fs = await import("fs/promises");
      const path = await import("path");
      const hapticsPath = path.join(
        process.cwd(),
        "src/lib/haptics.ts"
      );
      const source = await fs.readFile(hapticsPath, "utf-8");

      // Should use dynamic import() not static import
      expect(source).toContain("import(");
      expect(source).toContain("@capacitor/haptics");

      // Should not have static import
      expect(source).not.toMatch(/^import .* from ['"]@capacitor\/haptics['"]/m);
    });
  });
});
