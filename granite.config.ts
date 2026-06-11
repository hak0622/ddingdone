import { defineConfig } from "@apps-in-toss/web-framework/config";

export default defineConfig({
  appName: "ddingdone",
  brand: {
    displayName: "띵돈",
    primaryColor: "#3182F6",
    icon: "",
  },
  web: {
    host: "localhost",
    port: 5173,
    commands: {
      dev: "vite dev",
      build: "vite build",
    },
  },
  permissions: [
    { name: "photos", access: "read" },
    { name: "clipboard", access: "read" },
  ],
  outdir: "dist",
});
