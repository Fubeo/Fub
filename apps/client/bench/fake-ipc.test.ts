// @vitest-environment happy-dom
// Il gruppo Aspetto del finto del banco è quello dell'host vero.
//
// Le foto delle impostazioni si fanno col finto: una voce che l'host ha e il
// finto no manca dalla foto, e nessuno se ne accorge finché non la confronta
// con la shell vera. L'elenco qui sotto è `appearance_settings` di
// `crates/fub-host/src/settings.rs`, nello stesso ordine: chi aggiunge una voce
// all'host la aggiunge anche qui e nel finto.
import { beforeAll, describe, expect, it } from "vitest";
import type { SettingEntry } from "../src/host/contract";
import { ENGLISH } from "./fake-english";

const HOST_APPEARANCE = [
  "appearance.theme",
  "appearance.theme-id",
  "appearance.contrast",
  "appearance.accent",
  "appearance.density",
  "chrome.compactness",
  "appearance.zoom",
  "appearance.motion",
  "appearance.frame-rate",
  "appearance.diagram-style",
  "appearance.content-look",
  "appearance.font",
  "appearance.font-ui",
  "appearance.font-mono",
  "appearance.body",
  "appearance.line-height",
  "appearance.measure",
  "appearance.css-snippets",
];

let entries: SettingEntry[] = [];

beforeAll(async () => {
  // La finestra principale: è la sola che mostra «Spazio dell'interfaccia».
  window.history.replaceState(null, "", "/index.html");
  const { api } = await import("./fake-ipc");
  const result = await api.queryIndex({ kind: "settings" });
  if (result.kind !== "settings") throw new Error(`risposta inattesa: ${result.kind}`);
  entries = result.value;
});

describe("le impostazioni d'Aspetto del finto", () => {
  it("sono quelle dell'host, nel suo ordine", () => {
    const keys = entries.filter((entry) => entry.spec.group === "Aspetto").map((entry) => entry.spec.key);
    expect(keys).toEqual(HOST_APPEARANCE);
  });

  it("hanno «Animazioni» con le tre scelte, di serie come il sistema", () => {
    const motion = entries.find((entry) => entry.spec.key === "appearance.motion");
    expect(motion?.spec.label).toBe("Animazioni");
    expect(motion?.spec.kind).toEqual({
      kind: "choice",
      default: "",
      options: [
        { value: "", label: "Come il sistema" },
        { value: "calm", label: "Calme" },
        { value: "reduced", label: "Ridotte" },
      ],
    });
    expect(motion?.value).toBe("");
    expect(motion?.source).toBe("default");
  });

  it("valgono per la macchina e un programma non le scrive", () => {
    for (const entry of entries.filter((e) => e.spec.group === "Aspetto")) {
      expect(entry.spec.scope, entry.spec.key).toBe("machine");
      expect(entry.spec.program_writable, entry.spec.key).toBe(false);
    }
  });

  it("hanno ogni testo anche in inglese, per la shell in inglese", () => {
    const texts = entries
      .filter((e) => e.spec.group === "Aspetto")
      .flatMap((e) => [
        e.spec.label,
        e.spec.description,
        ...(e.spec.kind.kind === "choice" ? e.spec.kind.options.map((o) => o.label) : []),
      ])
      // I nomi propri (caratteri, «240 fps») restano uguali in ogni lingua.
      .filter((text) => !/^(Newsreader|Hanken Grotesk|Literata|Inter|IBM Plex Mono|JetBrains Mono|\d+ fps)$/.test(text));
    const missing = texts.filter((text) => !Object.prototype.hasOwnProperty.call(ENGLISH, text));
    expect(missing).toEqual([]);
  });
});
