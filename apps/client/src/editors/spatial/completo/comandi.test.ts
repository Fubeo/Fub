// I comandi del Completo nel menu ≡ e nella ricerca Ctrl+/ (piano K6, T9a): le
// voci vengono dall'indice, col posto e il tasto; il motore dice quali valgono
// e perché le altre non valgono; il motore assente lo dice; un indice vuoto e
// uno che non arriva si vedono.
import { describe, expect, it, vi } from "vitest";
import type { DrawingCommandInfo } from "../../../host/contract";
import { displayBinding } from "../../../ui/commands";
import type { MenuItem } from "../../../ui/menu";
import type { MotoreDelDisegno } from "../motore/gesti";
import type { SessioneMotore } from "../motore/sessione";
import { menuComando, menuNonCaricato, nomeVoce, percorsoPosto, statoComandi, statoVoce, testoPerche, vociRicerca, type StatoComandi } from "./comandi";
import { indiceDi, type VoceIndice } from "./indice";
import { risolviTasti } from "./tasti";
import { t } from "../strings";

/// Una voce dell'indice, con i campi che le voci hanno sempre.
function voce(id: string, posto: string, over: Partial<VoceIndice> = {}): VoceIndice {
  return {
    fonte: "motore",
    id,
    chiamata: { comando: `disegno.${id}` },
    etichetta: { it: `Voce ${id}`, en: `Item ${id}` },
    posto,
    famiglia: "forme",
    tasto: null,
    effetto: "cambia",
    finestra: false,
    ...over,
  };
}

/// Lo stato dei comandi per una risposta del motore.
function valgono(...infos: DrawingCommandInfo[]): StatoComandi {
  return { per: new Map(infos.map((info) => [info.id, info])), assente: null };
}

const NESSUNO = (): void => undefined;

function trova(items: readonly MenuItem[], label: string): MenuItem {
  const hit = items.find((item) => item.label === label);
  if (hit === undefined) throw new Error(`manca la voce «${label}»`);
  return hit;
}

/// Le voci di un sottomenu, che il menu dà come elenco (non come funzione).
function sottovoci(item: MenuItem | undefined): readonly MenuItem[] {
  if (item?.items === undefined || typeof item.items === "function") return [];
  return item.items;
}

