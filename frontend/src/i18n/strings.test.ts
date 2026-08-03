// @vitest-environment happy-dom
//
// Il presidio del catalogo della shell (§12.4).
//
// `strings.ts` si difende da sé per metà: `Chiave` è l'unione delle chiavi del
// catalogo italiano, e l'inglese è un `Record<Chiave, string>` — **una chiave
// dimenticata in inglese non compila**. Quella metà non ha bisogno di un test,
// e scriverglielo sarebbe scrivere un test al compilatore.
//
// Qui c'è l'altra metà, che è tutta fuori dalla portata dei tipi:
//
// 1. **Il testo fermo di `index.html`**, che nomina le chiavi dentro un
//    attributo. Per TypeScript è una stringa dentro un file che non guarda:
//    un `data-i18n="app.chiudi"` scritto male non è un errore, è un pulsante
//    che a runtime si chiama «app.chiudi».
// 2. **Gli argomenti dei template**, che devono essere gli stessi in ogni
//    lingua. Un `{count}` diventato `{n}` traducendo non rompe niente e non lo
//    dice nessuno: la frase inglese mostra `{n}` a chi la legge, e il tipo è
//    soddisfatto perché una stringa è una stringa.
// 3. **La scala di ripiego**, che è la stessa del contratto (decisione 0040) e
//    per una ragione: due scale diverse vorrebbero dire una stringa della shell
//    e una di un provider in due lingue diverse sullo stesso schermo.
// 4. **Le chiavi morte**, che sono il modo in cui un catalogo marcisce: si
//    riscrive un pannello, la chiave resta, e la si traduce per anni.
import { describe, expect, it } from "vitest";
import html from "../../index.html?raw";
import { applicaStringhe, catalogoPer, espandi, linguaEffettiva, t } from "./strings";

/// Gli attributi con cui `index.html` nomina una chiave. Lo stesso elenco sta
/// in `strings.ts`, come `CHIAVE_TEMA` sta in due posti e per la stessa
/// ragione: qui serve per **leggere l'HTML**, e importare quella tabella
/// vorrebbe dire presidiare un elenco con se stesso.
const ATTRIBUTI = ["data-i18n", "data-i18n-title", "data-i18n-placeholder", "data-i18n-label"];

const IT = catalogoPer("it");
const EN = catalogoPer("en");

/// `index.html` come documento, e non come testo.
///
/// La differenza non è di stile: la prima stesura di questo presidio cercava
/// `data-i18n="…">testo<` con un'espressione regolare, e ne trovava **dodici**
/// su venticinque — tutte e sole quelle in cui l'attributo era l'ultimo prima
/// del `>`. Le altre tredici (quelle con anche un `data-i18n-title`, cioè
/// quasi tutti i pulsanti) non erano presidiate, e il test passava lo stesso.
/// Un parser HTML non ha opinioni sull'ordine degli attributi.
const documento = new DOMParser().parseFromString(html, "text/html");

/// Le chiavi che `index.html` nomina, con l'attributo da cui vengono: l'origine
/// serve al messaggio d'errore, che altrimenti direbbe «manca una chiave» senza
/// dire dove cercarla.
function chiaviDellHtml(): Array<{ chiave: string; attributo: string }> {
  const trovate: Array<{ chiave: string; attributo: string }> = [];
  for (const attributo of ATTRIBUTI) {
    for (const el of documento.querySelectorAll(`[${attributo}]`)) {
      trovate.push({ chiave: el.getAttribute(attributo)!, attributo });
    }
  }
  return trovate;
}

/// I nomi fra graffe di un template, come li vede `espandi`.
function argomenti(template: string): string[] {
  return [...template.matchAll(/\{\{|\}\}|\{(\w+)\}/g)]
    .map((m) => m[1])
    .filter((n): n is string => n !== undefined)
    .sort();
}

