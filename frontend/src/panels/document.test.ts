// Il presidio di **un ordine**, dentro l'ascoltatore di `document_changed`.
//
// Il conto degli echoes (`state/salvataggio.ts`) ha due metà: una scrittura ne
// mette uno prima di partire, e l'evento con l'identità di una nostra
// scrittura — attore `user` fuori da un lotto — lo consuma — «anche se non
// c'è niente da dire», che è la frase scritto sul campo `Buffer.echoes`. Un eco
// che nessuno consuma **non si ripara più**: resta appeso, e il prossimo
// evento con quella stessa identità — la scrittura diretta di un'altra
// finestra — viene scambiato per il nostro. Cioè l'avviso che doveva comparire
// non compare, ed è il difetto che `consumaCambioSotto` esiste per non avere.
//
// Per un po' quella promessa è stata falsa, e per un motivo che nessuna delle
// due metà poteva vedere: nell'ascoltatore, **davanti** alla consumazione, c'era
// una guardia che chiedeva tutt'altro — se qualche riquadro stia mostrando quel
// documento. Le due domande non hanno niente in comune: il conto è del buffer,
// e un buffer esiste anche quando nessun riquadro lo mostra (fra la chiusura di
// una linguetta e il `flush` che la congeda, che è proprio il momento in cui una
// scrittura in volo produce il suo eco).
//
// # Perché questo presidio guarda il sorgente
//
// Perché è dove il difetto vive. Il conto `echoes-fuori-dal-padrone`
// (`.github/scripts/conteggi.mjs`) tiene ferme le due metà nel file che le
// possiede, e non vede un ordine; `salvataggio.test.ts` prova la funzione, che
// è giusta e lo era già. Ciò che è sbagliato è **quale riga viene prima**, e
// l'unico attore che lo vede senza montare l'intero modulo dei riquadri — DOM,
// editor, layout, IPC — è chi legge il file. È la forma del presidio di
// `hidden` (`ui/hidden.test.ts`): `?raw` di Vite e non `node:fs`, perché
// `tsconfig.json` dichiara i soli tipi di Vite e un presidio della shell non
// deve essere il primo a usare un'API che nella webview non esiste.
//
// Zona cieca dichiarata: si guarda il **corpo dell'ascoltatore**, ritagliato
// fra la sua apertura e la successiva `onEvent(`. Una guardia scritto dentro una
// funzione chiamata da qui, invece che qui, non la vedrebbe — ed è il verso
// giusto in cui sbagliare, perché quella guardia dovrebbe essere scritto apposta.
import { describe, expect, it } from "vitest";

import source from "./document.ts?raw";
import explorer from "./explorer.ts?raw";

// Il presidio del ricongiungimento (in fondo a questo file) importa la
// decisione dal modulo puro `state/drafts.ts`, che non tocca né DOM, né
// editor, né IPC: la metà di `recoverDrafts` che muta la mappa dei buffer si
// prova come comportamento, senza montare la shell. Gli altri presidi di
// questo file restano sul sorgente — vedi la nota in cima — perché guardano
// ordini di righe che nessuna funzione pura potrebbe rendere.
import { Queue } from "../ui/race";
import type { DraftInfo } from "../host/contract";
import { rejoinDrafts, type DraftBuffer } from "../state/drafts";

/// Il corpo dell'ascoltatore di `document_changed`, dalla sua apertura al
/// prossimo `onEvent(`.
function body(): string {
  const opens = source.indexOf('onEvent("document_changed"');
  expect(opens, "l'ascoltatore di `document_changed` non si chiama più così").toBeGreaterThan(-1);
  const after = source.indexOf("onEvent(", opens + 1);
  return source.slice(opens, after === -1 ? source.length : after);
}

describe("l'ascoltatore di document_changed", () => {
  it("consuma l'eco prima di guardare se c'è un riquadro", () => {
    const text = body();
    const consumeCall = text.indexOf("warnIfBufferCovers(");
    const guardCall = text.indexOf("panesWithDoc(");
    expect(consumeCall, "non consuma più l'eco").toBeGreaterThan(-1);
    expect(guardCall, "non guarda più i riquadri").toBeGreaterThan(-1);
    expect(
      consumeCall,
      "la guardia sui riquadri sta davanti al conto degli echoes: un documento " +
        "con un buffer e nessun riquadro non consuma il proprio eco, e quell'eco " +
        "appeso si mangia il prossimo avviso vero — «il file è cambiato sotto di " +
        "te» detto da un plugin o dal kernel, che non comparirà",
    ).toBeLessThan(guardCall);
  });
});