describe("menuComando", () => {
  it("raggruppa le voci per sottomenu, nell'ordine dell'indice, e lascia fuori i posti che non sono menu", () => {
    const indice = indiceDi({
      voci: [
        voce("a", "menu/oggetto"),
        voce("b", "menu/file"),
        voce("c", "menu/oggetto"),
        voce("d", "colonna/disegna"),
      ],
    });
    const menu = menuComando(indice, valgono({ id: "disegno.a", enabled: true, disabled_reason: null }, { id: "disegno.b", enabled: true, disabled_reason: null }, { id: "disegno.c", enabled: true, disabled_reason: null }), NESSUNO);
    expect(menu.map((item) => item.label)).toEqual(["Oggetto", "File"]);
    expect(sottovoci(trova(menu, "Oggetto")).map((item) => item.label)).toEqual(["Voce a", "Voce c"]);
  });

  it("una voce del terzo livello sta in un sottomenu dentro il sottomenu, al posto della sua prima voce", () => {
    const indice = indiceDi({
      voci: [
        voce("a", "menu/oggetto"),
        voce("b", "menu/oggetto/tracciato"),
        voce("c", "menu/oggetto"),
        voce("d", "menu/oggetto/tracciato"),
        voce("e", "menu/oggetto/sconosciuto"),
        voce("f", "menu/oggetto/tracciato/troppo"),
      ],
    });
    const stato = valgono(...["a", "b", "c", "d"].map((id) => ({ id: `disegno.${id}`, enabled: true, disabled_reason: null })));
    const oggetto = sottovoci(trova(menuComando(indice, stato, NESSUNO), "Oggetto"));
    expect(oggetto.map((item) => item.label)).toEqual(["Voce a", "Tracciato", "Voce c"]);
    const tracciato = trova(oggetto, "Tracciato");
    expect(tracciato.submenu).toBe(true);
    expect(sottovoci(tracciato).map((item) => item.label)).toEqual(["Voce b", "Voce d"]);
  });

  it("una voce spenta si vede col perché che il motore ha detto", () => {
    const indice = indiceDi({ voci: [voce("a", "menu/oggetto")] });
    const menu = menuComando(indice, valgono({ id: "disegno.a", enabled: false, disabled_reason: "needs_path" }), NESSUNO);
    const oggetto = sottovoci(trova(menu, "Oggetto"));
    expect(oggetto[0]).toMatchObject({ label: "Voce a", disabled: true, description: "Scegli un tracciato." });
  });

  it("la riga mostra il tasto che la regola dà al comando, scritto come Fub, e nessuno senza regola", () => {
    const indice = indiceDi({ voci: [voce("a", "menu/oggetto", { tasto: "Ctrl+J" })] });
    const stato = valgono({ id: "disegno.a", enabled: true, disabled_reason: null });
    const regola = risolviTasti([{ id: "a", tasto: "Ctrl+J" }], {}, "other");
    expect(sottovoci(trova(menuComando(indice, stato, NESSUNO, regola), "Oggetto"))[0]).toMatchObject({ hint: displayBinding("Ctrl-J"), disabled: false });
    expect(sottovoci(trova(menuComando(indice, stato, NESSUNO, null), "Oggetto"))[0]?.hint).toBeUndefined();
  });

  it("senza voci pronte il menu lo dice, come voce spenta", () => {
    const menu = menuComando(indiceDi({ voci: [] }), valgono(), NESSUNO);
    expect(menu).toEqual([{ label: "Nessun comando è ancora pronto in questo disegno.", disabled: true }]);
  });

  it("una voce parte con la sua voce: chi la esegue riceve la voce dell'indice", () => {
    const esegui = vi.fn();
    const v = voce("a", "menu/oggetto");
    const menu = menuComando(indiceDi({ voci: [v] }), valgono({ id: "disegno.a", enabled: true, disabled_reason: null }), esegui);
    trova(sottovoci(trova(menu, "Oggetto")), "Voce a").run?.();
    expect(esegui).toHaveBeenCalledWith(v);
  });
});

describe("menuNonCaricato", () => {
  it("dice che l'indice non si è caricato, con «Riprova» che lo chiede di nuovo", () => {
    const riprova = vi.fn();
    const menu = menuNonCaricato(riprova);
    expect(menu[0]).toMatchObject({ label: "Il catalogo dei comandi non si è caricato.", disabled: true });
    expect(menu[1]?.label).toBe("Riprova");
    menu[1]?.run?.();
    expect(riprova).toHaveBeenCalledTimes(1);
  });
});

