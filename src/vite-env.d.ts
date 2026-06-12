/// <reference types="vite/client" />

declare module "*.css" {
  const content: Record<string, string>;
  export default content;
}

interface Window {
  __GRANITE_NATIVE_EMITTER?: unknown
}
