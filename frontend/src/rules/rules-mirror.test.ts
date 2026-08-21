import { describe, expect, it } from "vitest";
import {
  folderContains,
  maskWants,
  nameFault,
  normalizedName,
  pageName,
  resolutionKey,
  scanTags,
  taskChecked,
  topicMatches,
} from "./mirrored";
import { expand } from "../i18n/strings";
import { normalize } from "../ui/commands";
import { byteToCharIndex, charToByteIndex } from "./offsets";
// La fixture è generata dalle regole Rust — vedi
// `crates/fub-abi/tests/rules_mirror.rs`.
import cases from "../__fixtures__/rules-samples.json";

// L'altra metà del presidio delle **regole** (la prima è
// `crates/fub-abi/tests/rules_mirror.rs`). I tipi al confine avevano
// `mirror.test.ts`; le regole non avevano niente, e sono già scritte due volte
// — perché ogni cosa che la UI deve sapere *prima* di un giro IPC nasce in due
// copie. Qui la duplicazione resta ma smette di essere silenziosa: la fixture
// porta la risposta di Rust caso per caso, e l'implementazione TypeScript deve
// dare la stessa.
//
// Il legame è nei due versi:
//
// - una regola cambiata in Rust rende stantia la fixture (rosso di là);
//   rigenerarla (`UPDATE_MIRROR=1`) sposta il rosso qui, dove la gemella non è
//   ancora d'accordo;
// - una chiave della fixture senza handler qui, o un handler senza chiave, è
//   rosso: una regola non può entrare da un lato e restare non rispecchiata.

const fixture = cases as unknown as Record<string, Record<string, unknown>[]>;

/// Per ogni regola: come si passano gli input della fixture alla gemella TS.
///
/// Le chiavi di questa mappa e quelle della fixture devono coincidere
/// **esattamente** — è il test qui sotto, ed è ciò che impedisce a una regola
/// nuova di restare presidiata da un lato solo.
const HANDLERS: Record<string, (c: Record<string, never>) => unknown> = {
  page_name: (c) => pageName(c.id),
  resolution_key: (c) => resolutionKey(c.s),
  // La politica dei nomi (§15.5). `null` = il nome si può usare; Rust manda
  // `null` per `Ok(())`, quindi la gemella deve rispondere `null` e non
  // `undefined`.
  name_fault: (c) => nameFault(c.path, c.naming),
  normalized_name: (c) => normalizedName(c.path),
  task_checked: (c) => taskChecked(c.symbol ?? null),
  // Il riconoscimento di un `#tag` (§4.4): la regola sale nel contratto
  // perché una superficie di scrittura la deve sapere senza avere il parser.
  scan_tags: (c) => scanTags(c.text),
  // La forma di una scorciatoia (§1.36). La gemella di qua è quella vera — la
  // shell la usa a ogni tasto premuto — e la copia del contratto serve a chi
  // guarda il registro fermo; `null` da entrambe le parti vuol dire «questa app
  // non la sa premere», e sono le stringhe su cui le due copie divergevano.
  "canonical_chord": (c) => normalize(c.binding),
  byte_to_utf16: (c) => byteToCharIndex(c.text, c.byte),
  // I due motori di sostituzione `{nome}`: l'unica coppia che il repo
  // dichiarava gemella e nessuna fixture teneva tale (difetto 0224).
  expansion: (c) => expand(c.template, c.args),
  utf16_to_byte: (c) => charToByteIndex(c.text, c.unit),
  // La maschera di un abbonamento (§10.1). `mask_name` è solo l'etichetta che
  // rende leggibile un caso fallito: la regola guarda `mask` ed `event`.
  topic_matches: (c) => topicMatches(c.prefix, c.topic),
  folder_contains: (c) => folderContains(c.folder, c.id),
  mask_wants: (c) => maskWants(c.mask, c.event),
};