/// Il corpo di una funzione esportata, dalla sua firma alla prima riga che
/// chiude in colonna zero. Stessa forma — e stessa zona cieca dichiarata — del
/// ritaglio qui sopra: una riga scritto in una funzione chiamata da lì, invece
/// che lì, non la si vedrebbe.
function bodyOf(name: string): string {
  const opens = source.indexOf(`export function ${name}(`);
  expect(opens, `\`${name}\` non si chiama più così`).toBeGreaterThan(-1);
  const closes = source.indexOf("\n}\n", opens);
  return source.slice(opens, closes === -1 ? source.length : closes);
}

// **I due ritardi si fermano insieme** (difetto 0211).
//
// Chi chiede conferma di una cancellazione non ha deciso «non salvare»: ha
// deciso che quel testo non tocchi il disco finché non c'è una risposta. La
// domanda la disegna il sistema operativo e può restare aperta quanto vuole
// l'utente; il ritardo della bozza è di un secondo. Fermando il solo
// salvataggio, la rete si stendeva *dentro* la finestra in cui la shell aveva
// deciso che non si scrive — e sulla strada del sì quella bozza sopravviveva
// alla nota, per tornare al riavvio dopo come `orfana`.
//
// Il presidio guarda il sorgente per la ragione scritto in cima a questo file:
// `document.ts` non si monta in un test senza DOM, editor, layout e IPC, e ciò
// che è sbagliato qui è **quali righe ci sono**, non un valore che una
// funzione pura potrebbe rendere.
describe("sospendere e riprendere i ritardi", () => {
  it("ne ferma due, non uno", () => {
    const text = bodyOf("suspendSave");
    expect(text).toContain("clearTimeout(buf.timer)");
    expect(
      text,
      "`suspendSave` ferma il salvataggio e lascia correre la bozza: la rete " +
        "si stende dentro la finestra in cui la shell ha appena deciso che quel " +
        "testo non tocca il disco, e su un sì sopravvive alla nota cestinata",
    ).toContain("clearTimeout(buf.draftTimer)");
  });

  it("ne rimette in coda due, non uno", () => {
    const text = bodyOf("resumeSave");
    expect(text).toContain("scheduleSave(");
    expect(
      text,
      "la ripresa riaccende il salvataggio e non la bozza: dopo un ripensamento " +
        "il buffer resta sporco senza la sua rete sotto",
    ).toContain("scheduleDraft(");
  });

  // L'altra metà: il sospeso era **uno**, e la seconda sospensione copriva la
  // prima. Oggi il chiamante è uno solo — ma i secondi chiamanti hanno già un
  // nome (una rinomina dentro una conversione, un'importazione mentre una
  // modale è aperta), e un insieme li fa nascere giusti invece di aspettarli.
  it("tiene un posto per documento, non un posto solo", () => {
    expect(
      source,
      "il documento sospeso è tornato a essere una casella sola: due " +
        "sospensioni annidate si pestano, e la prima ripresa riaccende quello " +
        "sbagliato lasciando l'altro fermo per sempre",
    ).toContain("const sospesi = new Set<string>()");
    expect(source).not.toContain("let sospeso: string | null");
  });
});

/// Il corpo di un ascoltatore, dalla sua apertura al prossimo `onEvent(`.
/// Stesso ritaglio — e stessa zona cieca dichiarata — di `corpo()`.
function listenerBody(event: string): string {
  const opens = source.indexOf(`onEvent("${event}"`);
  expect(opens, `l'ascoltatore di \`${event}\` non si chiama più così`).toBeGreaterThan(-1);
  const after = source.indexOf("onEvent(", opens + 1);
  return source.slice(opens, after === -1 ? source.length : after);
}

/// Il corpo di una funzione **privata**, dalla sua firma alla prima riga che
/// chiude in colonna zero.
function privateBodyOf(name: string): string {
  const opens = source.indexOf(`function ${name}(`);
  expect(opens, `\`${name}\` non si chiama più così`).toBeGreaterThan(-1);
  const closes = source.indexOf("\n}\n", opens);
  return source.slice(opens, closes === -1 ? source.length : closes);
}

