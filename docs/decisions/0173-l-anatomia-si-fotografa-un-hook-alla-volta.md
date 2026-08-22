# 0173 — L'anatomia si fotografa un hook alla volta

**Stato**: accolta
**Data**: 2026-08-22
**Prosegue**: [§31.4](../roadmap/31-da-dove-viene-cio-che-si-vede.md#314-un-componente-unanatomia-e-il-vocabolario-degli-hook) via [0170](0170-una-componente-un-anatomia.md); il presidio del contrasto reso viene dalla [0166](0166-il-banco-che-vede.md)
---

## Il banco ha condannato la pelle per crimini che non commetteva

Il primo giro del banco dell'anatomia contro `bench:a11y` è uscito rosso:
`intent-danger` sopra il fondo d'accento a 1,8:1, il velo della modale sotto
testo, la ribbon scura in tema chiaro. Nessuna di queste coppie esiste nella
shell vera — sono i composti di una cella che metteva **tutti gli hook di un
componente su un solo elemento**. Nel DOM vero gli hook stanno su nodi in
rapporto: un `.tab` contiene un `.tab-name`, `.views-modal` è un fisso a sé,
`.tab-close` è un figlio. La pila piatta li faceva combattere su uno stesso
nodo con esiti che nessun selettore della pelle produce, e il presidio del
contrasto — che misura ciò che la pagina mostra — li condannava a nome della
pelle. Un banco che fotografa stati impossibili non è un presidio: è una
macchina di falsi positivi che prima o poi insegna a non leggerlo.

## Deciso

`anatomy()` continua a costruire **una cella per ogni coppia
componente/stato** leggendo `COMPONENTS` — il contratto della [0170](0170-una-componente-un-anatomia.md)
resta intatto, la tabella resta l'unica sorgente — ma dentro la cella ogni
hook ha **il suo elemento**, con il suo nome accanto. Due precisazioni:

- **Le superfici di copertura** (`.modale`, `.views-modal`) si fotografano
  senza prosa addosso: sono un velo a pagina intera, e il loro contenuto vero
  arriva per conto suo come hook a sé (`.palette-*`, `.declared-view-panel`).
  Scrivere del testo sul velo sarebbe fotografare uno stato che la pelle non
  produce.
- La copertura non cambia: ogni componente, ogni stato e ogni hook resta una
  foto, e `anatomia.test.ts` continua a chiudere il cerchio tabella ↔
  selettori CSS.

## Il difetto vero che il banco rimesso in piedi ha trovato

Con le foto tornate oneste, il rosso residuo era **uno e reale**:
`.tab-close` a riposo attenuava il glifo a `opacity: 0.45` — 2,8:1 nel
chiaro, sotto AA anche nell'uso quotidiano, non solo nel catalogo. Misurato
sui due fondi peggiori (`--bg` e `--bg-chrome`, entrambe le luci), il minimo
che regge è 0,63 nel chiaro e 0,49 nello scuro: **0,7** lascia margine da
entrambi i lati, e al passaggio il bottone torna pieno com'era.

## Misurato

`npm run bench:a11y`: 42/42 scene pulite, zero voci nel debito. `npm test`:
944 verdi. Baseline rigenerate dopo la riparazione, nel passaggio del banco
(`bench:update`) e non a mano.

## Scartate

| Via | Forma | Scartata perché |
| --- | --- | --- |
| Tenere la pila e scrivere le coppie in `DEBITO` | Elenco delle esenzioni | Il debito è la foto di un difetto vero in attesa: qui i difetti erano artefatti della fotografia, e dichiararli avrebbe reso perpetuo il falso. |
| Regole CSS per le combinazioni impilate | Pelle che accontenta il banco | Si sarebbe distorto il CSS di produzione per stati che nessun utente incontra. |
| Una cella per hook invece che per componente/stato | Altro contratto | Sprecava la lettura della tabella e cambiava la forma decisa dalla 0170 senza necessità: il per-hook sta dentro la cella. |
| Testi vuoti su tutti i proof | Nascondere la misura | Solo i veli hanno diritto al silenzio: dove c'è testo vero, il testo si misura. |
