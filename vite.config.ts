import { defineConfig } from "vite";

// Tauri 在开发时会连接固定端口，所以这里用 strictPort。
export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: "esnext",
    minify: "esbuild",
    sourcemap: false,
    // 桌面应用从本地加载，单个 ~500KB 的包不影响启动，不必拆分
    chunkSizeWarningLimit: 800,
  },
});