describe("statoVoce e testoPerche", () => {
  it("le ragioni tipate del motore hanno il loro testo, e quella libera passa com'è", () => {
    expect(testoPerche("no_selection")).toBe("Scegli un oggetto.");
    expect(testoPerche("read_only")).toBe("Il disegno è di sola lettura, o un oggetto scelto è bloccato.");
    expect(testoPerche({ other: { text: "il livello è bloccato" } })).toBe("il livello è bloccato");
    expect(testoPerche(null)).toBe("Non vale adesso.");
  });

  it("un comando che il motore non elenca non è collegato, e lo dice", () => {
    expect(statoVoce(voce("a", "menu/oggetto"), valgono())).toEqual({ disabled: true, perche: "Non ancora collegato." });
  });

  it("col motore spento le voci del motore sono spente, col perché del motore", () => {
    const spento: StatoComandi = { per: null, assente: "spento" };
    expect(statoVoce(voce("a", "menu/oggetto"), spento)).toEqual({ disabled: true, perche: "Motore del disegno spento." });
  });

  it("uno strumento lo sceglie l'editor, e vale sempre; una voce del client non è collegata", () => {
    const strumento = voce("rect", "colonna/forme", { fonte: "strumento", chiamata: { strumento: "rect" } });
    expect(statoVoce(strumento, valgono())).toEqual({ disabled: false });
    const client = voce("x", "tavolozza", { fonte: "interfaccia", chiamata: { client: "x" } });
    expect(statoVoce(client, valgono()).disabled).toBe(true);
  });

  it("una voce del client vale se l'editor la fa, spenta col suo perché se la dice spenta", () => {
    const stato: StatoComandi = {
      per: null,
      assente: null,
      clientVoce: (id) => (id === "view.zoomIn" ? null : id === "info" ? "Si vede già." : undefined),
    };
    const zoom = voce("view.zoomIn", "banda", { fonte: "interfaccia", chiamata: { client: "view.zoomIn" } });
    expect(statoVoce(zoom, stato)).toEqual({ disabled: false });
    const info = voce("info", "banda", { fonte: "pannello", chiamata: { client: "info" } });
    expect(statoVoce(info, stato)).toEqual({ disabled: true, perche: "Si vede già." });
    const altra = voce("tool.select", "colonna", { fonte: "interfaccia", chiamata: { client: "tool.select" } });
    expect(statoVoce(altra, stato)).toEqual({ disabled: true, perche: "Non ancora collegato." });
  });
});

