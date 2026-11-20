import { describe, expect, it } from "vitest";

// stage.mjs is intentionally outside the browser TypeScript boundary.
// @ts-expect-error JavaScript benchmark module has no declaration file.
const { openStage, waitUntilSettled, PENDING } = await import("./stage.mjs");

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("stage lifecycle", () => {
  it("returns one in-flight close promise to concurrent owners", async () => {
    const browserClose = deferred<void>();
    const serverClose = deferred<void>();
    let browserCloses = 0;
    let serverCloses = 0;
    const browser = {
      close: () => {
        browserCloses += 1;
        return browserClose.promise;
      },
    };
    const server = {
      config: { server: { port: 4173 } },
      listen: async () => {},
      close: () => {
        serverCloses += 1;
        return serverClose.promise;
      },
    };
    const stage = await openStage({
      createServer: async () => server,
      chromium: { launch: async () => browser },
    });

    const firstClose = stage.close();
    const secondClose = stage.close();
    expect(secondClose).toBe(firstClose);
    expect(browserCloses).toBe(1);
    expect(serverCloses).toBe(0);

    const browserError = new Error("browser close failed");
    browserClose.reject(browserError);
    await Promise.resolve();
    expect(serverCloses).toBe(1);
    serverClose.resolve();

    await expect(firstClose).rejects.toBe(browserError);
    await expect(secondClose).rejects.toBe(browserError);
    expect((browserError as Error & { results?: unknown }).results).toEqual({
      browser: {
        acquired: true,
        success: false,
        error: { name: "Error", message: "browser close failed" },
      },
      server: { acquired: true, success: true },
    });
  });

  it("moves the server only when a port is given", async () => {
    const configs: Array<Record<string, unknown>> = [];
    const server = { config: { server: { port: 1448 } }, listen: async () => {}, close: async () => {} };
    const options = {
      createServer: async (config: Record<string, unknown>) => {
        configs.push(config);
        return server;
      },
      chromium: { launch: async () => ({ close: async () => {} }) },
    };
    await (await openStage(options)).close();
    await (await openStage({ ...options, port: 1448, strictPort: true })).close();
    expect(configs[0]).not.toHaveProperty("server");
    expect(configs[1]?.server).toEqual({ port: 1448, strictPort: true });
  });

  it("adds a bench's own browser options after the shared ones", async () => {
    const launches: Array<{ args?: string[] }> = [];
    const options = {
      createServer: async () => ({ config: { server: { port: 1431 } }, listen: async () => {}, close: async () => {} }),
      chromium: {
        launch: async (config: { args?: string[] }) => {
          launches.push(config);
          return { close: async () => {} };
        },
      },
    };
    await (await openStage(options)).close();
    await (await openStage({ ...options, browserArgs: ["--disable-partial-raster"] })).close();
    expect(launches[0]?.args).not.toContain("--disable-partial-raster");
    expect(launches[1]?.args).toEqual([...(launches[0]?.args ?? []), "--disable-partial-raster"]);
  });

  it("preserves launch failure while exposing a failed rollback", async () => {
    const rollbackError = new Error("server rollback failed");
    const launchError = new Error("browser launch failed");
    const server = {
      config: { server: { port: 4173 } },
      listen: async () => {},
      close: async () => {
        throw rollbackError;
      },
    };

    const failure = await openStage({
      createServer: async () => server,
      chromium: {
        launch: async () => {
          throw launchError;
        },
      },
    }).catch((error: unknown) => error);

    expect(failure).toBe(launchError);
    expect((launchError as Error & { cleanup?: unknown }).cleanup).toEqual({
      browser: { acquired: false, success: true },
      server: {
        acquired: true,
        success: false,
        error: { name: "Error", message: "server rollback failed" },
      },
    });
  });
});

