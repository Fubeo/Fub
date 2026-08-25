// @vitest-environment happy-dom
//
// Il presidio di accessibilità dei pannelli (§12.4), e la metà che la
// [decisione 0014](../../../docs/decisions/0197-documentazione-presente-git-storia.md)
// chiede insieme alla passata: *una promessa senza presidio meccanico decade*.
//
// Decadrebbe alla prima view nuova, e in silenzio — un pannello che dimentica
// un nome accessibile funziona benissimo per chi lo guarda. Questo file lo
// rende rosso.
//
// # Cosa presidia, e su cosa
//
// Su due cose, che sono le due sorgenti di pannelli che questa shell ha:
//
// 1. **Gli alberi dichiarativi** (`ui/node.ts`), cioè ciò che disegnano le view
//    del backend e — a M5 — i plugin. Il campione non è scritto a mano: è la
//    **fixture del mirror** (`__fixtures__/mirror-samples.json`), che Rust
//    genera con un `match` senza `_`. Il che vuol dire che una specie di nodo
//    nuova arriva qui **da sola**: chi la aggiunge in Rust rigenera la fixture,
//    e se il renderer la disegna senza nome accessibile questo test è rosso
//    prima che il nodo abbia un cliente.
// 2. **La scocca statica della shell** (`index.html`): la topbar, la sidebar,
//    la barra di stato, le tre modali.
//
// Il DOM è `happy-dom` e non il browser vero, ed è il motivo per cui le regole
// del checker sono strutturali (il ragionamento lungo sta in `a11y-check.ts`).
// Il contrasto, che senza layout non si potrebbe decidere, ha il presidio suo
// in `theme/contrast.test.ts`.
import { beforeEach, describe, expect, it } from "vitest";

import html from "../../index.html?raw";
import samples from "../__fixtures__/mirror-samples.json";
import type { UiNode } from "../host/contract";
import css from "../theme/serie/skin.css?raw";
import { accessibleName, formatIssues, checkAccessibility } from "./a11y-check";
import { activatable, trapFocus, notActivatable } from "./a11y";
import { mountTree } from "./node";

const nodes = samples.UiNode as unknown as UiNode[];

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("il checker sa trovare i difetti che cerca", () => {
  // Un presidio che passa sempre non presidia niente. Prima di fidarsi dei
  // verdetti verdi qui sotto, si guarda che il setaccio abbia dei buchi della
  // misura giusta: ogni regola viene fatta scattare apposta.
  it("vede un comando senza nome", () => {
    document.body.innerHTML = `<button></button>`;
    expect(checkAccessibility(document).map((p) => p.rule)).toContain("comando senza nome");
  });

  it("vede un campo senza nome, e non si fa ingannare da un segnaposto", () => {
    document.body.innerHTML = `<input placeholder="Cerca…" />`;
    expect(checkAccessibility(document).map((p) => p.rule)).toContain("campo senza nome");
  });

  it("vede una riga cliccabile che il tab non raggiunge", () => {
    document.body.innerHTML = `<div class="clickable">Apri</div>`;
    expect(checkAccessibility(document).map((p) => p.rule)).toContain(
      "cliccabile ma irraggiungibile",
    );
  });

  it("vede un tabindex positivo", () => {
    document.body.innerHTML = `<button tabindex="3">Vai</button>`;
    expect(checkAccessibility(document).map((p) => p.rule)).toContain("tabindex positivo");
  });

  it("vede un aria-labelledby che punta nel vuoto", () => {
    document.body.innerHTML = `<div role="dialog" aria-labelledby="non-esiste">x</div>`;
    expect(checkAccessibility(document).map((p) => p.rule)).toContain("riferimento nel vuoto");
  });

  it("vede un frame senza titolo", () => {
    document.body.innerHTML = `<iframe src="https://esempio.test"></iframe>`;
    expect(checkAccessibility(document).map((p) => p.rule)).toContain("frame senza titolo");
  });

  it("e tace su ciò che è a posto", () => {
    document.body.innerHTML = `
      <button>Salva</button>
      <label for="q">Cerca</label><input id="q" />
      <div class="clickable" role="button" tabindex="0">Apri</div>
      <div role="dialog" aria-label="Impostazioni"></div>`;
    expect(checkAccessibility(document)).toEqual([]);
  });
});