describe("le voci del client con la spunta (K6 T11, giro E)", () => {
  it("in ≡ › Visualizza una voce del client con la spunta mostra lo stato della superficie", () => {
    const grid = voce("view.grid", "menu/visualizza", { fonte: "interfaccia", chiamata: { client: "view.grid" } });
    const stato: StatoComandi = {
      per: null,
      assente: null,
      clientVoce: () => null,
      clientStato: (id) => (id === "view.grid" ? true : undefined),
    };
    const menu = menuComando(indiceDi({ voci: [grid] }), stato, vi.fn());
    const righe = menu[0]!.items as readonly MenuItem[];
    expect(righe[0]).toMatchObject({ choice: "checkbox", checked: true, disabled: false });
  });

  it("≡ › Visualizza ha le sue file: griglia e aggancio, contorno e righelli, rotazione", () => {
    const client = (id: string) => voce(id, "menu/visualizza", { fonte: "interfaccia", chiamata: { client: id } });
    // L'indice le dà in ordine di id, e una voce che nessuna fila nomina va in fondo.
    const voci = ["view.altro", "view.grid", "view.outline", "view.rotateReset", "view.rulers", "view.snapToGrid"].map(client);
    const stato: StatoComandi = { per: null, assente: null, clientVoce: () => null, clientStato: () => undefined };
    const righe = menuComando(indiceDi({ voci }), stato, vi.fn())[0]!.items as readonly MenuItem[];
    const nome = (id: string) => nomeVoce(voci.find((v) => v.id === id)!);
    expect(righe.map((r) => [r.label, r.separator === true])).toEqual([
      [nome("view.grid"), false],
      [nome("view.snapToGrid"), false],
      [nome("view.outline"), true],
      [nome("view.rulers"), false],
      [nome("view.rotateReset"), true],
      [nome("view.altro"), true],
    ]);
  });

  it("≡ › Oggetto › Tracciato ha le sue file: il tracciato intero, il composto, la precisione, la penna intelligente", () => {
    // L'indice le dà in ordine di id.
    const ids = [
      "addon.pathtools.close",
      "addon.pathtools.smooth",
      "addon.pen.closeJoin",
      "object.compoundPath.make",
      "object.compoundPath.release",
      "path.join",
      "path.reverse",
    ];
    const voci = ids.map((id) => voce(id, "menu/oggetto/tracciato"));
    const righe = sottovoci(sottovoci(menuComando(indiceDi({ voci }), { per: null, assente: null }, vi.fn())[0])[0]);
    const nome = (id: string) => nomeVoce(voci.find((v) => v.id === id)!);
    expect(righe.map((r) => [r.label, r.separator === true])).toEqual([
      [nome("path.join"), false],
      [nome("path.reverse"), false],
      [t("draw.completo.sotto.composto"), true],
      [nome("addon.pathtools.smooth"), true],
      [nome("addon.pathtools.close"), false],
      [nome("addon.pen.closeJoin"), true],
    ]);
    // Crea e Rilascia stanno nel sottomenu «Tracciato composto», col loro stato.
    const composto = sottovoci(righe[2]);
    expect(composto.map((r) => r.label)).toEqual([nome("object.compoundPath.make"), nome("object.compoundPath.release")]);
    expect(composto.every((r) => r.disabled === true)).toBe(true);
  });

  it("≡ › Modifica › Modifica colori ha le sue file: le regolazioni, le fusioni, le conversioni, Inverti e Sovrastampa", () => {
    // L'indice le dà in ordine di id.
    const ids = [
      "edit.colors.adjustBalance",
      "edit.colors.blendFrontToBack",
      "edit.colors.blendHorizontally",
      "edit.colors.blendVertically",
      "edit.colors.invert",
      "edit.colors.overprintBlack",
      "edit.colors.saturate",
      "edit.colors.toCMYK",
      "edit.colors.toGrayscale",
      "edit.colors.toRGB",
    ];
    const voci = ids.map((id) => voce(id, "menu/modifica/colori"));
    const righe = sottovoci(sottovoci(menuComando(indiceDi({ voci }), { per: null, assente: null }, vi.fn())[0])[0]);
    const nome = (id: string) => nomeVoce(voci.find((v) => v.id === id)!);
    expect(righe.map((r) => [r.label, r.separator === true])).toEqual([
      [nome("edit.colors.adjustBalance"), false],
      [nome("edit.colors.saturate"), false],
      [nome("edit.colors.blendFrontToBack"), true],
      [nome("edit.colors.blendHorizontally"), false],
      [nome("edit.colors.blendVertically"), false],
      [nome("edit.colors.toCMYK"), true],
      [nome("edit.colors.toGrayscale"), false],
      [nome("edit.colors.toRGB"), false],
      [nome("edit.colors.invert"), true],
      [nome("edit.colors.overprintBlack"), false],
    ]);
  });

  it("un sottomenu senza file tiene l'ordine dell'indice, senza separazioni", () => {
    const voci = ["object.b", "object.a"].map((id) => voce(id, "menu/oggetto"));
    const stato: StatoComandi = { per: null, assente: null };
    const righe = menuComando(indiceDi({ voci }), stato, vi.fn())[0]!.items as readonly MenuItem[];
    expect(righe.map((r) => r.separator)).toEqual([undefined, undefined]);
    expect(righe.map((r) => r.label)).toEqual(voci.map(nomeVoce));
  });

  it("una voce del client senza spunta resta una voce semplice", () => {
    const rotazione = voce("view.rotateReset", "menu/visualizza", { fonte: "interfaccia", chiamata: { client: "view.rotateReset" } });
    const stato: StatoComandi = { per: null, assente: null, clientVoce: () => "La vista non è girata.", clientStato: () => undefined };
    const menu = menuComando(indiceDi({ voci: [rotazione] }), stato, vi.fn());
    const riga = (menu[0]!.items as readonly MenuItem[])[0]!;
    expect(riga.choice).toBeUndefined();
    expect(riga.disabled).toBe(true);
    expect(riga.description).toBe("La vista non è girata.");
  });
});