// I banchi che misurano per minuti (il moto, la prova del PDF) aprono un server
// che non guarda il disco. Si prova con la config vera del banco: è
// `mergeConfig` di Vite, non il nostro codice, a decidere se il `null` arriva
// al guardiano.
describe("the unwatched stage", () => {
  type Watcher = { add(path: string): unknown; getWatched(): Record<string, string[]> };
  type ServerConfig = { server: { watch: unknown; hmr: unknown } };
  type RealServer = { config: ServerConfig; watcher: Watcher; close(): Promise<void> };
  type Vite = {
    createServer(config: Record<string, unknown>): Promise<RealServer>;
    resolveConfig(config: Record<string, unknown>, command: "serve"): Promise<ServerConfig>;
  };

  // Lo specificatore non è letterale apposta: i tipi di `vite` portano con sé
  // quelli di Node, che `tsconfig.json` tiene fuori dal client (un
  // `setTimeout` diventerebbe un `Timeout` in tutto `src/`).
  const vite = async (): Promise<Vite> => {
    const name = "vite";
    return (await import(/* @vite-ignore */ name)) as Vite;
  };

  /// La config che `openStage` passa a Vite, senza server né browser.
  async function stageConfig(options: Record<string, unknown>): Promise<Record<string, unknown>> {
    let captured: Record<string, unknown> | undefined;
    const stage = await openStage({
      ...options,
      createServer: async (config: Record<string, unknown>) => {
        captured = config;
        return { config: { server: { port: 1431 } }, listen: async () => {}, close: async () => {} };
      },
      chromium: { launch: async () => ({ close: async () => {} }) },
    });
    await stage.close();
    return { ...captured!, logLevel: "silent" };
  }

  it("does not watch the disk nor push updates", async () => {
    // Il server vero si crea senza guardiano: nessuna cartella aperta, né
    // osservatori di inotify né interrogazioni del disco.
    const server = await (await vite()).createServer(await stageConfig({ watch: false }));
    try {
      expect(server.config.server.watch).toBeNull();
      expect(server.config.server.hmr).toBe(false);
      server.watcher.add("./src");
      expect(server.watcher.getWatched()).toEqual({});
    } finally {
      await server.close();
    }
  }, 60_000);

  it("gives every server its own plugin", async () => {
    const plugins = async () => (await stageConfig({ watch: false })).plugins as unknown[];
    const [first, second] = [await plugins(), await plugins()];
    expect(first).toHaveLength(1);
    expect(first[0]).not.toBe(second[0]);
  });

  it("keeps a port given by the caller", async () => {
    const config = await stageConfig({ watch: false, port: 1448 });
    expect(config.server).toEqual({ port: 1448, strictPort: true, hmr: false });
  });

  it("would still watch with an inline `watch: null`, which `mergeConfig` drops", async () => {
    // Il modo di prima del moto. Si risolve la config e basta, senza creare il
    // server: il suo guardiano partirebbe davvero. Se un giorno Vite
    // rispettasse il `null` in linea, questo test cade e il plugin si può
    // togliere.
    const config = await stageConfig({});
    const resolved = await (await vite()).resolveConfig({ ...config, server: { hmr: false, watch: null } }, "serve");
    expect(resolved.server.watch).not.toBeNull();
  }, 60_000);
});

describe("waitUntilSettled", () => {
  it("aspetta che nessun elemento porti data-pending", async () => {
    const calls: unknown[][] = [];
    const page = {
      waitForFunction: async (...args: unknown[]) => {
        calls.push(args);
      },
    };
    await waitUntilSettled(page, 1234);
    expect(PENDING).toBe("[data-pending]");
    expect(calls).toHaveLength(1);
    expect(calls[0]![1]).toBe(PENDING);
    expect(calls[0]![2]).toEqual({ timeout: 1234 });
  });

  it("se la pagina non si ferma, lancia dicendo chi è ancora in attesa", async () => {
    const timeout = new Error("Timeout 50ms exceeded");
    const page = {
      waitForFunction: async () => {
        throw timeout;
      },
      evaluate: async () => ["#status-hints"],
    };
    const error = await waitUntilSettled(page, 50).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("la pagina non si ferma: dopo 50 ms #status-hints porta ancora data-pending");
    expect((error as { cause?: unknown }).cause).toBe(timeout);
  });
});
