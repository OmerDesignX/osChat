import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs/promises";
import path from "node:path";

const monacoRuntime = path.resolve("node_modules/monaco-editor/min/vs");

function monacoContentType(file: string) {
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".json")) return "application/json; charset=utf-8";
  if (file.endsWith(".ttf")) return "font/ttf";
  return "application/octet-stream";
}

const monacoRuntimePlugin = {
  name: "oscode-monaco-runtime",
  configureServer(server: {
    middlewares: {
      use(
        route: string,
        handler: (
          request: { url?: string },
          response: {
            statusCode: number;
            setHeader(name: string, value: string): void;
            end(value?: Uint8Array): void;
          },
          next: () => void,
        ) => void,
      ): void;
    };
  }) {
    server.middlewares.use("/monaco/vs", (request, response, next) => {
      void (async () => {
        const requestPath = decodeURIComponent(
          (request.url || "").split("?", 1)[0],
        )
          .replace(/^\/monaco\/vs\/?/, "")
          .replace(/^\/+/, "");
        const file = path.resolve(monacoRuntime, requestPath);
        const relative = path.relative(monacoRuntime, file);
        if (
          !requestPath ||
          relative.startsWith("..") ||
          path.isAbsolute(relative)
        ) {
          next();
          return;
        }
        const body = await fs.readFile(file).catch(() => null);
        if (!body) {
          next();
          return;
        }
        response.statusCode = 200;
        response.setHeader("Content-Type", monacoContentType(file));
        response.end(body);
      })();
    });
  },
  async writeBundle(output: { dir?: string }) {
    if (!output.dir) return;
    await fs.cp(monacoRuntime, path.join(output.dir, "monaco", "vs"), {
      recursive: true,
    });
  },
};

export default defineConfig({
  plugins: [react(), monacoRuntimePlugin],
  base: "./",
  build: { outDir: "dist", reportCompressedSize: false },
});