// **La finestra di migrazione di una rinomina** (difetto 0210).
//
// Chi rinomina mette in salvo prima di chiedere, e quello basterebbe se fra la
// richiesta e l'evento che migra l'identità non ci fosse niente. C'è un giro
// IPC che riscrive i wikilink entranti di tutto il vault, e in quel tempo si
// batte: la battuta programmava un salvataggio col nome di prima, che scadeva
// mentre il file si era già mosso, e il kernel ricreava la nota al vecchio
// path — la stessa nota in due posti, con due contenuti diversi.
//
// Le tre righe che tengono la proprietà stanno in tre punti che non si vedono
// l'un l'altro: il cancello sui due ritardi (senza, si ferma solo ciò che era
// già armato e la finestra resta scoperta), lo scioglimento sull'evento (senza,
// il buffer resta fermo per sempre e il testo non raggiunge più il disco) e la
// porta unica da cui si rinomina (senza, il secondo chiamante non eredita
// niente).
describe("la finestra di migrazione di una rinomina", () => {
  it("il fermo copre anche i ritardi che nascono dopo", () => {
    for (const name of ["scheduleSave", "scheduleDraft"]) {
      expect(
        privateBodyOf(name),
        `\`${name}\` non guarda il fermo: una battuta dentro la finestra di ` +
          "migrazione programma una scrittura col nome di prima, e la nota " +
          "rinominata ricompare al vecchio path",
      ).toContain("sospesi.has(doc)");
    }
  });

  it("chi rinomina tiene fermo prima di chiedere, e scioglie se la richiesta fallisce", () => {
    const text = privateBodyOf("renameKeepingBuffer");
    const stopButton = text.indexOf("suspendSave(from)");
    const renameCall = text.indexOf("await renameNote(");
    expect(stopButton, "non tiene più fermo il buffer").toBeGreaterThan(-1);
    expect(renameCall, "non chiede più la rinomina").toBeGreaterThan(-1);
    expect(stopButton, "chiede la rinomina prima di tenere fermo il buffer").toBeLessThan(renameCall);
    expect(
      text,
      "una rinomina che fallisce non scioglie il fermo: non arriverà nessun " +
        "evento, e quel buffer non raggiunge più il disco",
    ).toContain("resumeSave(from)");
  });

  it("il fermo si scioglie dove finisce la finestra", () => {
    expect(
      listenerBody("document_renamed"),
      "l'evento che migra l'identità non scioglie il fermo preso da chi ha " +
        "chiesto la rinomina",
    ).toContain("sospesi.delete(e.from)");
  });

  // La porta è una: le tre rinomine dell'esploratore — dal campo di testo, dal
  // trascinamento su una cartella, dal menù — ereditano la finestra chiusa
  // senza saperlo, e la quarta pure.
  it("si rinomina da una porta sola", () => {
    expect(
      explorer,
      "l'esploratore torna a chiamare `renameNote` da sé: quella strada non " +
        "tiene fermo il buffer, e la finestra di migrazione si riapre",
    ).not.toContain("renameNote(");
  });
});

