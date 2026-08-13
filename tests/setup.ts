// Vitest setup file - runs before all tests
// This ensures the Capacitor mock state is reset between tests

// Import the helper to ensure the module-level beforeEach is registered
import "./helpers/capacitor";

// Import global CSS for tests that check CSS variables
import "../src/app/globals.css";

// Configure React's test environment
// This tells React to automatically wrap state updates in act() during tests
global.IS_REACT_ACT_ENVIRONMENT = true;

// Manually inject CSS custom properties for happy-dom
// happy-dom doesn't parse CSS files, so we need to set these programmatically
if (typeof document !== "undefined") {
  const style = document.createElement("style");
  style.textContent = `
    :root {
      --success: #15803d;
      --error: #b91c1c;
      --ease-out: cubic-bezier(0.33, 1, 0.68, 1);
      --dur-fast: 150ms;
      --color-foreground: #222222;
    }
  `;
  document.head.appendChild(style);

  // Polyfill getComputedStyle to convert hex colors to rgb format for testing
  const originalGetComputedStyle = window.getComputedStyle;
  window.getComputedStyle = function (element, pseudoElement?) {
    const styles = originalGetComputedStyle.call(this, element, pseudoElement);
    const originalGetPropertyValue = styles.getPropertyValue.bind(styles);

    // Override backgroundColor getter to convert hex to rgb
    Object.defineProperty(styles, "backgroundColor", {
      get() {
        const bgColor = (element as HTMLElement).style.backgroundColor || originalGetPropertyValue("background-color");

        // Convert hex to rgb if needed
        if (bgColor && bgColor.startsWith("#")) {
          const hex = bgColor.replace("#", "");
          const r = parseInt(hex.substring(0, 2), 16);
          const g = parseInt(hex.substring(2, 4), 16);
          const b = parseInt(hex.substring(4, 6), 16);
          return `rgb(${r}, ${g}, ${b})`;
        }

        return bgColor;
      },
      configurable: true,
    });

    return styles;
  };
}
