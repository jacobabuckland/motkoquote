// A ring buffer of the last few console lines the app produced in the browser.
//
// The app runs in a WKWebView with no inspector attached, so `console.error`
// reaches nobody: every client-side line the tree writes — a failed fetch, a
// Realtime data-channel warning, a React key complaint — is written to a
// surface that does not exist on the device the bug happened on. The error
// BOUNDARIES now report themselves (reportRenderError), but a boundary only
// fires on a render-phase throw; the failures that leave a screen looking fine
// and behaving wrong never reach one.
//
// So the lines are kept. When a tester says "it did the thing again", the
// report they file carries what the console said in the seconds before, which
// is the difference between a reproducible bug and a shrug.
//
// Deliberately small and deliberately local: 25 lines, in memory, never
// persisted, and never sent anywhere unless a person presses the report button.

const MAX_LINES = 25;
const MAX_LINE_LENGTH = 500;

const buffer: string[] = [];
let installed = false;
let uninstall: (() => void) | null = null;

const record = (level: string, args: unknown[]): void => {
  const text = args
    .map((arg) => {
      if (typeof arg === "string") return arg;
      if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(" ");

  buffer.push(`[${level}] ${text}`.slice(0, MAX_LINE_LENGTH));
  // Bounded from the front, so the buffer holds the MOST RECENT lines. A
  // buffer that stops accepting once full holds the least useful ones.
  while (buffer.length > MAX_LINES) buffer.shift();
};

/**
 * Wraps console.error and console.warn so their arguments are also kept in the
 * buffer. Idempotent — a second call is a no-op, so mounting the component that
 * calls it twice cannot double-wrap and record every line twice.
 *
 * The original console method is always still called, first: this must never
 * change what a developer with an inspector attached sees.
 */
export const installClientLog = (): void => {
  if (installed || typeof console === "undefined") return;
  installed = true;

  const originalError = console.error.bind(console);
  const originalWarn = console.warn.bind(console);

  const patchedError = console.error;
  const patchedWarn = console.warn;

  console.error = (...args: unknown[]) => {
    originalError(...args);
    record("error", args);
  };
  console.warn = (...args: unknown[]) => {
    originalWarn(...args);
    record("warn", args);
  };

  uninstall = () => {
    console.error = patchedError;
    console.warn = patchedWarn;
  };
};

/** The buffered lines, oldest first. A copy — callers cannot mutate the buffer. */
export const recentClientLog = (): string[] => [...buffer];

/**
 * Test seam. Not called by the app — nothing in the product un-installs the
 * wrappers, and the buffer lives as long as the page does.
 *
 * It restores the console as well as emptying the buffer, because the install
 * flag is module state: a test that put the original methods back by hand would
 * leave `installed` true, and every later install in the same file would be the
 * no-op the idempotence guarantee promises.
 */
export const resetClientLog = (): void => {
  buffer.length = 0;
  uninstall?.();
  uninstall = null;
  installed = false;
};
