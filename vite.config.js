import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { port, root } from "./src/config.js";
export default defineConfig({
  plugins: [react(), {
    name: "offline-shell",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      const publicDir = path.join(root, "public");
      const files = readdirSync(publicDir, { recursive: true })
        .filter((file) => statSync(path.join(publicDir, file)).isFile()).sort();
      const source = readFileSync(path.join(root, "dashboard/sw.js"), "utf8");
      const hash = createHash("sha256").update(source);
      for (const output of Object.values(bundle)) hash.update(output.code ?? output.source);
      for (const file of files) hash.update(readFileSync(path.join(publicDir, file)));
      const assets = ["/", ...Object.keys(bundle).filter((file) => file !== "index.html")
        .concat(files).map((file) => `/${file}`)];
      this.emitFile({
        type: "asset", fileName: "sw.js",
        source: source.replace("__VERSION__", hash.digest("hex").slice(0, 16))
          .replace("__ASSETS__", JSON.stringify(assets)),
      });
    },
  }],
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