describe("il testo fermo di index.html", () => {
  it("nomina solo chiavi che esistono", () => {
    // Il caso che questo presidio esiste per prendere: una chiave rinominata
    // nel catalogo e non nell'HTML. Non è un errore di compilazione, non è un
    // errore a runtime, ed è una parola che nell'interfaccia diventa
    // «trash.svuota» — visibile solo a chi apre quel pannello in quella lingua.
    const mancanti = chiaviDellHtml().filter(({ chiave }) => !(chiave in IT));
    expect(
      mancanti,
      `chiavi nominate da index.html e assenti dal catalogo:\n${mancanti
        .map((m) => `  ${m.attributo}="${m.chiave}"`)
        .join("\n")}`,
    ).toEqual([]);
  });

  it("ne nomina abbastanza da far fallire questo presidio se il glob si rompe", () => {
    // La guardia contro il presidio che passa **a vuoto**: se un giorno
    // `?raw` restituisse la stringa vuota — è già successo coi CSS, ed è la
    // ragione del `css: true` in `vite.config.ts` — il test qui sopra
    // cercherebbe chiavi dentro zero caratteri, non ne troverebbe nessuna, e
    // direbbe che va tutto bene.
    expect(chiaviDellHtml().length).toBeGreaterThan(30);
  });

  it("il testo scritto nell'HTML è già la lingua di ripiego", () => {
    // `applicaStringhe` gira al montaggio, non prima: ciò che si vede nel
    // frattempo — e ciò che si vede se non gira affatto — è il testo scritto a
    // mano nel file. Deve essere l'italiano del catalogo, o l'HTML è un secondo
    // catalogo che nessuno aggiorna, che è il difetto che questa voce è venuta
    // a togliere e non ad aggiungere.
    const elementi = [...documento.querySelectorAll("[data-i18n]")];
    expect(elementi.length, "l'HTML non nomina più nessuna chiave: il `?raw` legge ancora?").toBe(
      21,
    );
    for (const el of elementi) {
      const chiave = el.getAttribute("data-i18n")!;
      expect(
        el.textContent?.trim(),
        `il testo fermo di «${chiave}» non è quello del catalogo italiano`,
      ).toBe(IT[chiave]);
    }
  });

  it("e lo stesso vale per i tre attributi", () => {
    // Un `title` scritto a mano che dice una cosa e un catalogo che ne dice
    // un'altra è la stessa divergenza, meno visibile: nessuno rilegge i
    // `title`.
    for (const [attributo, dove] of [
      ["data-i18n-title", "title"],
      ["data-i18n-placeholder", "placeholder"],
      ["data-i18n-label", "aria-label"],
    ] as const) {
      for (const el of documento.querySelectorAll(`[${attributo}]`)) {
        const chiave = el.getAttribute(attributo)!;
        const scritto = el.getAttribute(dove);
        // L'attributo scritto a mano è **facoltativo**: `applicaStringhe` lo
        // mette lei. Ma se c'è, deve dire ciò che dice il catalogo.
        if (scritto === null) continue;
        expect(scritto, `il ${dove} fermo di «${chiave}» non è quello del catalogo`).toBe(
          IT[chiave],
        );
      }
    }
  });
});

/// Tutto il sorgente della shell, come testo. Serve alla sola domanda che non
/// si può fare né ai tipi né al DOM: **questa chiave la nomina qualcuno?**
const sorgenti: string = Object.values(
  import.meta.glob("../**/*.ts", { query: "?raw", import: "default", eager: true }),
).join("\n");

