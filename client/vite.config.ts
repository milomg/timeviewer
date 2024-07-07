import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";

export default defineConfig({
  plugins: [solidPlugin()],
  build: {
    target: "esnext",
  },
  server: {
    proxy: {
      "/client": {
        target: "http://localhost:5168",
        changeOrigin: true,
        ws: true,
      }
    },
  }
});
