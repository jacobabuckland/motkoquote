import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      { find: "@/scripts", replacement: path.resolve(__dirname, "./scripts") },
      { find: "@", replacement: path.resolve(__dirname, "./src") },
    ],
  },
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
  },
});
