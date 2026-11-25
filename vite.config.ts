import aitDevtools from "@apps-in-toss/devtools/unplugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [aitDevtools.vite(), react()],
});
