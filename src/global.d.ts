// Global type declarations for special imports

// Raw text imports (SQL files, etc.)
declare module "*?raw" {
  const content: string;
  export default content;
}
