// Opaque backdrop for the iOS status-bar strip.

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
// The height is a Tailwind arbitrary value so the env() expression sits in the
// className, where it can be asserted as rendered DOM — the same shape the top
// bars use and top-bar-safe-area.test.tsx binds. Deliberately NO max() floor,
// unlike the padding utilities: off-notch this collapses to zero so nothing
// renders on the web or on a device with no inset.
//
// z-40 keeps it above page content and BELOW the toast and offline-banner
// layer at z-50, both of which carry their own top inset.
export const StatusBarBackdrop = () => (
  <div
    aria-hidden
    data-testid="status-bar-backdrop"
    className="pointer-events-none fixed inset-x-0 top-0 z-40 h-[env(safe-area-inset-top)] bg-ground"
  />
);
