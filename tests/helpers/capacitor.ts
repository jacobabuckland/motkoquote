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
  Keyboard: PluginMock;
  PushNotifications: PluginMock;
  Share: PluginMock;
  SplashScreen: PluginMock;
  StatusBar: PluginMock;
}

// Global state for call tracking and platform setting
const state = {
  isNative: false,
  callRecords: new Map<string, PluginCallRecord[]>(),
  // Per-test return values, keyed "Plugin.method". The default stub resolves
  // undefined, which suits fire-and-forget calls but not methods whose result
  // the code under test reads — PushNotifications.checkPermissions() being the
  // one that bites, since `(await checkPermissions()).receive` throws on it.
  overrides: new Map<string, PluginMethodImpl>(),
};

type PluginMethodImpl = (...args: unknown[]) => unknown;

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

          // A test-supplied return value wins over the default stub.
          const override = state.overrides.get(`${pluginName}.${String(prop)}`);
          if (override) return Promise.resolve(override(...args));

          // Special handling for addListener: return a handle with remove()
          if (prop === "addListener") {
            const handle = {
              remove: vi.fn(() => {
                recordCall("remove");
                return Promise.resolve();
              }),
            };
            // Return a thenable that resolves synchronously for testing
            // This allows cleanup functions to work in tests without async flush
            return {
              then: (resolve: (value: typeof handle) => void) => {
                resolve(handle);
                return Promise.resolve(handle);
              },
              catch: () => Promise.resolve(handle),
              finally: () => Promise.resolve(handle),
            };
          }

          return Promise.resolve();
        });
      },
    }
  ) as PluginMock;
};

// Create the plugin mocks
const AppMock = createPluginMock("App");
const HapticsMock = createPluginMock("Haptics");
const KeyboardMock = createPluginMock("Keyboard");
const PushNotificationsMock = createPluginMock("PushNotifications");
const ShareMock = createPluginMock("Share");
const SplashScreenMock = createPluginMock("SplashScreen");
const StatusBarMock = createPluginMock("StatusBar");

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

vi.mock("@capacitor/app", () => ({ App: AppMock }));
vi.mock("@capacitor/haptics", () => ({ Haptics: HapticsMock }));
vi.mock("@capacitor/keyboard", () => ({ Keyboard: KeyboardMock }));
vi.mock("@capacitor/push-notifications", () => ({ PushNotifications: PushNotificationsMock }));
vi.mock("@capacitor/share", () => ({ Share: ShareMock }));
vi.mock("@capacitor/splash-screen", () => ({ SplashScreen: SplashScreenMock }));
vi.mock("@capacitor/status-bar", () => ({
  StatusBar: StatusBarMock,
  Style: {
    Light: "LIGHT",
    Dark: "DARK",
    Default: "DEFAULT",
  },
}));

// Reset call records, method overrides and platform state before each test
beforeEach(() => {
  state.callRecords.clear();
  state.overrides.clear();
  state.isNative = false; // Reset to default (web)
});

/**
 * Clears recorded plugin calls without touching platform state or overrides.
 *
 * For the uncommon test that exercises both the native and the web path in one
 * case: reset between the two phases so the second assertion counts only its
 * own calls. Deliberately explicit rather than folded into
 * mockCapacitorPlugins() — a factory that silently wipes history breaks any
 * test that registers a listener and asserts on it later, which is exactly how
 * the native push-registration regression suite reads.
 */
export function resetCapacitorCalls(): void {
  state.callRecords.clear();
}

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
 * Give one plugin method a return value for the current test. The value (or a
 * promise for it) is what the code under test receives; the call is still
 * recorded, so getCalls() assertions keep working. Cleared between tests.
 *
 * @param plugin - Plugin name, e.g. "PushNotifications"
 * @param method - Method name, e.g. "checkPermissions"
 * @param impl - Called with the real arguments; its return value is resolved
 */
export function mockPluginMethod(
  plugin: keyof CapacitorPluginMocks,
  method: string,
  impl: PluginMethodImpl
) {
  state.overrides.set(`${plugin}.${method}`, impl);
}

/**
 * Mocks the seven installed Capacitor plugins with spy-instrumented stubs.
 * Records all calls for assertion. Call records reset between tests via
 * beforeEach. Calling this function does NOT clear them — a test may register
 * listeners, call this again, and still assert on what was recorded earlier,
 * which is how the native push-registration regression suite reads its
 * listeners back. To clear mid-test, call resetCapacitorCalls() explicitly.
 *
 * Only mocks the installed plugins:
 * - @capacitor/app
 * - @capacitor/haptics
 * - @capacitor/keyboard
 * - @capacitor/push-notifications
 * - @capacitor/share
 * - @capacitor/splash-screen
 * - @capacitor/status-bar
 *
 * @returns An object with mocks for each plugin, each having a getCalls() method
 */
export function mockCapacitorPlugins(): CapacitorPluginMocks {
  return {
    App: AppMock,
    Haptics: HapticsMock,
    Keyboard: KeyboardMock,
    PushNotifications: PushNotificationsMock,
    Share: ShareMock,
    SplashScreen: SplashScreenMock,
    StatusBar: StatusBarMock,
  };
}
