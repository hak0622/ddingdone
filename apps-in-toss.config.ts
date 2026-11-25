import { defineConfig } from "@apps-in-toss/web-framework/config";

export default defineConfig({
  appName: "ddingdone",
  permissions: [],
  navigationBar: {
    withBackButton: true,
  },
  webBundleDir: "dist",
});
