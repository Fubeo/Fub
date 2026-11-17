# Il cancello del disegno

La prova ripetibile del piano K5: ogni disegno del corpus si apre nel motore
del disegno, si modifica con tre gesti e si salva senza perdite visibili.

> **Per chi:** chi cambia il motore del disegno (`crates/fub-disegno`, la copia
> in `vendor/vectorcraft`) o il motore della scena del client, e chi rifà il
> cancello di K5.
> **Risultato:** una tabella per file che dice se ogni gesto scrive solo ciò
> che tocca, e l'uscita 0 se tutti passano.

```bash
node tools/disegno-cancello/cancello.mjs            # il cancello
node tools/disegno-cancello/cancello.mjs --latenze  # più le latenze di A8
```

Servono cargo nel `PATH` e `npm ci` in `apps/client`. La cartella di lavoro è
`target/disegno-cancello`, svuotata a ogni giro (`--dir DIR` ne usa un'altra,
vuota). Lì restano, per ogni file, il testo di prima, le operazioni di ogni
gesto e il testo dopo, da aprire se una riga non passa.

## Il giro

Il cancello alterna i due lati, perché solo il client scrive il file:

1. il motore (`crates/fub-disegno/tests/cancello.rs`, `scrivi`, `#[ignore]`)
   mette in `elenco.json` i file di `crates/fub-scene/tests/corpus/`,
   `crates/fub-features/templates/` e `apps/client/src/__fixtures__/scene/`;
2. il client (`apps/client/src/editors/spatial/motore/cancello.test.ts`, che
   salta se manca `FUB_DISEGNO_CANCELLO`) scrive `<file>.prima.svg`: il testo
   del file o, per un SVG estraneo, quello dopo «Modifica» (`adopt`);
3. il motore apre il prima e scrive i gesti in `<file>.<gesto>.json`:
   - `sposta`: il primo elemento mappato (non la carta, un livello, un titolo;
     non bloccato né nascosto, lui o un antenato) si sposta di (+7, +5) nelle
     unità del documento del motore, e la differenza lo scrive come dopo ogni
     gesto. Se il motore lo rifiuta, prova l'elemento dopo e scrive il rifiuto;
   - `rettangolo`: lo strumento Rettangolo del motore disegna al centro del
     disegno un quadrato di un decimo del lato corto;
   - `colore`: il comando `disegno.colore-tratto` sul primo elemento con un id
     che il comando sa colorare;
   - `sposta2`: lo spostamento di un elemento scelto apposta
     (`ANCHE_SPOSTATI` in `cancello.rs`);
4. il client applica le operazioni di ogni gesto col motore della scena, come
   un esito del motore (`opsDellEsito`, poi un passo solo), e scrive
   `<file>.<gesto>.svg`, o `<file>.<gesto>.rifiuto.json` se le rifiuta;
5. il motore apre il dopo di `sposta` e `sposta2` e scrive il ritorno,
   (−7, −5) sullo stesso elemento; il client lo applica;
6. il motore dice da dove vengono le facce dei testi (`caratteri`) e confronta
   (`confronta`).

## Il confronto

L'oracolo è `fub_testkit::pixel`, con le facce di `crates/fub-features/fonts/`,
a 1000 pixel di larghezza; un pixel è diverso se un canale cambia più di 8.

| Gesto | Passa se |
|---|---|
| adozione | il file dopo «Modifica» si vede uguale all'originale |
| sposta, sposta2 | dopo andata e ritorno, 0 pixel diversi da prima |
| rettangolo, colore | al più lo 0,2% dei pixel diversi fuori dalla zona toccata |

La zona toccata è dove si vede l'elemento del gesto, prima e dopo: i pixel che
cambiano togliendolo dal testo, più 3 pixel di bordo. Per ogni testo dopo, i
codici `S…` della diagnosi di `fub_scene` non sono più di prima.

Una riga `salta` non prova niente e lo dice: un file in sola lettura, niente
da spostare o da colorare, un file che l'oracolo non disegna (allora i gesti
si applicano senza confrontare immagini), un rifiuto ammesso. Il cancello
esce con 1 solo per una riga `NO`.

## Le differenze ammesse

I rifiuti del motore che il cancello accetta stanno in `RIFIUTI_AMMESSI`, in
`cancello.rs`, col perché: in `symbols` la copia del motore è vuota (0
elementi mappati su 19: il file prova apposta simboli che si richiamano in
cerchio), quindi il rettangolo non ha un livello dove andare.

Ciò che il cancello non prova, e perché:

- le quattro differenze delle forme che i vettori dei gesti hanno mostrato
  (T14): l'operazione `page` quando una forma esce dalla pagina, il punto del
  rilascio diverso dall'ultimo trascinamento, lo spessore 0 sulle linee
  (portato a 0,1) e rettangolo ed ellisse che su un livello ruotato escono come
  `path`. Il rettangolo del cancello sta al centro, dentro la pagina, con il
  rilascio sull'ultimo punto e spessore 2, e nel corpus non c'è un livello
  ruotato: sono casi dei vettori, non del corpus;
- un filtro dato da un foglio `<style>` (nota di T16): nel corpus i fogli di
  mermaid lo danno solo ai nodi `data-look="neo"`, che i due file non hanno.
  La gradazione con `spreadMethod` si prova con `sposta2` su `resources`.

## I caratteri e le latenze

`caratteri` scrive `caratteri.tsv`: per testi con una famiglia che Fub non ha,
o con caratteri che le facce di Fub non hanno, la famiglia e il file di ogni
faccia che il motore usa. Una faccia letta da un file del sistema vuol dire
che il disegno del testo dipende dalla macchina.

`--latenze` lancia `latenze`, sempre ottimizzata: anteprima e commit di uno
spostamento e di un rettangolo su `concept-map`, e di uno spostamento e del
reimport su un disegno di 1 MiB generato, senza IPC. Scrive `latenze.json`;
`FUB_DISEGNO_RIPETIZIONI` cambia i giri (20 di serie). Le misure di K5 sono in
[`docs/misure/2026-11-12-disegno-linux-13600kf.md`](../../docs/misure/2026-11-12-disegno-linux-13600kf.md).
