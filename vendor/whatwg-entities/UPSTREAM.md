# Entità nominate di HTML (WHATWG)

`entities.json` è la tabella delle entità nominate della specifica HTML di
WHATWG, copiata così com'è, senza patch locali.

- URL: <https://html.spec.whatwg.org/entities.json>
- Scaricato il 2026-11-16 (`Last-Modified` del server: 2025-11-12 00:20:03
  GMT, `ETag` `"6913d2b3-239e9"`), 145897 byte.
- sha256: `d741d877ac77c4194c4ad526b5b4a19aef8dfe411ab840a466891cdbb9f362e6`
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
Lo script si ferma se lo sha256 del file non è quello scritto sopra.

## Aggiornare

1. Riscaricare il file dall'URL sopra in questa cartella.
2. Scrivere qui data, `Last-Modified`, `ETag`, dimensione e sha256 nuovi.
3. Da `apps/client`: `npm run entities:generate`, poi `npm run entities:verify`
   e i test di `link-syntax`.
