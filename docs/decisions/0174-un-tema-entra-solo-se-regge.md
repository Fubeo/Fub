# 0174 — Un tema entra solo se regge

**Stato**: accolta
**Data**: 2026-08-24
**Chiude**: [§29.3](../roadmap/29-chi-possiede-la-pelle.md#293-i-cancelli-al-montaggio-contrasto-moto-sanificazione)

---

## Il caricatore non può fidarsi del foglio che carica

Un tema sostituisce il foglio e la pelle della serie. Se il controllo resta
nel banco o nella guida per autori, un fascio incompleto può arrivare fino al
DOM e lasciare alla persona il costo del difetto: testo illeggibile, moto che
ignora la preferenza di sistema, CSS remoto o struttura della shell riscritta.
Il confine utile è il montaggio, prima della sostituzione.

## Deciso

`frontend/src/theme/loader.ts` valida il fascio intero e monta solo dopo che
tutti i cancelli sono passati:

- il manifest usa il motore `theme-1`, dichiara entrambe le luci, limita il moto
  a `opacity` e `transform` e porta il namespace risorse atteso;
- il foglio dichiara tutti i ruoli richiesti e le coppie della fixture condivisa
  reggono la soglia AA;
- foglio e pelle passano da `ui/sanitize-css.ts`: niente import o URL remoti,
  niente selettori fuori dal vocabolario e niente proprietà che possiedono la
  struttura;
- sotto `prefers-reduced-motion` la struttura azzera durata e ritardo anche se
  il tema li ha dichiarati.

Il montaggio è una commit sola: al primo rifiuto resta attivo il fascio
precedente. Le ragioni sono dati e arrivano al canale trouble con nome e
motivo; non diventano un `console.warn`.

## Presidi

`frontend/src/theme/gate.test.ts` esercita manifest, ruoli, contrasto,
sanificazione, moto e atomicità del rifiuto. `theme/contrast-fixture.ts` è la
sorgente condivisa fra caricatore e presidi del contrasto; `theme/motion.test.ts`
prova il pavimento di moto ridotto.

## Scartate

| Via | Scartata perché |
| --- | --- |
| Validare solo nel banco autori | Il banco non è il confine che monta un fascio installato. |
| Correggere o completare il tema in ingresso | Trasformerebbe un rifiuto riproducibile in una pelle ibrida che nessuno ha dichiarato. |
| Montare e poi tornare indietro | Esporrebbe uno stato intermedio e renderebbe osservabile una sostituzione fallita. |
| Affidare il moto ridotto all'autore | Una preferenza di accessibilità è una garanzia della shell, non una cortesia del tema. |
