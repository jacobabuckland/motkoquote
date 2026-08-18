// Vitest setup file - runs before all tests
// This ensures the Capacitor mock state is reset between tests

// Import jest-dom matchers for @testing-library assertions
import "@testing-library/jest-dom/vitest";

// Import the helper to ensure the module-level beforeEach is registered
import "./helpers/capacitor";