describe("il nome accessibile", () => {
  it("preferisce l'etichetta al testo, e l'etichetta legata a quella che avvolge", () => {
    document.body.innerHTML = `
      <span id="etichetta">Titolo vero</span>
      <button aria-labelledby="etichetta">testo interno</button>`;
    const button = document.querySelector("button")!;
    expect(accessibleName(button)).toBe("Titolo vero");
  });

  it("trova la `<label for>` di un campo, che è il caso che il renderer produce", () => {
    document.body.innerHTML = `<label for="c" class="ui-field-label">Titolo</label><input id="c" />`;
    expect(accessibleName(document.querySelector("input")!)).toBe("Titolo");
  });

  it("non prende il contenuto di un campo per il suo nome", () => {
    // Un `<input>` non ha contenuto testuale, e se qualcuno gliene mettesse non
    // sarebbe il suo nome: senza questa distinzione la regola 2 passerebbe a
    // vuoto su metà dei campi.
    document.body.innerHTML = `<input value="scritto dall'utente" />`;
    expect(accessibleName(document.querySelector("input")!)).toBe("");
  });
});

describe("i pannelli dichiarativi (§2.1) sono accessibili", () => {
  it("il campione del mirror copre ogni specie di nodo", () => {
    // La garanzia sta in Rust (un `match` senza `_` in `ts_mirror.rs`); qui si
    // controlla solo che la fixture sia arrivata e non sia vuota, perché un
    // presidio che gira su zero nodi passa e non dice niente.
    expect(nodes.length).toBeGreaterThan(25);
  });

  it("nessuna specie di nodo disegna un comando o un campo senza nome", () => {
    // Ogni nodo nel suo contenitore: alcuni sono `<tr>` o `<td>`, che fuori da
    // una tabella il DOM riparenta — e un nodo riparentato non è più quello che
    // il renderer ha prodotto.
    const errors = nodes.flatMap((node) => {
      const host = document.createElement("div");
      document.body.appendChild(host);
      mountTree(host, node, async () => {});
      return checkAccessibility(host).map((p) => ({ ...p, where: `${node.node}: ${p.where}` }));
    });
    expect(
      errors,
      `il renderer dichiarativo produce nodes che chi non vede non può usare:\n${formatIssues(errors)}`,
    ).toEqual([]);
  });

  it("un nodo con azione si attiva da tastiera, e uno senza non resta nel giro del tab", () => {
    // La regola che vale per **tutti** i pannelli futuri, provata sul giro
    // completo: un elemento riusato dal riconciliatore (§2.8) che perde
    // l'azione deve anche uscire dall'ordine di lettura, o diventa un vicolo
    // cieco che il tab attraversa senza motivo.
    const host = document.createElement("div");
    document.body.appendChild(host);
    mountTree(
      host,
      { node: "list_item", title: "Una nota", subtitle: null, selected: false, action: { action: "apri", payload: null } } as unknown as UiNode,
      async () => {},
    );
    const entry = host.querySelector<HTMLElement>(".ui-list-item")!;
    expect(entry.getAttribute("tabindex")).toBe("0");

    mountTree(
      host,
      { node: "list_item", title: "Una nota", subtitle: null, selected: false, action: null } as unknown as UiNode,
      async () => {},
    );
    expect(host.querySelector<HTMLElement>(".ui-list-item")!.hasAttribute("tabindex")).toBe(false);
  });

  it("Invio e barra attivano ciò che il click attiva", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    let pressed = 0;
    el.addEventListener("click", () => (pressed += 1));
    activatable(el);

    for (const key of ["Enter", " "]) {
      el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    }
    expect(pressed, "Invio e barra devono valere quanto un click").toBe(2);

    // E un tasto qualsiasi no, o scrivere dentro un pannello lo attiverebbe.
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    expect(pressed).toBe(2);
  });

  it("togliere l'azione toglie anche il ruolo che l'azione aveva messo", () => {
    const el = document.createElement("div");
    activatable(el);
    expect(el.getAttribute("role")).toBe("button");
    notActivatable(el);
    expect(el.getAttribute("role")).toBe(null);
  });

  it("non tocca ciò che è già interattivo", () => {
    // Un `<button>` è già un pulsante: aggiungergli `role="button"` non aggiunge
    // niente e crea una seconda verità da tenere allineata.
    const b = document.createElement("button");
    activatable(b);
    expect(b.hasAttribute("role")).toBe(false);
    expect(b.hasAttribute("tabindex")).toBe(false);
  });
});