describe("il catalogo non marcisce", () => {
  it("ogni chiave è nominata da qualcuno", () => {
    // Come marcisce un catalogo: si riscrive un pannello, la chiave resta, e la
    // si traduce per anni in ogni lingua che arriva. Il tipo non la vede
    // (esiste, quindi è valida) e nemmeno l'HTML (non la nomina più nessuno).
    //
    // È una ricerca testuale, e la sua condizione per funzionare è che le
    // chiavi si scrivano **come stringhe letterali** — mai composte
    // (`` `palette.reach.${x}` ``). È anche la ragione per cui `REACH_KEYS` in
    // `ui/palette.ts` è una tabella di chiavi scritte per esteso: una chiave
    // che si compone è una chiave che nessun presidio sa cercare, e che nessuno
    // sa cancellare.
    const testo = `${sorgenti}\n${html}`;
    const morte = Object.keys(IT).filter((chiave) => {
      // La definizione del catalogo conta una volta per lingua: sopra due si è
      // nominata anche altrove.
      const volte = testo.split(`"${chiave}"`).length - 1;
      return volte <= 2;
    });
    expect(morte, `chiavi nel catalogo che non usa nessuno:\n  ${morte.join("\n  ")}`).toEqual([]);
  });

  it("e il glob legge davvero qualcosa", () => {
    // La stessa guardia di sopra: un glob che non trova niente farebbe passare
    // il test dichiarando **tutte** le chiavi morte, cioè fallendo — o, se il
    // confronto fosse scritto al contrario, dichiarandole tutte vive.
    expect(sorgenti.length).toBeGreaterThan(100_000);
  });
});

describe("i due cataloghi", () => {
  it("chiedono gli stessi argomenti, chiave per chiave", () => {
    // Il difetto che i tipi non vedono: `{count}` tradotto in `{n}`. La frase
    // inglese resta una stringa valida, il `Record<Chiave, string>` è
    // soddisfatto, e chi legge l'inglese vede `{n}` in mezzo a una frase.
    // `espandi` lascia a vista un nome senza argomento **apposta** (una frase
    // con un buco si nota), che è ciò che rende questo errore silenzioso solo
    // per chi lo ha scritto.
    for (const chiave of Object.keys(IT)) {
      expect(argomenti(EN[chiave]!), `«${chiave}» chiede argomenti diversi in inglese`).toEqual(
        argomenti(IT[chiave]!),
      );
    }
  });

  it("non hanno voci vuote", () => {
    // Una stringa vuota compila e non si vede: è una chiave che sparisce
    // dall'interfaccia senza lasciare traccia, che è peggio della chiave nuda.
    for (const chiave of Object.keys(IT)) {
      expect(IT[chiave]!.trim(), `«${chiave}» è vuota in italiano`).not.toBe("");
      expect(EN[chiave]!.trim(), `«${chiave}» è vuota in inglese`).not.toBe("");
    }
  });
});

describe("la scala di ripiego, che è quella del contratto", () => {
  it("`it-IT` scende a `it`", () => {
    // La lingua regionale non ha un catalogo suo e non deve averne bisogno:
    // scende alla lingua, che è il primo gradino della 0040.
    expect(catalogoPer("it-IT")).toBe(catalogoPer("it"));
    expect(catalogoPer("en-GB")).toBe(catalogoPer("en"));
    // Anche con l'underscore, che è come lo scrive un locale POSIX
    // (`it_IT.UTF-8`) — la stessa tolleranza che `HostEnv::user_locale` ha
    // dall'altro lato.
    expect(catalogoPer("it_IT")).toBe(catalogoPer("it"));
  });

  it("una lingua che non c'è scende al ripiego, che è l'italiano", () => {
    // Non all'inglese: il ripiego è la lingua in cui la shell è **scritta**, ed
    // è l'unica di cui si sappia che è completa per costruzione.
    expect(catalogoPer("de")).toBe(IT);
    expect(catalogoPer("ja-JP")).toBe(IT);
    expect(catalogoPer("")).toBe(IT);
  });

  it("l'ultimo gradino è la chiave nuda, ed è brutto apposta", () => {
    // La ragione sta nella 0040: una chiave mancante deve essere **visibile e
    // cercabile**, non plausibile. Una stringa vuota o un ripiego inventato
    // sarebbero entrambi «non è successo niente».
    expect(t("non.esiste" as never)).toBe("non.esiste");
  });

  it("una chiave che esiste solo in italiano non sparisce nelle altre lingue", () => {
    // Non può succedere per costruzione (il tipo lo vieta), ma `t` non se ne
    // fida: legge il catalogo della lingua, poi quello italiano, poi la chiave.
    // È il gradino che regge il giorno in cui una lingua arriverà da un file
    // dati invece che da questo modulo.
    expect(t("app.close")).toBe("Chiudi");
  });
});

