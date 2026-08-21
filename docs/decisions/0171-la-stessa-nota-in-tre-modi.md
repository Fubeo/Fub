# 0171 — La stessa nota in tre modi

**Stato**: accolta
**Data**: 2026-08-22
**Chiude**: [§31.8](../roadmap/31-da-dove-viene-cio-che-si-vede.md#318-la-stessa-nota-in-tre-modi) e la casella §31.3
**Commit**: *(questo commit)*

---

## La domanda

Sorgente, Live e Lettura erano la stessa nota solo per i colori. Corpo, interlinea, misura e ritmo erano invece numeri sparsi: la promessa di §31.8 non reggeva appena si guardava la stessa pagina nelle tre superfici.

## Il vocabolario che ora vive

Il foglio resta l'unica sorgente. CodeMirror consuma `--font-mono`, `--text-base` e `--leading-normal`; Live e Lettura consumano `--font-reading`, `--text-reading`, `--content-width` e `--leading-relaxed`; i titoli della Lettura consumano `--text-2xl`, `--text-3xl` e `--leading-tight`. La pelle veste inoltre callout per specie, richiami e definizioni di note a piè di pagina, proprietà illeggibili, tabelle, immagini/embed e sillabazione automatica ereditata da `lang="it"`.

Il presidio `frontend/src/theme/typography.test.ts` confronta i gemelli chiaro/scuro e verifica che ogni token tipografico dichiarato sia consumato da una regola reale (`npm test -- src/theme/typography.test.ts`).

## Tre superfici, una prova

La scena `nota-tre-modi` in `frontend/bench/scene.mjs` apre la stessa nota, la divide in tre riquadri e porta i riquadri rispettivamente in Sorgente, Live e Lettura. Le due luci sono quelle comuni del banco; la baseline si genera nel passaggio banco di fine ondata (`npm run bench:update`), non in questa modifica.

## La casella §31.3

La pelle continua a essere assemblata dall'ordine dichiarato e il nuovo consumo tipografico è aggiunto al pezzo `preview.css`, senza toccare `order.ts`. Il verso di montaggio è verde (`npm run theme:verify`), quindi la casella §31.3 è chiusa insieme a §31.8.

## Il pavimento della scrittura

Non è stato introdotto un nuovo presidio di prestazione: resta il presidio editor esistente. Le unità toccate restano verdi (`npm test -- src/editor/editor.test.ts src/panels/preview.test.ts`).

## Le vie scartate

| Via | Forma | Scartata perché |
| --- | --- | --- |
| Una scala per modalità | Numeri CSS distinti in Sorgente, Live e Lettura | Ricrea il disallineamento che §31.8 deve chiudere. |
| Regole nella struttura | Metriche aggiunte a `structure.css` | La struttura non tematizza tipografia; il foglio deve restare sostituibile. |
| Baseline nella stessa modifica | Foto generate durante il lavoro | Il banco ha una sola generazione delle baseline a fine ondata. |
