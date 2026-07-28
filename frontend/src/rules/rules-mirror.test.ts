import { describe, expect, it } from "vitest";
import {
  folderContains,
  maskWants,
  pageName,
  resolutionKey,
  taskChecked,
  topicMatches,
} from "./mirrored";
import { byteToCharIndex, charToByteIndex } from "./offsets";
// La fixture è generata dalle regole Rust — vedi
// `crates/fubmd-abi/tests/rules_mirror.rs`.
import cases from "../__fixtures__/rules-samples.json";

// L'altra metà del presidio delle **regole** (la prima è
// `crates/fubmd-abi/tests/rules_mirror.rs`). I tipi al confine avevano
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
  task_checked: (c) => taskChecked(c.symbol ?? null),
  byte_to_utf16: (c) => byteToCharIndex(c.text, c.byte),
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
      const casi = fixture[rule];
      expect(casi, `manca la regola ${rule} nella fixture`).toBeTruthy();
      expect(casi.length, `nessun caso per ${rule}`).toBeGreaterThan(0);
      for (const caso of casi) {
        const { out, ...input } = caso;
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
    const chiavi = fixture.resolution_key.map((c) => c.out);
    expect(
      new Set(chiavi).size,
      "NFC e NFD della stessa parola devono collassare sulla stessa chiave",
    ).toBeLessThan(chiavi.length);

    expect(
      fixture.page_name.some((c) => String(c.id).startsWith(".")),
      "manca un dotfile fra i casi di page_name",
    ).toBe(true);

    expect(
      fixture.byte_to_utf16.some((c) => c.byte !== c.out),
      "manca un testo in cui byte e code unit non coincidono",
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

    // E la maschera: il rename che esce dal soggetto è il caso che una lettura
    // plausibile (guardare il solo path d'arrivo) sbaglierebbe.
    expect(
      fixture.mask_wants.some(
        (c) =>
          (c.event as { type: string }).type === "document_renamed" &&
          c.mask_name === "stretta" &&
          c.out,
      ),
      "manca il rename che esce dal soggetto e deve arrivare comunque",
    ).toBe(true);
  });
});
