// @vitest-environment happy-dom
// Invarianti incerte del pacchetto media (P07): specchiate in Rust dove il
// comportamento e' condiviso (`crates/fub-host/src/resources.rs`).
//
// Copertura mirata, non "avere test": tabelle MIME allineate, nomi file che
// non sfuggono, candidati collisione nella forma del kernel, link relativi,
// handle come stringhe, clamp dei chunk, limiti inline, slide solo su `hr`
// di primo livello, frammenti `#page=N`. Niente DOM pesante oltre gli split;
// niente rete, niente IPC: il trasporto resta iniettato.

import { describe, expect, it, vi } from "vitest";
import {
  MEDIA_IPC_CHUNK,
  MEDIA_MAX_INLINE_BYTES,
  assetUrl,
  mediaKindOfId,
  mediaKindOfMime,
  mimeOfId,
} from "./media-types";
import { attachmentCandidate, attachmentMarkdown, attachmentTarget, depositAttachment, relativeUrl, sanitizeFileName, saveRemoteAttachment, splitFileName } from "./attachment-target";
import { makePdfJsLoader, pdfIdWithoutFragment, pdfPageFromFragment, type PdfJsModule } from "./pdf-view";
import { mountSlideDeck, splitRenderedSlides } from "../../ui/slides";
import { printDocument } from "./print-view";
import { createViewStateCrashDeposit } from "./recorder-store";
import { RESOURCE_WRITE_HEADER, writeResource, type TauriInvoke } from "./transport";

describe("le specie media vengono dal nome, come di la'", () => {
  it("immagini, audio, video e PDF per estensione, senza distinguere il caso", () => {
    expect(mediaKindOfId("img/foto.PNG")).toBe("image");
    expect(mediaKindOfId("memo.M4A")).toBe("audio");
    expect(mediaKindOfId("clip.WEBM")).toBe("video");
    expect(mediaKindOfId("doc/manuale.pdf")).toBe("pdf");
  });

  it("i documenti non sono risorse e l'ignoto e' other", () => {
    expect(mediaKindOfId("nota.md")).toBe("other");
    expect(mediaKindOfId("foglio.fubsheet")).toBe("other");
    expect(mediaKindOfId("vista.base")).toBe("other");
    expect(mediaKindOfId("lavagna.canvas")).toBe("other");
    expect(mediaKindOfId("dati.dat")).toBe("other");
    expect(mediaKindOfId("LICENSE")).toBe("other");
    expect(mimeOfId("nota.md")).toBeNull();
  });

  it("la specie da un MIME gia' noto", () => {
    expect(mediaKindOfMime("image/png")).toBe("image");
    expect(mediaKindOfMime("audio/mp4")).toBe("audio");
    expect(mediaKindOfMime("video/webm")).toBe("video");
    expect(mediaKindOfMime("application/pdf")).toBe("pdf");
    expect(mediaKindOfMime(null)).toBe("other");
    expect(mediaKindOfMime("application/zip")).toBe("other");
  });

  it("i tetti IPC sono quelli dichiarati nel contratto", () => {
    expect(MEDIA_IPC_CHUNK).toBe(64 * 1024);
    expect(MEDIA_MAX_INLINE_BYTES).toBe(64 * 1024 * 1024);
  });

  it("l'URL asset porta il solo handle", () => {
    expect(assetUrl("3")).toBe("fub-asset://localhost/3");
  });
});

