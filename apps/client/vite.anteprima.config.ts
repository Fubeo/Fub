// Il server dell'anteprima di FubDraw: la config del banco — la shell vera con
// l'host finto e il vault del banco, a /index.html — più la pagina che mostra
// il lavoro sull'editor, che apre il sito.
//
// Vive solo nel ramo d'anteprima, che unisce i rami dei pacchetti in revisione:
// niente di qui va nelle PR.
import { defineConfig, mergeConfig, type Plugin } from "vite";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import bench from "./vite.bench.config";

const here = fileURLToPath(new URL(".", import.meta.url));

/// Il commit che la pagina mostra, letto a ogni richiesta: dopo un merge nel
/// ramo d'anteprima la pagina lo dice senza riavviare il server.
function git(): { commit: string; quando: string } {
  const [commit = "", quando = ""] = execFileSync("git", ["log", "-1", "--format=%h%n%cI"], { cwd: here, encoding: "utf8" })
    .trim()
    .split("\n");
  return { commit, quando };
}

function anteprima(): Plugin {
  return {
    name: "anteprima:radice",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? "/";
        if (url === "/" || url.startsWith("/?")) {
          res.statusCode = 302;
          res.setHeader("Location", `/anteprima/${url.slice(1)}`);
          res.end();
          return;
        }
        if (url === "/__anteprima/git") {
          try {
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.setHeader("Cache-Control", "no-store");
            res.end(JSON.stringify(git()));
          } catch {
            res.statusCode = 500;
            res.end();
          }
          return;
        }
        next();
      });
    },
  };
}

export default mergeConfig(
  bench,
  defineConfig({
    plugins: [anteprima()],
    build: {
      outDir: "dist-anteprima",
      rollupOptions: {
        input: {
          anteprima: fileURLToPath(new URL("./anteprima/index.html", import.meta.url)),
        },
      },
    },
  }),
);
