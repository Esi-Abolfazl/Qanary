import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["src/test/setup.ts"],
    // Only scan vitest specs — keeps Playwright e2e specs out of this runner
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
