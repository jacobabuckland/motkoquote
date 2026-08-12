// Vitest setup file - runs before all tests
// This ensures the Capacitor mock state is reset between tests

// Import the helper to ensure the module-level beforeEach is registered
import "./helpers/capacitor";

// Import global CSS for tests that check CSS variables
import "../src/app/globals.css";
