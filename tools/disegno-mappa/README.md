# La mappa del disegno

`crates/fub-disegno/mappa.tsv` dice, per ogni funzione di VectorCraft, se e
dove Fub la offre: è il contratto della parità del disegno
([la pagina del disegno](../../docs/architecture/disegno.md#dove-sta-il-codice)). Non è
`crates/fub-disegno/src/mappa.rs`, che lega gli elementi di un file agli
oggetti del motore.

## Le righe

Una riga per funzione, con la chiave `(fonte, id)`. Le cinque fonti, lette
dalla copia in `vendor/vectorcraft/`:

| Fonte | Da dove |
|---|---|
| `motore` | i `cmd!` di `crates/engine/src/cmd/`, fuori dai `#[cfg(test)]` e dai loro file |
| `interfaccia` | `UI_COMMANDS` di `crates/ui-egui/src/menus/ui_commands.rs`, con le costanti lette dal loro modulo |
| `strumento` | `TOOL_GROUPS` di `crates/tools/src/catalog.rs` e gli strumenti aggiunti, con il loro `ID` |
| `effetto` | il catalogo di `crates/effects/`, gli stili di deformazione e il Pathfinder |
| `pannello` | i `pub mod` di `crates/ui-egui/src/panels.rs` che hanno il loro file |

Lo stesso id in due fonti fa due righe (per esempio `file.place`, del motore e
dell'interfaccia).

## Le colonne

La prima riga del file è un commento con la revisione di VectorCraft; la
seconda è l'intestazione.

| Colonna | Chi la scrive | Contiene |
|---|---|---|
| `fonte`, `id`, `etichetta`, `menu` | l'estrazione | la funzione come la dichiara il motore |
| `famiglia`, `fase`, `task` | a mano | la famiglia, con la fase e il task di K6 (`awk -F'\t' '$7=="T12"'`) |
| `stato` | a mano | `da fare`, `fatto` (ha il suo caso), `fub` (la serve già una funzione di Fub), `escluso` |
| `posto`, `pigro` | a mano | dove sta nell'interfaccia e quando si carica |
| `nota` | a mano | per `fub` la funzione di Fub, per `escluso` il perché con la decisione, «aspetta T…» |
| `etichetta_it` | l'estrazione | l'etichetta di `i18n/it.tsv`, o quella inglese se manca |

Un tab dentro un'etichetta diventa uno spazio, perché non sposti le colonne.

## Rigenerare

```bash
node tools/disegno-mappa/estrai.mjs            # riscrive la mappa
node tools/disegno-mappa/estrai.mjs --stampa   # la scrive sullo standard output
```

Dopo un aggiornamento di `vendor/vectorcraft/`: le colonne scritte a mano
restano, una riga nuova nasce «da fare» senza famiglia, e lo script stampa le
righe nuove e quelle sparite. Una costante di `UI_COMMANDS` che non si trova
ferma l'estrazione: va copiato il file che la dichiara (i percorsi gestiti
sono in `tools/vendor-craft/motori.mjs`).

## La guardia

```bash
node .github/scripts/check-disegno-mappa.mjs             # la mappa di oggi
node .github/scripts/check-disegno-mappa.mjs --finale    # anche: nessuna riga «da fare»
node .github/scripts/check-disegno-mappa.mjs --self-test
node --test tools/disegno-mappa/estrai.test.mjs
```

Cade quando:

- una riga manca, avanza o è doppia rispetto all'estrazione, o una colonna
  estratta è diversa (la nomina);
- la revisione della prima riga non è quella di `upstream.lock`;
- famiglia, fase, task, stato, posto o pigro hanno un valore non ammesso, o
  fase e task non sono quelli della famiglia;
- una riga `fub` non nomina nella `nota` la funzione di Fub, o una riga
  `escluso` non dice il perché con D6, D9 o D12;
- un «aspetta» sta su una riga che non è «da fare», o nomina un task che non
  c'è;
- una riga `fatto` non ha il suo caso in
  `crates/fub-disegno/tests/famiglie/<famiglia>.json`: un elenco di casi (o
  `{"casi": […]}`) con `id` e, se serve, `fonte`.

Con `--finale` cade anche per ogni riga ancora «da fare»: è il cancello della
parità. `--vectorcraft <cartella>` la confronta con un'altra copia del motore,
per provarla. Gira in `scripts/check.sh` con le guardie di `vendor/`.