describe("i nomi di deposito non sfuggono", () => {
  it("sanifica a un singolo segmento", () => {
    expect(sanitizeFileName("foto.png")).toBe("foto.png");
    expect(sanitizeFileName("C:\\foto\\a.png")).toBe("a.png");
    for (const bad of ["", "   ", ".", ".."]) {
      expect(() => sanitizeFileName(bad)).toThrow();
    }
  });

  it("divide nome ed estensione come il gemello Rust", () => {
    expect(splitFileName("foto.png")).toEqual({ stem: "foto", ext: "png" });
    expect(splitFileName("LICENSE")).toEqual({ stem: "LICENSE", ext: "" });
  });

  it("i candidati collisione hanno la forma del kernel", () => {
    expect(attachmentCandidate("allegati", "foto", "png", 0)).toBe("allegati/foto.png");
    expect(attachmentCandidate("allegati", "foto", "png", 1)).toBe("allegati/foto 1.png");
    expect(attachmentCandidate("", "foto", "png", 2)).toBe("foto 2.png");
  });

  it("il deposito e' cartella + nome sanificato", () => {
    expect(attachmentTarget("allegati", "foto.png")).toBe("allegati/foto.png");
    expect(attachmentTarget("  allegati/ ", "foto.png")).toBe("allegati/foto.png");
    expect(() => attachmentTarget("allegati", "..")).toThrow();
  });

  it("i link restano relativi al documento che li ospita", () => {
    expect(relativeUrl("nota.md", "allegati/foto.png")).toBe("allegati/foto.png");
    expect(relativeUrl("note/a.md", "allegati/foto.png")).toBe("../allegati/foto.png");
    expect(relativeUrl("note/a.md", "note/foto.png")).toBe("foto.png");
    expect(relativeUrl("n.md", "allegati/una foto.png")).toBe("allegati/una%20foto.png");
  });

  it("atomically retries a collision and links to the receipt, including Unicode", async () => {
    const attempted: string[] = [];
    const result = await depositAttachment({
      folder: "allegati",
      fromDocument: "note/a.md",
      async write(id) {
        attempted.push(id);
        if (attempted.length === 1) throw { kind: "already_exists" };
        return { id, revision: "r" };
      },
    }, "C:\\foto\\😊.png", new Uint8Array([1, 2]));
    expect(attempted).toEqual(["allegati/😊.png", "allegati/😊 1.png"]);
    expect(result.link).toBe("../allegati/%F0%9F%98%8A%201.png");
    expect(() => attachmentTarget("../vault", "x.png")).toThrow();
    const long = attachmentCandidate("", "x".repeat(251), "png", 1);
    expect(new TextEncoder().encode(long).byteLength).toBe(255);
    expect(long.endsWith(" 1.png")).toBe(true);
  });

  it("remote deposit requires a gesture and exact HTTPS host", async () => {
    let requests = 0;
    const save = async () => { requests++; return { id: "allegati/a.html", revision: "r" }; };
    await expect(saveRemoteAttachment("https://host.test/a", ["host.test"], false, save, "note/a.md")).rejects.toThrow();
    await expect(saveRemoteAttachment("https://evil.host.test/a", ["host.test"], true, save, "note/a.md")).rejects.toThrow();
    await expect(saveRemoteAttachment("https://host.test:8443/a", ["host.test"], true, save, "note/a.md")).rejects.toThrow();
    expect(requests).toBe(0);
    expect(await saveRemoteAttachment("https://host.test/a", ["host.test"], true, save, "note/a.md"))
      .toBe("../allegati/a.html");
  });
});

describe("i frammenti pagina dei PDF", () => {
  it("legge #page=N e ?page=N, 1-based", () => {
    expect(pdfPageFromFragment("doc/manuale.pdf#page=3")).toBe(3);
    expect(pdfPageFromFragment("doc/manuale.pdf?page=2")).toBe(2);
    expect(pdfPageFromFragment("doc/manuale.pdf")).toBeNull();
    expect(pdfPageFromFragment("doc/manuale.pdf#page=0")).toBeNull();
    expect(pdfPageFromFragment("doc/manuale.pdf#sezione")).toBeNull();
  });

  it("l'id senza frammento nomina il PDF", () => {
    expect(pdfIdWithoutFragment("doc/manuale.pdf#page=3")).toBe("doc/manuale.pdf");
    expect(pdfIdWithoutFragment("doc/manuale.pdf")).toBe("doc/manuale.pdf");
  });

  it("rejects a remote worker and a mismatched engine before reading bytes", async () => {
    let imports = 0;
    const module = {
      version: "not-the-required-version",
      GlobalWorkerOptions: { workerSrc: "" },
      getDocument: vi.fn(),
    } as unknown as PdfJsModule;
    const importModule = async () => { imports++; return module; };
    await expect(makePdfJsLoader(importModule, "https://cdn.test/pdf.worker.mjs")(new Uint8Array([1])))
      .rejects.toThrow(/local app origin/);
    expect(imports).toBe(0);
    await expect(makePdfJsLoader(importModule, "/pdf.worker.mjs")(new Uint8Array([1])))
      .rejects.toThrow(/does not match/);
    expect(module.GlobalWorkerOptions.workerSrc).toBe("");
  });
});

describe("le slide spezzano solo su hr di primo livello", () => {
  it("un hr dentro un contenitore non spezza", () => {
    const content = document.createElement("div");
    const first = document.createElement("p");
    first.textContent = "uno";
    const nested = document.createElement("blockquote");
    const innerHr = document.createElement("hr");
    nested.append(innerHr);
    const second = document.createElement("p");
    second.textContent = "due";
    content.append(first, nested, second);
    const slides = splitRenderedSlides(content);
    expect(slides).toHaveLength(1);
    expect(slides[0]!.querySelector("blockquote hr")).not.toBeNull();
  });

  it("hr di primo livello spezzano, vuoti esclusi", () => {
    const content = document.createElement("div");
    const first = document.createElement("p");
    first.textContent = "uno";
    const hr = document.createElement("hr");
    const second = document.createElement("p");
    second.textContent = "due";
    content.append(first, hr, second);
    const slides = splitRenderedSlides(content);
    expect(slides).toHaveLength(2);
    expect(slides[0]!.textContent).toContain("uno");
    expect(slides[1]!.textContent).toContain("due");
  });

  it("navigates from a deep link and restores focus on Escape", () => {
    const oldUrl = location.href;
    history.replaceState(null, "", "#slide=2");
    const trigger = document.createElement("button");
    const host = document.createElement("div");
    document.body.append(trigger, host);
    trigger.focus();
    const slides = [document.createElement("section"), document.createElement("section")];
    const deck = mountSlideDeck(host, slides);
    expect(deck.element.textContent).toContain("Slide 2 di 2");
    deck.element.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    expect(location.hash).toBe("#slide=1");
    deck.element.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.activeElement).toBe(trigger);
    expect(location.hash).toBe("#slide=2");
    trigger.remove();
    host.remove();
    history.replaceState(null, "", oldUrl);
  });
});

