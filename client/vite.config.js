import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  build: {
    rollupOptions: {
      // Libraries in their own files, so a change to the app doesn't make
      // browsers download them again.
      output: { manualChunks: { react: ["react", "react-dom", "react-router"], supabase: ["@supabase/supabase-js"] } }
    }
  }
});
