import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { port } from "./src/config.js";
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${port}`,
        changeOrigin: true,
        configure(proxy) {
          proxy.on("proxyReq", (proxyReq, req) => {
            if (
              ["http://127.0.0.1:5173", "http://localhost:5173"].includes(
                req.headers.origin,
              )
            ) {
              proxyReq.setHeader("origin", `http://127.0.0.1:${port}`);
            }
          });
        },
      },
    },
  },
});
