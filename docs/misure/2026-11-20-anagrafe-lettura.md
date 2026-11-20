# L'anagrafe letta in un colpo

Quanto costa caricare `entries.json` alla riapertura, prima e dopo la lettura
diretta dei record e la riapertura senza copie dell'anagrafe (issue #523).

> **Per chi:** chi lavora sull'apertura del vault o sul formato
> dell'anagrafe (`crates/fub-kernel/src/entries.rs`).
> **Risultato:** su 30000 note il caricamento dell'anagrafe passa da 200 a
> 74 ms (−63 %), la sola decodifica da 196 a 67 ms (−66 %, le corse con una
> lettura sola), il ricongiungimento da 34 a 5 ms (−86 %). `Host::open` di una riapertura scende da
> 455 a 321 ms (−29 %). Il formato su disco non cambia: schema 5, gli stessi
> byte.

## Macchina e sistema

- `pc-debian-di-fub`: Intel Core i5-13600KF, 20 thread, 31 GiB, disco ext4;
  Debian 13, kernel 6.12;
- build di rilascio di `crates/fub-host/examples/open_30k.rs`, 20 novembre
  2026, misura di un agente;
- A è il commit `52dc718ca` (gli span `fub.apertura` nuovi, la lettura di
  prima); B è `cab69f300` (la lettura diretta e la riapertura senza copie),
  sul ramo `perf/anagrafe-lettura`;
- la macchina non era a riposo: altri controlli pesanti giravano insieme.
  Carico medio a un minuto fra 21 e 33, annotato a ogni corsa.

## Il metodo

- `FUB_APERTURA_N=30000`: 30000 note piccole (un titolo, due tag, due link),
  `entries.json` di circa 27 MB;
- ogni corsa è un processo nuovo con i tre scenari dell'example: freddo,
  caldo (riapertura senza modifiche), tiepido (100 note toccate ad app
  chiusa);
- quattro coppie alternate A, B, A, B…, una dopo l'altra in un solo posto
  della coda dei controlli pesanti, con `nice 19`;
- le fasi sono gli span `fub.apertura`: `entries_load` (la lettura del file
  e la sua decodifica, in `EntryStore::open`), `entries_decode` (ogni
  decodifica, anche le riletture di `store`: la colonna `n` le conta),
  `restore`, `rejoin`, `store_entries`.

## La riapertura senza modifiche (caldo)

Millisecondi, mediana delle quattro corse.

| Fase | A1 | A2 | A3 | A4 | B1 | B2 | B3 | B4 | A | B |
|---|---|---|---|---|---|---|---|---|---|---|
| `entries_load` | 198 | 248 | 202 | 196 | 74 | 73 | 76 | 74 | 200 | 74 |
| `entries_decode`, per lettura | 240 | 261 | 196 | 207 | 68 | 65 | 68 | 67 | 224 | 67 |
| `rejoin` | 34 | 35 | 34 | 34 | 4 | 5 | 5 | 5 | 34 | 5 |
| `Host::open` | 463 | 542 | 446 | 438 | 316 | 318 | 324 | 330 | 455 | 321 |
| carico prima della corsa | 32,9 | 28,3 | 24,5 | 23,0 | 30,5 | 26,2 | 24,5 | 22,3 | | |

- La decodifica di A per lettura viene da `entries_decode` diviso `n`: in
  A1, A2 e A4 lo scenario ha decodificato tre volte (vedi sotto).
- Il confronto più pulito della decodifica è fra le corse con una lettura
  sola: A3 196 ms, B 65–68 ms, cioè −66 %. Le letture di una compattazione
  leggono un file più lungo (la fotografia più la coda appena appesa).
- Il criterio della issue era almeno −40 % sulla decodifica e un
  ricongiungimento molto più basso: −66 % e −86 %.
- Lo scenario freddo non cambia (non c'è un'anagrafe da leggere): `Host::open`
  173 contro 182 ms, fette 794 contro 812 ms, nel rumore del carico.

## La riapertura dopo 100 note toccate (tiepido)

| Fase | A, mediana | B, mediana |
|---|---|---|
| `entries_load` | 198 | 73 |
| `entries_decode`, per lettura | 196–249 | 87 |
| `rejoin` | 33 | 4 |
| `Host::open` | 540 | 312 |

## Ciò che i totali non dicono

`wait_indexed` e `store_entries` di A e B non si confrontano corsa per corsa,
e non per la correzione. Le note sono scritte un istante prima della prima
apertura, e l'anagrafe tiene il timbro di cambiamento di un file solo quando
l'apertura lo osserva almeno una grana (2 s su Linux) dopo il timbro
(`change_stamp_settled`). La prima apertura dopo quei 2 s scrive il timbro
di quasi tutte le righe: più di 10000 record, quindi una compattazione
(tre decodifiche), e da lì la riapertura successiva ripristina i metadati
invece di rileggere.

- A, più lento a caricare, passa i 2 s già nello scenario caldo in A1, A2 e
  A4 (in parte: A4 ne ripristina una parte). Il suo scenario tiepido
  ripristina, con una fetta sola.
- B, 130 ms più svelto, arriva allo scenario caldo prima dei 2 s in tutte e
  quattro le corse. Scrive i timbri nello scenario tiepido, che quindi
  rilegge tutto.

Con un vault scritto più di 2 s prima di aprirlo, cioè ogni vault vero, la
differenza non c'è. Le fasi della tabella sopra (`entries_load`, la
decodifica per lettura, `rejoin`, `Host::open`) non dipendono da questo.

## Le corse

I file delle corse non stanno nel repository. Le righe di partenza sono
quelle della tabella stampata da `open_30k`:

```text
FUB_APERTURA_N=30000 cargo run --release --locked -p fub-host --example open_30k
```
