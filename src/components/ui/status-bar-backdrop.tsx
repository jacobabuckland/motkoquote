// Opaque backdrop for the iOS status-bar strip, on the WEB only.

// `viewportFit: "cover"` in the root layout means the document starts at the
// physical top of the screen with the status bar over it. The top bars carry
// their own inset so they sit below the notch — but AppHeader is `border-b
// bg-ground`, not sticky, so once a long page scrolls it leaves and body
// content passes under the clock and battery with nothing behind it. That is
// how a contractor's fee figures came to render behind "22:49" on Settings.
//
// Fixed and global rather than per-screen padding: EVERY scrolling route has
// this, not just Settings. The voice screen looks correct today only because it
// never scrolls — an inner max-h-56 region inside a flex-1 column — so it was
// never doing something Settings was missing.
//
// z-40 keeps it above page content and BELOW the toast and offline-banner
// layer at z-50, both of which carry their own top inset.
//
// The height is a Tailwind arbitrary value so the expression sits in the
// className, where it can be asserted as rendered DOM — the same shape the top
// bars use and top-bar-safe-area.test.tsx binds. No max() floor: off-notch it
// collapses to zero so nothing renders on a desktop browser.
//
// ---
//
// It reads --safe-top, the SAME token as the top bars, and that is load-bearing
// rather than tidiness. It read env(safe-area-inset-top) directly for one day,
// deliberately, and this comment and its test both argued for the divergence:
//
//   "A content inset is a SCROLL inset, so page content still scrolls up
//    through it and can reach the clock. Switching it to --safe-top would zero
//    it in the app and reintroduce exactly that."
//
// The premise is false, and it cost the app its back and home buttons.
//
// ✅ CONFIRMED ON A DEVICE, 30 Aug 2026. This was reasoned from a measurement
// rather than observed, and globals.css asserted the opposite for months. Jacob
// ran it in the iOS app: a dashboard pipeline card scrolled to the top of the
// screen does NOT pass under the clock. The reasoning below is right, and the
// Bugs board item that depended on which of the two was correct is closed.
//
// Content scrolls up to the top of the WEB VIEW, not the top of the screen, and
// inside the Capacitor shell those are not the same place. `ios.contentInset:
// "always"` means the native container owns the top 62 CSS px — painted
// #004225 by ios.backgroundColor, measured on an iPhone 16 Pro — and the web
// view begins below it. `position: fixed; top: 0` is therefore screen y=62, and
// web content can never reach the clock in the shell no matter how far it
// scrolls. There was nothing there to protect.
//
// What the 62px of opaque bg-ground DID cover, once --safe-top correctly zeroed
// the bars' padding inside the shell, was the bars themselves: AppHeader's
// company-name link to /dashboard landed at screen y≈74-118 and PageHeader's
// "← Back" at y≈78-98, both inside the backdrop's y=62-124. Neither was gone;
// both were painted over, and the nav below them wrapped into view, which is
// what made it read as "the buttons were removed".
//
// So the two must move together. On the web --safe-top IS
// env(safe-area-inset-top), the document does start at screen y=0, and this
// still does its original job.
export const StatusBarBackdrop = () => (
  <div
    aria-hidden
    data-testid="status-bar-backdrop"
    className="pointer-events-none fixed inset-x-0 top-0 z-40 h-[var(--safe-top)] bg-ground"
  />
);
