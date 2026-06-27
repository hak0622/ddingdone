import { defineConfig } from "@apps-in-toss/web-framework/config";

// 이 파일은 Node(granite CLI)와 브라우저(main.tsx) 양쪽에서 로드된다.
// 브라우저에는 process가 없으므로 typeof 가드로 안전하게 분기한다.
function getHostIp(): string {
  if (typeof process !== "undefined" && process.env?.HOST_IP) {
    return process.env.HOST_IP;
  }
  return "localhost";
}

export default defineConfig({
  appName: "ddingdone",
  brand: {
    displayName: "띵돈",
    primaryColor: "#3182F6",
    icon: "https://static.toss.im/appsintoss/49539/06896274-c682-4aa7-9a96-dbb1e66c8b20.png",
  },
  web: {
    host: getHostIp(),
    port: 5173,
    commands: {
      dev: "vite dev --host",
      build: "vite build",
    },
  },
  permissions: [],
  outdir: "dist",
});
