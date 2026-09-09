import type { CapacitorConfig } from "@capacitor/cli";

// Motko ships as one server-rendered Next.js app (RSC + Server Actions +
// Supabase SSR cookies), which cannot be statically exported. So the iOS build
// is a thin native shell: a WKWebView pointed at the live origin via
// `server.url`, gaining native capabilities (APNs push, microphone permission,
// haptics, share sheet, splash) without rewriting a single screen. The bundled
// `webDir` is only a branded pre-load splash shown for the instant before the
// remote app takes over.
//
// For on-device dev testing, override the origin with CAP_SERVER_URL
// (e.g. http://192.168.x.x:3000 on your LAN) — production defaults to motko.app.
const serverUrl = process.env.CAP_SERVER_URL ?? "https://motko.app";

const config: CapacitorConfig = {
  appId: "app.motko.ios",
  appName: "Motko",
  webDir: "native/www",
  // Tags every WKWebView request's User-Agent so the server can tell the app
  // apart from a web browser — used to skip the marketing landing page and
  // drop straight into signup/dashboard inside the app.
  appendUserAgent: "MotkoApp",
  server: {
    url: serverUrl,
    cleartext: serverUrl.startsWith("http://"),
  },
  ios: {
    // "never", not "always" — the documented pairing for a cover-fit viewport,
    // and half of one state with globals.css.
    //
    // "always" asks the shell to inset the web view, while `viewportFit:
    // "cover"` means env(safe-area-inset-top) STILL reports the full notch
    // inside that inset view. Both applied, so the web compensated by zeroing
    // --safe-top inside `.native-app`. That compensation shipped instantly and
    // this config never did — a native setting needs a new binary, and none
    // was built — so from 30 Aug the token was zero inside a shell that does
    // not inset, and the guest "Sign in" link went back under the status bar.
    //
    // With "never" the shell never insets, env() is the whole truth, and the
    // web applies it once. Correct on the binaries in the wild today, which
    // never insetted either, and on the next one.
    contentInset: "never",
    backgroundColor: "#004225",
    // Voice intake uses getUserMedia in the WKWebView. Leaving app-bound
    // domains off keeps standard web APIs (incl. media capture) available;
    // the native mic prompt is still gated by NSMicrophoneUsageDescription.
    limitsNavigationsToAppBoundDomains: false,
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
    SplashScreen: {
      launchShowDuration: 1200,
      backgroundColor: "#004225",
      showSpinner: false,
    },
    Keyboard: {
      resize: "native",
      accessoryBarVisible: true,
    },
    StatusBar: {
      style: "light",
    },
  },
};

export default config;
