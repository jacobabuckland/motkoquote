import { vi, beforeEach } from "vitest";

interface PluginCallRecord {
  method: string;
  args: unknown[];
}

// Every plugin method resolves to this: a spy that records the call and
// resolves, mirroring the real plugins' promise-returning API.
type PluginMethodMock = (...args: unknown[]) => Promise<unknown>;

// An intersection rather than an interface with an index signature. An index
// signature would have to cover getCalls too, which forces it to `unknown` and
// leaves every method uncallable — that is what failed the gate with TS18046.
type PluginMock = {
  getCalls: () => PluginCallRecord[];
} & Record<string, PluginMethodMock>;

interface CapacitorPluginMocks {
  App: PluginMock;
  Haptics: PluginMock;
  PushNotifications: PluginMock;
  Share: PluginMock;
  SplashScreen: PluginMock;
}

// Global state for call tracking and platform setting
const state = {
  isNative: false,
  callRecords: new Map<string, PluginCallRecord[]>(),
};

// Create plugin mock factory
const createPluginMock = (pluginName: string): PluginMock => {
  const getCalls = () => state.callRecords.get(pluginName) || [];

  const recordCall = (method: string, ...args: unknown[]) => {
    if (!state.callRecords.has(pluginName)) {
      state.callRecords.set(pluginName, []);
    }
    state.callRecords.get(pluginName)!.push({ method, args });
  };

  return new Proxy(
    { getCalls },
    {
      get(target, prop) {
        if (prop === "getCalls") {
          return target.getCalls;
        }
        // Return a spy function that records the call
        return vi.fn((...args: unknown[]) => {
          recordCall(String(prop), ...args);
          return Promise.resolve();
        });
      },
    }
  ) as PluginMock;
};

// Create the plugin mocks
const AppMock = createPluginMock("App");
const HapticsMock = createPluginMock("Haptics");
const PushNotificationsMock = createPluginMock("PushNotifications");
const ShareMock = createPluginMock("Share");
const SplashScreenMock = createPluginMock("SplashScreen");

// Top-level mocks (hoisted by vitest)
vi.mock("@capacitor/core", async () => {
  const actual = (await vi.importActual("@capacitor/core")) as Record<
    string,
    unknown
  >;
  return {
    ...actual,
    Capacitor: {
      ...(actual.Capacitor as Record<string, unknown>),
      isNativePlatform: () => state.isNative,
    },
  };
});

// Mock ImpactStyle enum to match test expectations (lowercase values)
const ImpactStyleMock = {
  Heavy: "heavy",
  Medium: "medium",
  Light: "light",
} as const;

vi.mock("@capacitor/app", () => ({ App: AppMock }));
vi.mock("@capacitor/haptics", () => ({
  Haptics: HapticsMock,
  ImpactStyle: ImpactStyleMock,
}));
vi.mock("@capacitor/push-notifications", () => ({ PushNotifications: PushNotificationsMock }));
vi.mock("@capacitor/share", () => ({ Share: ShareMock }));
vi.mock("@capacitor/splash-screen", () => ({ SplashScreen: SplashScreenMock }));

// Reset call records and platform state before each test
beforeEach(() => {
  state.callRecords.clear();
  state.isNative = false; // Reset to default (web)
});

/**
 * Mock Capacitor's isNativePlatform() to control native vs web branching in tests.
 * Defaults to web (false) so tests that don't opt in behave exactly as today.
 *
 * @param isNative - true to mock as native platform, false for web (default: false)
 */
export function mockNativePlatform(isNative = false) {
  state.isNative = isNative;
}

/**
 * Mocks the five installed Capacitor plugins with spy-instrumented stubs.
 * Records all calls for assertion. Call records reset between tests via beforeEach.
 *
 * Only mocks the installed plugins:
 * - @capacitor/app
 * - @capacitor/haptics
 * - @capacitor/push-notifications
 * - @capacitor/share
 * - @capacitor/splash-screen
 *
 * @returns An object with mocks for each plugin, each having a getCalls() method
 */
export function mockCapacitorPlugins(): CapacitorPluginMocks {
  return {
    App: AppMock,
    Haptics: HapticsMock,
    PushNotifications: PushNotificationsMock,
    Share: ShareMock,
    SplashScreen: SplashScreenMock,
  };
}
