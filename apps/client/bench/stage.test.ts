import { describe, expect, it } from "vitest";

// stage.mjs is intentionally outside the browser TypeScript boundary.
// @ts-expect-error JavaScript benchmark module has no declaration file.
const { openStage } = await import("./stage.mjs");

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
