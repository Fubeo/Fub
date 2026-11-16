// I dati vendorizzati: file singoli copiati così come sono da un URL fisso,
// senza patch. Sono la seconda specie di copia in `vendor/`, accanto ai motori
// di `motori.mjs`: ogni cartella di `vendor/` è l'una o l'altra
// (`provenienza.mjs elenco`, nel workflow `motori-provenienza.yml`).
//
// La cartella è `vendor/<nome>/`: dentro ci sono `file` e l'`UPSTREAM.md` di
// Fub (data, `ETag`, attribuzione, come si aggiorna).
//
// `sha256` è il solo posto dove sta l'impronta attesa del file: la leggono
// `provenienza.mjs check` (senza rete, in CI), gli script che generano da qui
// (`apps/client/scripts/html-entities.mjs`) e i loro test. Il workflow
// riscarica `url` e confronta l'impronta con quella del file nel checkout
// (`provenienza.mjs <nome> verify-upstream`).
//
// Il modulo non importa nulla: il workflow lo legge anche dalla base della PR,
// copiato in una cartella temporanea.

export const DATI = {
  "whatwg-entities": {
    nome: "Entità nominate di HTML (WHATWG)",
    url: "https://html.spec.whatwg.org/entities.json",
    file: "entities.json",
    sha256: "d741d877ac77c4194c4ad526b5b4a19aef8dfe411ab840a466891cdbb9f362e6",
    licenza: "CC-BY-4.0",
  },
};