describe("i nomi fra graffe", () => {
  it("si sostituiscono con l'argomento che si chiama così", () => {
    expect(espandi("Note: {count}", { count: 3 })).toBe("Note: 3");
    expect(espandi("{a} e {b}", { a: "x", b: "y" })).toBe("x e y");
  });

  it("una graffa raddoppiata è letterale", () => {
    // Serve a poter scrivere del JSON in un messaggio — `{{"chiave": valore}}`
    // — che è esattamente ciò che un errore di configurazione deve poter dire.
    expect(espandi("{{\"chiave\": {valore}}}", { valore: 1 })).toBe('{"chiave": 1}');
  });

  it("un nome senza argomento resta a vista", () => {
    // La regola meno ovvia delle due, ed è la stessa del motore del contratto:
    // una frase con un buco si nota, una frase a cui manca una parola no. Chi
    // sbaglia il nome di un argomento deve vederlo, non leggere una frase che
    // suona bene e dice una cosa in meno.
    expect(espandi("Note: {count}", {})).toBe("Note: {count}");
    expect(espandi("{a} e {b}", { a: "x" })).toBe("x e {b}");
  });

  it("un argomento che non compare nel template non compare nemmeno nel testo", () => {
    expect(espandi("fermo", { count: 3 })).toBe("fermo");
  });
});

describe("quale lingua vale", () => {
  it("una scelta esplicita vince sul sistema", () => {
    expect(linguaEffettiva("en", "it-IT")).toBe("en");
    expect(linguaEffettiva("it", "en-US")).toBe("it");
  });

  it("la stringa vuota è «come il sistema», che è il default dello schema", () => {
    expect(linguaEffettiva("", "en-US")).toBe("en-US");
    expect(linguaEffettiva("   ", "en-US")).toBe("en-US");
  });

  it("qualunque cosa che non sia una stringa è «come il sistema»", () => {
    // Gemella della regola del tema, e per la stessa ragione: un
    // `settings.json` scritto a mano non deve poter spegnere le stringhe.
    for (const strano of [null, undefined, 3, {}, [], true]) {
      expect(linguaEffettiva(strano, "it-IT")).toBe("it-IT");
    }
  });
});

describe("il testo fermo si riempie", () => {
  it("nei quattro attributi, e ognuno nel posto suo", () => {
    // Quattro nomi e non un mini-linguaggio dentro un attributo: un pulsante ha
    // un testo **e** un `title`, e un campo ha un segnaposto **e** un nome
    // accessibile.
    const root = document.createElement("div");
    root.innerHTML = `
      <button data-i18n="app.close" data-i18n-title="app.close">xxx</button>
      <input data-i18n-placeholder="search.placeholder" data-i18n-label="search.hint" />
    `;
    applicaStringhe(root);

    const bottone = root.querySelector("button")!;
    expect(bottone.textContent).toBe("Chiudi");
    expect(bottone.getAttribute("title")).toBe("Chiudi");

    const campo = root.querySelector("input")!;
    expect(campo.getAttribute("placeholder")).toBe("Cerca nel vault…");
    expect(campo.getAttribute("aria-label")).toBe("Cerca nel vault");
  });

  it("e lascia in pace ciò che non ha chiesto niente", () => {
    const root = document.createElement("div");
    root.innerHTML = `<span title="mio">intatto</span>`;
    applicaStringhe(root);
    expect(root.querySelector("span")!.textContent).toBe("intatto");
    expect(root.querySelector("span")!.getAttribute("title")).toBe("mio");
  });
});
