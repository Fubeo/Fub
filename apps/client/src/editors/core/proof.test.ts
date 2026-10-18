import { describe, expect, it, vi } from "vitest";
import type { IndexQuery, IndexResult, SettingEntry, SettingValue } from "../../host/contract";
import { ProofClient, primaryLanguage, utf8ToUtf16, type ProofPorts } from "./proof";

function entry(key: string, value: SettingValue): SettingEntry {
  return {
    spec: { key, label: key, description: "", group: "", scope: "vault" } as SettingEntry["spec"],
    value,
    source: "default" as SettingEntry["source"],
  };
}

const SETTINGS = [
  entry("proof.language", "auto"),
  entry("proof.grammar", true),
  entry("proof.ignore-uppercase", true),
  entry("proof.ignore-numbers", false),
  entry("proof.words", ["fubvault"]),
];

type Check = { language: string; segments: string[]; words: string[]; options: Record<string, boolean> };

/// Un host che risponde come la route: segna ogni «speling», in byte.
function host(overrides: Partial<ProofPorts> = {}) {
  const checks: Check[] = [];
  let changed: (() => void) | null = null;
  const ports: ProofPorts = {
    queryIndex: vi.fn(async (query: IndexQuery): Promise<IndexResult> => {
      if (query.kind !== "custom") throw new Error("query inattesa");
      const q = query.query as Check;
      checks.push(q);
      const encoder = new TextEncoder();
      return {
        kind: "custom",
        value: {
          language: { code: q.language, spelling: true, grammar: true, missing_dictionary: null },
          segments: q.segments.map((segment) => {
            const at = segment.indexOf("speling");
            if (at < 0) return [];
            const start = encoder.encode(segment.slice(0, at)).length;
            return [{ start, end: start + 7, kind: "spelling", message: "Spelling", suggestions: ["spelling"] }];
          }),
        },
      };
    }),
    invokeCommand: vi.fn(async () => ({ notify: "aggiunta" })),
    settings: vi.fn(async () => SETTINGS),
    interfaceLanguage: () => "it",
    watch: (listener) => {
      changed = listener;
      return () => {
        changed = null;
      };
    },
    ...overrides,
  };
  return { ports, checks, change: () => changed?.() };
}

describe("utf8ToUtf16", () => {
  it("conta due unità per un carattere fuori dal piano base e un byte per l'ASCII", () => {
    const text = "é😀a";
    // é = 2 byte, 😀 = 4 byte e 2 unità, a = 1 byte.
    expect(utf8ToUtf16(text, [0, 2, 6, 7])).toEqual([0, 1, 3, 4]);
    expect(utf8ToUtf16(text, [7, 0])).toEqual([4, 0]);
  });

  it("porta un offset dentro un carattere al confine successivo", () => {
    expect(utf8ToUtf16("é", [1])).toEqual([1]);
  });
});

describe("primaryLanguage", () => {
  it("riduce un tag al codice primario e rifiuta ciò che non lo è", () => {
    expect(primaryLanguage("it-IT")).toBe("it");
    expect(primaryLanguage("pt_BR")).toBe("pt");
    expect(primaryLanguage("non una lingua")).toBeNull();
    expect(primaryLanguage(null)).toBeNull();
  });
});

describe("ProofClient", () => {
  it("chiede con le impostazioni del vault e risponde in unità UTF-16", async () => {
    const { ports, checks } = host();
    const client = new ProofClient(ports);
    const result = await client.check(["Perché 😀 speling"]);
    expect(checks[0]).toMatchObject({
      language: "it",
      words: ["fubvault"],
      options: { grammar: true, ignore_uppercase: true, ignore_numbers: false, ignore_internet: true },
    });
    const issue = result!.segments[0][0];
    expect("Perché 😀 speling".slice(issue.start, issue.end)).toBe("speling");
    client.dispose();
  });

  it("segue la lingua dichiarata dal documento prima di quella delle impostazioni", async () => {
    const { ports, checks } = host();
    const client = new ProofClient(ports);
    await client.check(["testo"], "en-GB");
    expect(checks[0].language).toBe("en");
    client.dispose();
  });

  it("non richiede un segmento già controllato", async () => {
    const { ports, checks } = host();
    const client = new ProofClient(ports);
    await client.check(["uno speling", "due"]);
    await client.check(["uno speling", "tre"]);
    expect(checks.map((check) => check.segments)).toEqual([["uno speling", "due"], ["tre"]]);
    client.dispose();
  });

  it("dimentica tutto quando la configurazione cambia e avvisa chi segue", async () => {
    const { ports, checks, change } = host();
    const client = new ProofClient(ports);
    const listener = vi.fn();
    client.onChange(listener);
    await client.check(["uno"]);
    change();
    expect(listener).toHaveBeenCalledTimes(1);
    await client.check(["uno"]);
    expect(checks).toHaveLength(2);
    expect(ports.settings).toHaveBeenCalledTimes(2);
    client.dispose();
  });

  it("scarta una risposta arrivata dopo un cambio di configurazione", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const base = host();
    const { ports, change } = host({
      queryIndex: async (query) => {
        await gate;
        return base.ports.queryIndex(query);
      },
    });
    const client = new ProofClient(ports);
    const pending = client.check(["uno speling"]);
    await Promise.resolve();
    await Promise.resolve();
    change();
    release();
    expect(await pending).toBeNull();
    client.dispose();
  });

  it("tace senza la feature e non lancia", async () => {
    const queryIndex = vi.fn(async () => {
      throw { kind: "unserved", message: "namespace non montato" };
    });
    const { ports } = host({ queryIndex });
    const client = new ProofClient(ports);
    expect(await client.check(["uno"])).toBeNull();
    expect(await client.check(["due"])).toBeNull();
    expect(queryIndex).toHaveBeenCalledTimes(1);
    client.dispose();
  });

  it("tace quando il vault non ha le impostazioni del correttore", async () => {
    const { ports, checks } = host({ settings: async () => [] });
    const client = new ProofClient(ports);
    expect(await client.check(["uno"])).toBeNull();
    expect(checks).toHaveLength(0);
    client.dispose();
  });

  it("spezza le richieste entro i limiti della route", async () => {
    const { ports, checks } = host();
    const client = new ProofClient(ports);
    const segments = Array.from({ length: 600 }, (_, i) => `parola ${i}`);
    const result = await client.check(segments);
    expect(checks.map((check) => check.segments.length)).toEqual([512, 88]);
    expect(result!.segments).toHaveLength(600);
    client.dispose();
  });

  it("non chiede un segmento oltre il limite e lo risponde senza rilievi", async () => {
    const { ports, checks } = host();
    const client = new ProofClient(ports);
    const huge = "speling ".repeat(9000);
    const result = await client.check([huge, "corto"]);
    expect(checks[0].segments).toEqual(["corto"]);
    expect(result!.segments[0]).toEqual([]);
    client.dispose();
  });

  it("aggiunge una parola con il comando della feature", async () => {
    const { ports } = host();
    const client = new ProofClient(ports);
    expect(await client.addWord("Fubvault")).toBe("aggiunta");
    expect(ports.invokeCommand).toHaveBeenCalledWith("proof.word.add", { word: "Fubvault" });
    client.dispose();
  });

  it("smette di seguire la configurazione quando è chiuso", async () => {
    const { ports, change } = host();
    const client = new ProofClient(ports);
    const listener = vi.fn();
    client.onChange(listener);
    client.dispose();
    change();
    expect(listener).not.toHaveBeenCalled();
    expect(await client.check(["uno"])).toBeNull();
  });
});