describe("mirror delle regole TS↔Rust", () => {
  it("ogni regola della fixture ha una gemella, e viceversa", () => {
    expect(Object.keys(HANDLERS).sort()).toEqual(Object.keys(fixture).sort());
  });

  for (const [rule, handler] of Object.entries(HANDLERS)) {
    it(`\`${rule}\` risponde come Rust su ogni caso`, () => {
      const cases = fixture[rule];
      expect(cases, `manca la regola ${rule} nella fixture`).toBeTruthy();
      expect(cases.length, `nessun caso per ${rule}`).toBeGreaterThan(0);
      for (const testCase of cases) {
        const { out, ...input } = testCase;
        expect(handler(input as Record<string, never>), `${rule}(${JSON.stringify(input)})`).toEqual(
          out,
        );
      }
    });
  }

  it("i casi che contano ci sono davvero", () => {
    // Un presidio si può svuotare senza diventare rosso, potando i casi
    // difficili e lasciando quelli facili. Queste sono le tre proprietà che
    // rendono la fixture capace di distinguere due implementazioni diverse.
    const keys = fixture.resolution_key.map((c) => c.out);
    expect(
      new Set(keys).size,
      "NFC e NFD della stessa parola devono collassare sulla stessa chiave",
    ).toBeLessThan(keys.length);

    expect(
      fixture.page_name.some((c) => String(c.id).startsWith(".")),
      "manca un dotfile fra i casi di page_name",
    ).toBe(true);

    expect(
      fixture.byte_to_utf16.some((c) => c.byte !== c.out),
      "manca un testo in cui byte e code unit non coincidono",
    ).toBe(true);

    // Le due specie di caso senza le quali la forma canonica non distinguerebbe
    // niente: una sequenza (che una copia che spezza solo sul `-` sbaglia) e una
    // scorciatoia rifiutata (che una copia che normalizza tutto accetta).
    expect(
      fixture["canonical_chord"].some((c) => String(c.binding).includes(" ") && c.out !== null),
      "manca una sequenza fra i casi degli accordi",
    ).toBe(true);
    expect(
      fixture["canonical_chord"].some((c) => c.out === null),
      "manca un accordo che questa app non sa premere",
    ).toBe(true);

    // I due prefissi sbagliano nello stesso modo, e il caso che li distingue da
    // uno `startsWith` è uno solo per ciascuno: il nome che comincia uguale.
    expect(
      fixture.topic_matches.some((c) => String(c.topic).startsWith(String(c.prefix)) && !c.out),
      "manca il topic che comincia col prefisso e NON deve passare",
    ).toBe(true);
    expect(
      fixture.folder_contains.some((c) => String(c.id).startsWith(String(c.folder)) && !c.out),
      "manca la cartella che è prefisso di caratteri e NON contiene",
    ).toBe(true);

    // La politica dei nomi (§15.5). Tre proprietà, e sono le tre cose che una
    // implementazione plausibile sbaglia.
    //
    // La prima è la voce intera: lo stesso nome deve avere due esiti diversi
    // secondo la domanda che gli si pone. Chi collassasse le due tolleranze in
    // una passerebbe metà dei casi con entrambe le risposte sbagliate — o
    // rifiutandosi di aprire un vault che contiene `CON.md`, o creandone uno.
    const forPath = new Map<string, Set<string>>();
    for (const c of fixture.name_fault) {
      const key = String(c.path);
      if (!forPath.has(key)) forPath.set(key, new Set());
      forPath.get(key)?.add(String(c.out));
    }
    expect(
      [...forPath.values()].some((outcomes) => outcomes.size > 1),
      "manca il nome che si può leggere e non si può creare: senza, le due tolleranze non sono distinte",
    ).toBe(true);

    // La seconda: la lunghezza è in **byte**, e in JavaScript `s.length` conta
    // code unit. Serve un caso in cui i due numeri stiano ai lati opposti del
    // limite, o `length` passerebbe il test sbagliando.
    expect(
      fixture.name_fault.some(
        (c) => c.out === "too-long" && String(c.path).length <= 255,
      ),
      "manca il nome che sfora in byte ma non in code unit UTF-16",
    ).toBe(true);

    // La terza: un nome che *comincia* come un device DOS e non lo è. È l'errore
    // di chi scrive la regola con uno `startsWith`.
    expect(
      fixture.name_fault.some(
        (c) =>
          c.naming === "new" &&
          c.out === null &&
          /^(CON|NUL|AUX|PRN|COM1|LPT1)/i.test(String(c.path)),
      ),
      "manca il quasi-device che deve passare",
    ).toBe(true);

    // E la NFC sui nomi, che è il difetto esatto che la 0020 trovò sulle chiavi:
    // due scritture della stessa parola devono collassare sulla stessa forma.
    const normalizedForms = fixture.normalized_name.map((c) => c.out);
    expect(
      new Set(normalizedForms).size,
      "NFC e NFD dello stesso nome devono dare la stessa forma normalizzata",
    ).toBeLessThan(normalizedForms.length);

    // E la maschera: il rename che esce dal soggetto è il caso che una lettura
    // plausibile (guardare il solo path d'arrivo) sbaglierebbe.
    expect(
      fixture.mask_wants.some(
        (c) =>
          (c.event as { type: string }).type === "document_renamed" &&
          c.mask_name === "narrow" &&
          c.out,
      ),
      "manca il rename che esce dal soggetto e deve arrivare comunque",
    ).toBe(true);
  });
});