describe("la scocca della shell è accessibile", () => {
  it("index.html non ha comandi senza nome, campi senza nome o riferimenti nel vuoto", () => {
    document.documentElement.innerHTML = html
      .replace(/^[\s\S]*?<body>/, "<body>")
      .replace(/<\/body>[\s\S]*$/, "</body>");
    const errors = checkAccessibility(document);
    expect(
      errors,
      `la scocca della shell ha dei buchi:\n${formatIssues(errors)}`,
    ).toEqual([]);
  });

  it("e il rilevatore stava davvero guardando quel documento", () => {
    // La prova che il test sopra non passa perché il documento è vuoto — che è
    // esattamente il modo in cui un presidio su HTML letto come testo smette di
    // presidiare senza dirlo.
    document.documentElement.innerHTML = html
      .replace(/^[\s\S]*?<body>/, "<body>")
      .replace(/<\/body>[\s\S]*$/, "</body>");
    expect(document.querySelectorAll("button").length).toBeGreaterThan(8);
    expect(document.querySelector(".skip-link"), "manca il salto al contenuto").not.toBe(null);
    expect(document.querySelector("#views-modal")?.getAttribute("aria-modal")).toBe("true");
  });
});

describe("una modale non lascia uscire il fuoco", () => {
  it("Escape chiude, e il fuoco torna da dove era partito", () => {
    document.body.innerHTML = `
      <button id="fuori">Apri</button>
      <div id="modale" tabindex="-1"><button id="dentro">Ok</button></div>`;
    const outside = document.querySelector<HTMLElement>("#fuori")!;
    const modal = document.querySelector<HTMLElement>("#modale")!;
    outside.focus();

    let closed = 0;
    const releaseTrap = trapFocus(modal, () => {
      closed += 1;
      releaseTrap();
    });
    expect(document.activeElement?.id, "il fuoco entra nella modale").toBe("dentro");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(closed).toBe(1);
    expect(document.activeElement?.id, "e torna da dove era partito").toBe("fuori");
  });

  it("il tab non esce dalla modale", () => {
    document.body.innerHTML = `
      <button id="fuori">Apri</button>
      <div id="modale" tabindex="-1"><button id="a">A</button><button id="b">B</button></div>`;
    const modal = document.querySelector<HTMLElement>("#modale")!;
    const releaseTrap = trapFocus(modal, () => {});

    // Dall'ultimo elemento in avanti si torna al primo, invece di finire sulla
    // UI di sotto — che è ancora lì e non è più quella che si sta guardando.
    document.querySelector<HTMLElement>("#b")!.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(document.activeElement?.id).toBe("a");

    // E indietro dal primo si va all'ultimo.
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }));
    expect(document.activeElement?.id).toBe("b");
    releaseTrap();
  });
});

