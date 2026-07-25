# `wit/frozen/` — il contratto com'era

Una copia del contratto per ogni versione **pubblicata**, col nome del file
uguale alla versione (`0.1.0.wit` ↔ `package fubmd:abi@0.1.0`).

Non è un archivio: è la linea di base contro cui
[`crates/fubmd-abi/tests/wit_additivity.rs`](../../crates/fubmd-abi/tests/wit_additivity.rs)
verifica la promessa su cui poggia il freeze di M4 — **post-freeze il contratto
cresce solo per aggiunta**.

## Perché non bastava ciò che c'era

Due presidi esistevano già, e nessuno dei due copre questa promessa:

- [`wit_conformance.rs`](../../crates/fubmd-abi/tests/wit_conformance.rs)
  confronta `fubmd-abi` e `wit/fubmd/abi.wit` — **oggi**, fra di loro. Si può
  rinominare un campo in tutti e due, restare conformi, e aver rotto ogni plugin
  già compilato.
- `abi_compatible` applica la regola a runtime (major diversa → rifiuto, minor
  del plugin ≤ minor dell'host → accetto). Nel caso che conta dice **sì**: una
  variante rimossa o un campo rinominato non cambiano la minor, quindi il plugin
  viene accettato e il confine si rompe a valle. La rete di sicurezza dice sì
  proprio nel caso che dovrebbe fermare.

Il costo di scoprirlo tardi è asimmetrico: la build del repo resta verde, a
rompersi sono i plugin di terzi, dopo il rilascio.

## Cosa conta come aggiunta

Non "il file è cresciuto". La forma di ogni cosa già pubblicata deve essere
intatta **e nella stessa posizione**; il nuovo può stare solo in coda.

| costrutto | additivo | rotto |
|---|---|---|
| `record` | un campo **in fondo** | rinominare, ritipare, riordinare, togliere |
| `variant` / `enum` / `flags` | un caso **in fondo** | idem — l'ordine è il discriminante |
| `type x = …` | — | qualunque cambio di destinazione |
| funzione | una funzione **nuova** | cambiare parametri o risultato di una esistente |
| interfaccia | un'interfaccia **nuova** | toglierne una, o spostarci dentro un tipo esistente |
| `world` | un import/export in più | toglierne uno |

Un tipo spostato da un'interfaccia a un'altra è una **rinomina** del suo nome
qualificato, quindi è rotto anche se il nome nudo non cambia.

L'"in fondo" è severo di proposito: nel component model aggiungere un caso a un
`variant` non è nemmeno additivo davvero. La regola che questo progetto ha scelto
dice che lo è, e allora il minimo è che il discriminante di ciò che c'era non si
muova.

## Come si aggiorna

**Prima del freeze di M4** la superficie è ancora libera di evolvere, e il test
non lo impedisce: lo rende visibile. Una rottura deliberata si fa ritagliando la
linea di base — cioè con un commit che **tocca `0.1.0.wit`** e dice perché. In
review si vede; è tutta la differenza con oggi, dove non si vedrebbe affatto.

**Dopo il freeze** un file già qui non si tocca più. Alla pubblicazione di una
versione nuova:

```sh
cp wit/fubmd/abi.wit wit/frozen/<nuova-versione>.wit
```

e si lascia il precedente a fare da presidio. Gli snapshot con una major diversa
da quella corrente vengono ignorati dal confronto: quella rottura è dichiarata, e
`abi_compatible` rifiuta comunque quei plugin.

Svuotare questa cartella spegne il presidio senza rendere rosso niente — per
questo il test fallisce anche solo se non trova una linea di base con la major
corrente.
