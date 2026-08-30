/// <reference types="vite/client" />

// Support for Vite's ?raw import suffix used in tests/acceptance/466.test.ts
declare module "*?raw" {
  const content: string;
  export default content;
}