describe("due modali aperte: comanda l'ultima", () => {
  /// Due superfici che intrappolano il fuoco insieme — la palette aperta con la
  /// sua scorciatoia mentre la modale delle view è già lì, un selettore di icona
  /// aperto da un menu contestuale — e la domanda è quale delle due prende il
  /// tasto. Prima lo prendevano **tutte e due**: gli ascoltatori stanno su
  /// `document` in cattura, quindi partivano nell'ordine in cui erano stati
  /// attaccati e a vincere era la più vecchia, cioè quella dipinta sotto
  /// (difetto 0149).
  function openTwo() {
    document.body.innerHTML = `
      <button id="fuori">Apri</button>
      <div id="sotto" tabindex="-1"><button id="s1">S1</button><button id="s2">S2</button></div>
      <div id="sopra" tabindex="-1"><button id="p1">P1</button><button id="p2">P2</button></div>`;
    const counts = { below: 0, above: 0 };
    const releaseBelow = trapFocus(document.querySelector<HTMLElement>("#sotto")!, () => {
      counts.below += 1;
    });
    const releaseAbove = trapFocus(document.querySelector<HTMLElement>("#sopra")!, () => {
      counts.above += 1;
    });
    return { counts, releaseBelow, releaseAbove };
  }

  it("il tab non passa nemmeno per la superficie di sotto", () => {
    const { releaseBelow, releaseAbove } = openTwo();
    expect(document.activeElement?.id, "il fuoco entra nell'ultima aperta").toBe("p1");

    // Dove il fuoco è *passato*, non solo dove si è fermato: con due trappole
    // che si sentono lo stesso tasto il giro finiva comunque al posto giusto —
    // per un pelo, perché l'ultima attaccata parla per ultima — ma la prima nel
    // frattempo aveva tirato il fuoco dentro di sé, e un `focus` sulla
    // superficie di sotto è un evento che qualcuno riceve: la riga che si apre,
    // il pannello che si ridisegna, il lettore di schermo che annuncia una cosa
    // che non si sta guardando.
    const focusSequence: string[] = [];
    for (const id of ["s1", "s2"]) {
      document
        .querySelector<HTMLElement>(`#${id}`)!
        .addEventListener("focus", () => focusSequence.push(id));
    }

    document.querySelector<HTMLElement>("#p2")!.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(document.activeElement?.id, "il giro si chiude dentro quella sopra").toBe("p1");
    expect(
      focusSequence,
      "il tab ha toccato la superficie di sotto: comanda anche chi si è aperto " +
        "prima, e il fuoco attraversa una superficie che sullo schermo sta sotto " +
        "un'altra",
    ).toEqual([]);

    releaseAbove();
    releaseBelow();
  });

  it("Escape ne chiude una sola, e quella sotto torna a comandare", () => {
    const { counts, releaseBelow, releaseAbove } = openTwo();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(
      [counts.above, counts.below],
      "un solo Escape ha chiuso due superfici: le trappole aperte si sentono " +
        "tutte lo stesso tasto",
    ).toEqual([1, 0]);

    // Chi ha chiesto la chiusura è chi la esegue: qui lo fa il banco, come lo
    // farebbe il pannello che l'ha aperta.
    releaseAbove();
    document.querySelector<HTMLElement>("#s2")!.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(document.activeElement?.id, "chiusa quella sopra, comanda di nuovo quella sotto").toBe(
      "s1",
    );

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(counts.below, "e adesso Escape è suo").toBe(1);
    releaseBelow();
  });

  it("una che si chiude fuori ordine non lascia a comandare un fantasma", () => {
    // Le superfici non si chiudono per forza in ordine: quella di sotto può
    // andarsene per conto suo — un comando, un documento che sparisce — mentre
    // sopra ce n'è ancora una.
    const { counts, releaseBelow, releaseAbove } = openTwo();
    releaseBelow();

    document.querySelector<HTMLElement>("#p2")!.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(document.activeElement?.id, "quella rimasta comanda ancora").toBe("p1");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(counts.above).toBe(1);
    releaseAbove();
  });
});

describe("i piani di chi intrappola il fuoco", () => {
  /// La metà dipinta della stessa regola. Il tasto lo dà `trapFocus`
  /// all'ultima aperta, ma se quell'ultima è dipinta sotto un'altra superficie
  /// modale il tasto arriva dove l'occhio non è: le due superfici a tutto schermo
  /// che intrappolano il fuoco — `.modale` (palette, ricerca nella nota, quick
  /// switcher) e `.views-modal` — stanno quindi sullo **stesso** piano, e fra
  /// due dello stesso piano decide l'ordine nel DOM, che è di nuovo l'ordine di
  /// apertura (difetto 0149).
  function layerOf(selector: string): string | null {
    // I commenti via per primi, e non dentro il selettore: una virgola dentro un
    // commento spezzerebbe l'elenco dei selettori prima di poterlo pulire.
    const cssWithoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const blocks = [...cssWithoutComments.matchAll(/([^{}]+)\{([^}]*)\}/g)];
    for (const block of blocks.reverse()) {
      const selectors = block[1].split(",").map((s) => s.trim());
      if (!selectors.includes(selector)) continue;
      const z = /z-index\s*:\s*var\(\s*(--[\w-]+)\s*\)/.exec(block[2]);
      if (z) return z[1]!;
    }
    return null;
  }

  it("le superfici che intrappolano il fuoco stanno sul piano delle modali", () => {
    expect(
      [layerOf(".modale"), layerOf(".views-modal")],
      "una superficie che intrappola il fuoco è dipinta sotto un'altra: chi " +
        "prende il tasto non è chi si vede, e chi naviga da tastiera scrive " +
        "dentro qualcosa che sullo schermo sta sotto",
    ).toEqual(["--z-modal", "--z-modal"]);
  });
});