// **Il ricongiungimento delle bozze orfane** (§15.2).
//
// Il recupero corre DOPO che `sincronizza` ha disegnato le linguetta ripristinate dal
// layout, e disegnarle significa aver già letto il disco in un buffer **pulito**
// (`leggiBuffer`). La guardia «se un buffer c'è già, salta» scambiava quella
// copia del disco per il testo più recente della bozza: la bozza restava dov'era,
// la notifica la contava come ritrovata, e il primo salvataggio (`dropDraft`)
// la cancellava — il testo non salvato, l'unica copia, spariva senza che
// nessuno l'avesse mai visto. È il caso in cui una bozza esiste per definizione:
// un salvataggio rifiutato dal disco (pieno, sola lettura, share caduta) alla
// chiusura della finestra, con la linguetta ancora nel layout al riavvio.
//
// La condizione giusta è lo **sporco**, non l'esistenza: un buffer sporco porta
// un'identità diversa — un testo battuto dopo, in questa sessione — e la bozza
// resta orfana sul disco; un buffer pulito è solo il disco riletto, e la bozza
// rientra sopra di lui, sporcandolo, una volta sola (il buffer sporco che ne
// nasce ferma la voce che nomina lo stesso documento). E il conto restituito
// dice quante sono rientrate davvero: la notifica «è stato ritrovato» con
// dentro una bozza saltata sarebbe una bugia.
//
// # Perché qui si prova il comportamento, non il sorgente
//
// Gli altri presidi di questo file guardano il sorgente perché ciò che è
// sbagliato è l'**ordine delle righe** — una cosa che nessuna funzione pura
// potrebbe rendere. Il ricongiungimento no: la decisione sta in
// `rejoinDrafts` (`state/drafts.ts`), la metà di `recoverDrafts` che non
// tocca né DOM, né editor, né IPC — riceve la mappa dei buffer e la muta —
// ed è un
// comportamento osservabile: quale testo finisce nel buffer, con che stato, e
// quante bozze il conto dice rientrate. Si prova quello, come si deve.
describe("il ricongiungimento delle bozze orfane", () => {
  /// Una bozza come la manda il kernel: il documento, il testo, e la base da
  /// cui il buffer si era discostato — `null` quando chi l'ha scritto non la
  /// sapeva, che è il caso di una nota mai salvata.
  function draft(doc: string, text: string, base: string | null = null): DraftInfo {
    return { doc, at: 1, base, exists: true, current: base, text };
  }

  /// Un buffer come lo lascia `leggiBuffer`: il disco riletto da poco, pulito.
  function clean(text: string): DraftBuffer {
    return {
      text,
      dirty: false,
      result: "ok",
      echoes: 0,
      queue: new Queue(),
      base: { kind: "descends_from", value: "la revisione del disco" },
    };
  }

  it("fa rientrare la bozza sopra la copia pulita, e conta 1", () => {
    // La linguetta ripristinata dal layout ha già letto il disco in un buffer pulito:
    // la bozza è più nuova di lui, e il ricongiungimento la rimette sopra —
    // testo, sporco e base sono i suoi, non quelli del disco.
    const buffer = new Map<string, DraftBuffer>([
      ["nota.md", clean("il testo sul disco")],
    ]);

    const rejoined = rejoinDrafts(
      [draft("nota.md", "il testo non salvato", "la base della bozza")],
      buffer,
    );

    expect(rejoined, "una sola bozza in fila, una sola rientrata").toHaveLength(1);
    expect(rejoined[0].doc).toBe("nota.md");
    expect(buffer.get("nota.md")).toMatchObject({
      text: "il testo non salvato",
      dirty: true,
      result: "ok",
      base: { kind: "descends_from", value: "la base della bozza" },
    });
  });

  it("lascia intatto il buffer sporco, e conta 0", () => {
    // Un buffer sporco è un'identità diversa — un testo battuto dopo, in
    // questa sessione — e sovrascriverlo la farebbe sparire: la bozza resta
    // orfana sul disco, e il conto dice che non è rientrata.
    const buffer = new Map<string, DraftBuffer>([
      [
        "nota.md",
        {
          ...clean("il testo sul disco"),
          dirty: true,
          text: "scritto dopo, in questa sessione",
        },
      ],
    ]);

    const rejoined = rejoinDrafts(
      [draft("nota.md", "il testo non salvato", "la base della bozza")],
      buffer,
    );

    expect(rejoined).toHaveLength(0);
    expect(buffer.get("nota.md")).toMatchObject({
      text: "scritto dopo, in questa sessione",
      dirty: true,
    });
  });

  it("senza buffer la bozza diventa il buffer, e chi non sapeva la base detta", () => {
    // Una bozza per un documento che nessuno ha aperto: nasce il buffer, e la
    // base resta quella che la bozza portava — o, se non la sapeva, «dettata»:
    // non c'è nessuna revisione da esibire.
    const buffer = new Map<string, DraftBuffer>();

    const rejoined = rejoinDrafts([draft("nuova.md", "il testo non salvato")], buffer);

    expect(rejoined).toHaveLength(1);
    expect(buffer.get("nuova.md")).toMatchObject({
      text: "il testo non salvato",
      dirty: true,
      base: { kind: "dictated" },
    });
  });

  it("il rientro è uno solo per documento, anche se la fila lo nomina due volte", () => {
    // Il buffer sporco che il rientro produce ferma la voce successiva che
    // nomina lo stesso documento: il ricongiungimento è unico, e il testo che
    // rientra è quello più recente (la fila arriva dalla più recente).
    const buffer = new Map<string, DraftBuffer>();

    const rejoined = rejoinDrafts(
      [
        draft("nota.md", "il testo più recente", "base-2"),
        draft("nota.md", "il testo più vecchio", "base-1"),
      ],
      buffer,
    );

    expect(rejoined).toHaveLength(1);
    expect(buffer.get("nota.md")).toMatchObject({ text: "il testo più recente" });
  });
});
