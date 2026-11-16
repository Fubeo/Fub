# Entità nominate di HTML (WHATWG)

`entities.json` è la tabella delle entità nominate della specifica HTML di
WHATWG, copiata così com'è, senza patch locali.

- URL: <https://html.spec.whatwg.org/entities.json>
- Scaricato il 2026-11-16 (`Last-Modified` del server: 2025-11-12 00:20:03
  GMT, `ETag` `"6913d2b3-239e9"`), 145897 byte.
- sha256: in `tools/vendor-craft/dati.mjs`, alla voce `whatwg-entities`
  (il solo posto dove sta).
- Licenza: Creative Commons Attribution 4.0 International (CC BY 4.0),
  <https://creativecommons.org/licenses/by/4.0/>.

## Attribuzione

HTML Living Standard, sezione «Named character references», © WHATWG
(Apple, Google, Mozilla, Microsoft), <https://html.spec.whatwg.org/>, sotto
licenza [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Il file è
copiato senza modifiche; la tabella derivata
`apps/client/src/editors/text/profiles/markdown/html-entities.generated.ts`
tiene soltanto i nomi con il `;` finale e i loro caratteri, riscritti come
oggetto TypeScript.

## Chi la usa

`apps/client/scripts/html-entities.mjs` genera da qui la tabella del client,
che `link-syntax.ts` usa per sciogliere le entità del Markdown senza DOM.
Lo script si ferma se lo sha256 del file non è quello di `dati.mjs`.

## Come si verifica

È un dato di `tools/vendor-craft/dati.mjs`, non un motore:

- `node tools/vendor-craft/provenienza.mjs check` (in `ci.yml`, senza rete):
  la cartella ha soltanto `entities.json` e questo file, e `entities.json` ha
  lo sha256 di `dati.mjs`;
- `node tools/vendor-craft/provenienza.mjs whatwg-entities verify-upstream`
  (in `motori-provenienza.yml`, ogni settimana e sulle PR che toccano
  `vendor/` o `tools/vendor-craft/`): riscarica l'URL e confronta lo sha256
  con quello del file nel checkout. Sulle PR l'URL e lo strumento vengono
  dalla base. Se la specifica è cambiata, il cron diventa rosso: si aggiorna
  con i passi qui sotto.

## Aggiornare

1. Riscaricare il file dall'URL sopra in questa cartella.
2. Scrivere qui data, `Last-Modified`, `ETag` e dimensione nuovi, e lo
   sha256 nuovo in `tools/vendor-craft/dati.mjs`; poi
   `node tools/vendor-craft/provenienza.mjs check`.
3. Da `apps/client`: `npm run entities:generate`, poi `npm run entities:verify`
   e i test di `link-syntax`.