describe("statoComandi", () => {
  /// Un motore finto: la sessione, o il suo stato di apertura.
  function motore(over: Partial<Pick<MotoreDelDisegno, "adesso" | "pronta" | "assente">>): MotoreDelDisegno {
    return { adesso: () => null, pronta: () => Promise.resolve(null), assente: () => null, ...over } as unknown as MotoreDelDisegno;
  }
  function sessione(comandi: SessioneMotore["comandi"]): SessioneMotore {
    return { comandi } as unknown as SessioneMotore;
  }

  it("senza motore il Completo dice che è spento", async () => {
    expect(await statoComandi(null, [])).toEqual({ per: null, assente: "spento" });
  });

  it("legge ciò che il motore dice per la selezione", async () => {
    const info: DrawingCommandInfo = { id: "disegno.a", enabled: false, disabled_reason: "no_selection" };
    const stato = await statoComandi(motore({ adesso: () => sessione(() => Promise.resolve([info])) }), ["k1"]);
    expect(stato.per?.get("disegno.a")).toEqual(info);
    expect(stato.assente).toBeNull();
  });

  it("se la sessione si sta aprendo aspetta quella aperta", async () => {
    const aperta = sessione(() => Promise.resolve([]));
    const stato = await statoComandi(motore({ adesso: () => "apertura", pronta: () => Promise.resolve(aperta) }), []);
    expect(stato.per).toEqual(new Map());
  });

  it("un motore che non risponde è assente, col perché", async () => {
    const stato = await statoComandi(motore({ adesso: () => sessione(() => Promise.reject(new Error("tempo"))) }), []);
    expect(stato).toEqual({ per: null, assente: "errore" });
  });
});

describe("percorsoPosto", () => {
  it("il posto è un percorso leggibile, senza il menu di testa", () => {
    expect(percorsoPosto("menu/oggetto")).toBe("Oggetto");
    expect(percorsoPosto("colonna/disegna")).toBe("Colonna › Disegna");
    expect(percorsoPosto("ispettore/design/documento")).toBe("Ispettore › Design › Documento");
    expect(percorsoPosto("tavolozza")).toBe("Tavolozza");
    // Il terzo livello di ≡: il percorso intero.
    expect(percorsoPosto("menu/oggetto/tracciato")).toBe("Oggetto › Tracciato");
    expect(percorsoPosto("menu/selezione/uguale")).toBe("Selezione › Simili");
  });
});

describe("vociRicerca", () => {
  it("ogni voce dell'indice ha il suo posto, il tasto, il perché e i nomi nelle due lingue", () => {
    const indice = indiceDi({
      voci: [
        voce("a", "menu/oggetto", { tasto: "Ctrl+J" }),
        voce("b", "tavolozza"),
      ],
    });
    const regola = risolviTasti([{ id: "a", tasto: "Ctrl+J" }, { id: "b", tasto: null }], {}, "other");
    const righe = vociRicerca(indice, valgono({ id: "disegno.a", enabled: true, disabled_reason: null }, { id: "disegno.b", enabled: false, disabled_reason: "needs_two" }), NESSUNO, regola);
    expect(righe[0]).toMatchObject({ key: "a", label: "Voce a", path: "Oggetto", hint: displayBinding("Ctrl-J"), disabled: false, altreLingue: ["Voce a", "Item a"] });
    expect(righe[1]).toMatchObject({ key: "b", path: "Tavolozza", disabled: true, description: "Servono due oggetti." });
  });

  it("una voce spenta non parte col suo run se la si sceglie", () => {
    const esegui = vi.fn();
    const indice = indiceDi({ voci: [voce("b", "tavolozza")] });
    const [riga] = vociRicerca(indice, valgono({ id: "disegno.b", enabled: false, disabled_reason: "needs_two" }), esegui);
    riga?.run();
    expect(esegui).toHaveBeenCalledTimes(1);
  });

  it("le letture interne (posto «interno») non sono voci per chi cerca", () => {
    const indice = indiceDi({ voci: [voce("a", "menu/oggetto"), voce("lettura", "interno"), voce("b", "tavolozza")] });
    const righe = vociRicerca(indice, valgono(), NESSUNO);
    expect(righe.map((riga) => riga.key)).toEqual(["a", "b"]);
  });
});

