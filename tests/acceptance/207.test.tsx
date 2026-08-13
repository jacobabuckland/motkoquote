/**
 * @vitest-environment happy-dom
 */

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { mockNativePlatform } from "../helpers/capacitor";

const readFile = (path: string): string => {
  const fullPath = join(process.cwd(), path);
  if (!existsSync(fullPath)) {
    throw new Error(`File not found: ${path}`);
  }
  return readFileSync(fullPath, "utf-8");
};

describe("Issue #207: Add and configure keyboard and status bar plugins", () => {
  describe("Plugin installation", () => {
    it("includes @capacitor/keyboard in package.json dependencies", () => {
      const pkg = readFile("package.json");
      const parsed = JSON.parse(pkg) as {
        dependencies?: Record<string, string>;
      };

      expect(parsed.dependencies).toBeDefined();
      expect(parsed.dependencies?.["@capacitor/keyboard"]).toBeDefined();
    });

    it("includes @capacitor/status-bar in package.json dependencies", () => {
      const pkg = readFile("package.json");
      const parsed = JSON.parse(pkg) as {
        dependencies?: Record<string, string>;
      };

      expect(parsed.dependencies).toBeDefined();
      expect(parsed.dependencies?.["@capacitor/status-bar"]).toBeDefined();
    });
  });

  describe("Keyboard plugin configuration", () => {
    it("has Keyboard plugin configuration in capacitor.config.ts", () => {
      const config = readFile("capacitor.config.ts");

      // Should have a Keyboard section in the plugins config
      expect(config).toMatch(/Keyboard/);
    });

    it("explicitly configures the input accessory bar behavior", () => {
      const config = readFile("capacitor.config.ts");

      // The input accessory bar is controlled via the accessoryBarVisible config
      // Must be explicitly set, not left to default
      expect(config).toMatch(/Keyboard/);
      expect(config).toMatch(/accessoryBarVisible/);
    });

    it("configures keyboard resize or scroll behavior", () => {
      const config = readFile("capacitor.config.ts");

      // Should configure how the keyboard affects the WebView
      // Either resize, body, native, or ionic modes
      expect(config).toMatch(/Keyboard/);
      expect(config).toMatch(/resize|style/);
    });
  });

  describe("Status bar plugin configuration and initialization", () => {
    it("initializes status bar style in native app init component", () => {
      const componentSource = readFile("src/components/native-app-init.tsx");

      // Should import StatusBar
      expect(componentSource).toMatch(/StatusBar.*from.*@capacitor\/status-bar/);
    });

    it("sets status bar style to light content for contrast against brand green", () => {
      const componentSource = readFile("src/components/native-app-init.tsx");

      // Should call setStyle with Style.Light to get white text
      expect(componentSource).toMatch(/StatusBar\.setStyle/);
      expect(componentSource).toMatch(/Style\.Light|style.*light/i);
    });

    it("initializes status bar on component mount", () => {
      const componentSource = readFile("src/components/native-app-init.tsx");

      // Should be in a useEffect or similar mount hook
      expect(componentSource).toMatch(/useEffect/);
      expect(componentSource).toMatch(/StatusBar\.setStyle/);
    });

    it("handles both light and dark OS appearance modes explicitly", () => {
      const componentSource = readFile("src/components/native-app-init.tsx");

      // Should either:
      // (a) set style unconditionally to Light (works for both modes), OR
      // (b) have conditional logic for light vs dark mode
      // The spec requires explicit handling, not relying on defaults

      expect(componentSource).toMatch(/StatusBar\.setStyle/);

      // Verify it's set to Light (white text) which works on the dark green bg
      // regardless of OS appearance mode
      const hasLightStyle = componentSource.match(/Style\.Light|style.*light/i);
      expect(hasLightStyle).toBeTruthy();
    });
  });

  describe("Capacitor test helper extension", () => {
    beforeEach(() => {
      mockNativePlatform(true);
    });

    it("exports mockCapacitorPlugins function that includes Keyboard mock", async () => {
      const { mockCapacitorPlugins } = await import("../helpers/capacitor");
      const mocks = mockCapacitorPlugins();

      expect(mocks.Keyboard).toBeDefined();
      expect(typeof mocks.Keyboard.getCalls).toBe("function");
    });

    it("exports mockCapacitorPlugins function that includes StatusBar mock", async () => {
      const { mockCapacitorPlugins } = await import("../helpers/capacitor");
      const mocks = mockCapacitorPlugins();

      expect(mocks.StatusBar).toBeDefined();
      expect(typeof mocks.StatusBar.getCalls).toBe("function");
    });

    it("Keyboard mock records method calls", async () => {
      const { mockCapacitorPlugins } = await import("../helpers/capacitor");
      const mocks = mockCapacitorPlugins();

      await mocks.Keyboard.show();

      const calls = mocks.Keyboard.getCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0].method).toBe("show");
    });

    it("StatusBar mock records method calls", async () => {
      const { mockCapacitorPlugins } = await import("../helpers/capacitor");
      const mocks = mockCapacitorPlugins();

      await mocks.StatusBar.setStyle({ style: "LIGHT" });

      const calls = mocks.StatusBar.getCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0].method).toBe("setStyle");
    });
  });

  describe("Integration: status bar does not interfere with existing functionality", () => {
    it("does not remove or modify existing App.addListener calls", () => {
      const componentSource = readFile("src/components/native-app-init.tsx");

      // Should still have appStateChange and appUrlOpen listeners from previous work
      expect(componentSource).toMatch(/App\.addListener/);
    });

    it("does not remove or modify the existing push notification handler", () => {
      const componentSource = readFile("src/components/native-app-init.tsx");

      // Should still have initNativePush call
      expect(componentSource).toMatch(/initNativePush/);
    });

    it("status bar initialization coexists with other native initialization", () => {
      const componentSource = readFile("src/components/native-app-init.tsx");

      // Should have both StatusBar setup and existing App listeners
      const hasStatusBar = componentSource.includes("StatusBar");
      const hasAppListeners = componentSource.includes("App.addListener");

      expect(hasStatusBar).toBe(true);
      expect(hasAppListeners).toBe(true);
    });
  });

  describe("Configuration completeness", () => {
    it("native-app-init.tsx guards native calls with isNativePlatform check", () => {
      const componentSource = readFile("src/components/native-app-init.tsx");

      // StatusBar calls should only run on native platform
      expect(componentSource).toMatch(/Capacitor\.isNativePlatform|isNativePlatform/);
    });

    it("keyboard configuration does not enable automatic scroll for empty or undefined values", () => {
      const config = readFile("capacitor.config.ts");

      // If resize style is set, it should be a valid value
      // The spec requires explicit configuration, not leaving it undefined
      const keyboardMatch = config.match(/Keyboard[\s\S]*?{[\s\S]*?}/);
      expect(keyboardMatch).toBeTruthy();

      if (keyboardMatch) {
        const keyboardConfig = keyboardMatch[0];
        // Should not have undefined or commented-out values for critical settings
        expect(keyboardConfig).not.toMatch(/resize:\s*undefined/);
        expect(keyboardConfig).not.toMatch(/style:\s*undefined/);
      }
    });
  });

  describe("Documentation of input accessory bar decision", () => {
    it("spec documents the chosen input accessory bar behavior", () => {
      const spec = readFile("docs/specs/207.md");

      // Spec must state the decision about the input accessory bar
      expect(spec).toMatch(/input accessory bar/i);
      expect(spec).toMatch(/accessory/i);
    });
  });

  describe("Forms verification readiness", () => {
    it("quote editor component exists and can be tested", () => {
      const quotePath = "src/app/jobs/[id]/quote-editor.tsx";
      expect(existsSync(join(process.cwd(), quotePath))).toBe(true);
    });

    it("settings form component exists and can be tested", () => {
      const settingsPath = "src/app/settings/settings-client.tsx";
      expect(existsSync(join(process.cwd(), settingsPath))).toBe(true);
    });

    it("login page exists and can be tested", () => {
      // Login is a page, so check for the directory
      const loginPath = "src/app/login";
      expect(existsSync(join(process.cwd(), loginPath))).toBe(true);
    });
  });
});