it("prints only a print-target render and tears down the projection", async () => {
  const previousPrint = Object.getOwnPropertyDescriptor(window, "print");
  const print = vi.fn();
  Object.defineProperty(window, "print", { configurable: true, value: print });
  const seen: string[] = [];
  try {
    const close = await printDocument("note.md", "Note", async (_doc, target) => {
      seen.push(target);
      return { html: "<p>Print copy</p>", parts: [] };
    });
    expect(seen).toEqual(["print"]);
    expect(print).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".print-host .print-body")?.textContent).toBe("Print copy");
    close();
    expect(document.querySelector(".print-host")).toBeNull();
  } finally {
    if (previousPrint) Object.defineProperty(window, "print", previousPrint);
    else Reflect.deleteProperty(window, "print");
  }
});

describe("il deposito viaggia grezzo con metadati in header", () => {
  it("corpo Uint8Array + header, mai bytes in JSON", async () => {
    const bytes = new Uint8Array([0, 255, 0xef, 0xbb, 0xbf, 13, 10]);
    let seenCmd = "";
    let seenArgs: unknown;
    let seenOptions: { headers?: Record<string, string> } | undefined;
    const invoke: TauriInvoke = async <T>(cmd: string, args?: unknown, options?: { headers?: Record<string, string> }): Promise<T> => {
      seenCmd = cmd;
      seenArgs = args;
      seenOptions = options;
      return { id: "allegati/foto.png", revision: "sha256:x" } as T;
    };
    const receipt = await writeResource(invoke, "allegati/foto.png", bytes, null, "vault");
    expect(seenCmd).toBe("resource_write");
    // Il corpo e' l'istanza esatta passata: byte-identica, non copiata in JSON.
    expect(seenArgs).toBe(bytes);
    expect(seenArgs).toBeInstanceOf(Uint8Array);
    const header = seenOptions?.headers?.[RESOURCE_WRITE_HEADER] ?? "";
    const meta = JSON.parse(decodeURIComponent(header));
    expect(meta).toEqual({ id: "allegati/foto.png", vault: "vault", expected: null });
    // La ricevuta e' id+revision, niente handle/len/mime.
    expect(receipt).toEqual({ id: "allegati/foto.png", revision: "sha256:x" });
    expect("handle" in receipt).toBe(false);
  });

  it("expected stringato passa il CAS grezzo", async () => {
    const invoke: TauriInvoke = (async <T>(): Promise<T> => ({ id: "a.png", revision: "r" }) as T);
    const capture: { options?: { headers?: Record<string, string> } } = {};
    const recording: TauriInvoke = async <T>(cmd: string, args?: Parameters<TauriInvoke>[1], options?: { headers?: Record<string, string> }): Promise<T> => {
      capture.options = options;
      return invoke(cmd, args, options);
    };
    await writeResource(recording, "a.png", new Uint8Array([1]), "sha256:abc");
    const meta = JSON.parse(
      decodeURIComponent(capture.options?.headers?.[RESOURCE_WRITE_HEADER] ?? ""),
    );
    expect(meta.expected).toBe("sha256:abc");
  });
});

describe("recorder crash staging", () => {
  it("recovers ordered chunks after a new adapter instance and keeps future schema untouched", async () => {
    const values = new Map<string, unknown>();
    const port = {
      async get(key: string) { return values.get(key) ?? null; },
      async set(key: string, value: unknown) { values.set(key, value); },
    };
    const key = "media.recordings.rec-1";
    const before = createViewStateCrashDeposit(port);
    await Promise.all([
      before.append(key, new Uint8Array([1, 2])),
      before.append(key, new Uint8Array([3])),
    ]);
    const after = createViewStateCrashDeposit(port);
    expect(await after.list("media.recordings.")).toEqual([key]);
    expect(await after.read(key)).toEqual(new Uint8Array([1, 2, 3]));
    values.set(key, { schema: 2, chunks: ["AQ=="] });
    await expect(after.append(key, new Uint8Array([4]))).rejects.toThrow(/schema/);
    expect(values.get(key)).toEqual({ schema: 2, chunks: ["AQ=="] });
  });
});

describe("il Markdown di un allegato depositato", () => {
  it("incorpora ciò che la lettura sa mostrare e collega il resto col suo nome", () => {
    expect(attachmentMarkdown("allegati/foto.png")).toBe("![](allegati/foto.png)");
    expect(attachmentMarkdown("allegati/voce.mp3")).toBe("![](allegati/voce.mp3)");
    expect(attachmentMarkdown("allegati/relazione.pdf")).toBe("![](allegati/relazione.pdf)");
    expect(attachmentMarkdown("allegati/dati%20grezzi.zip")).toBe("[dati grezzi.zip](allegati/dati%20grezzi.zip)");
    expect(attachmentMarkdown("allegati/[bozza].docx")).toBe("[\\[bozza\\].docx](allegati/[bozza].docx)");
  });
});
