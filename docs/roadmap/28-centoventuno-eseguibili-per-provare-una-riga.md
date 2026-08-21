# 28. Centoventuno eseguibili per provare una riga

Una **seduta chiusa** della [roadmap infrastrutturale](../todo.md), e per la
prima volta il soggetto non era il prodotto: era il **ciclo di lavoro di chi lo
scrive**. Una sola voce, perché la misura ne aveva trovata una sola che
chiedesse di decidere — tutto il resto di ciò che è stato cronometrato è un
difetto, e sta in [todo.md](../todo.md#i-difetti-misurati). **La voce è chiusa
dalla [0145](../decisions/0145-gli-eseguibili-restano-a-calare-e-quanto-pesa-un-link.md),
e nessuna delle tre forme che proponeva è quella presa**: la domanda era mal
posta di un fattore, e il consuntivo in coda dice quale.

[← indice](../todo.md) · [le voci a leva più alta](leva.md) ·
[i verbali delle decisioni chiuse](../decisions/README.md)

---

**Da dove viene questa seduta: da un cronometro sulla struttura, non sul
prodotto.** La domanda di partenza era se la struttura del progetto Rust — otto
crate, il grafo delle dipendenze, la forma della compilazione — fosse
inutilmente complessa o inefficiente. La risposta sulla parte che sembrava
sospetta è **no**, ed è misurata: il grafo è profondo quattro, senza cicli e
senza scorciatoie, `fub-features` dipende dal solo `fub-abi` (cioè il confine
del plugin tiene davvero), e compilare le otto librerie costa in tutto una
manciata di secondi — `fub-abi` 2,2 s, `fub-kernel` 1,1 s, `fub-sdk` 0,6 s,
`fub-features` 0,6 s, `fub-format-markdown` 0,2 s, `fub-testkit` 0,1 s. **Otto
crate non costano niente.** Sono la parte che funziona.

Il tempo sta tutto da un'altra parte, e in due punti. Uno è meccanico e non
chiede di decidere niente: `fub-app` si compila tre volte per 883 righe, ed è il
difetto [`0229`](../todo.md#i-difetti-misurati). L'altro è questa voce.

La lente è la quattordicesima del [criterio](../todo.md#il-criterio) e si scrive
in una domanda sola:

> Quanto costa, in secondi, sapere che una modifica non ha rotto niente — e
> quella cifra la paga una scelta che qualcuno ha preso, o nessuno?

Non è la domanda dei difetti di prestazione, che riguardano l'app accesa e la
persona che la usa. Questa riguarda **chi lavora al repo**, ed è la specie di
costo che nessun presidio può vedere perché non è un fallimento: tutto passa,
solo lentamente, e la lentezza cresce con ogni file che si aggiunge.

**Che cosa questa seduta non è.** Non è una proposta di scrivere meno test. Le
circa 55 000 righe di test sono il presidio su cui poggia tutto il resto della
roadmap, e la voce qui sotto non tocca né un test né un'asserzione: credeva di
toccare **quanti eseguibili** ne escono, e ha finito col toccare **quanto pesa
ognuno** — che è ancora meno.

**Due osservazioni della stessa misura non sono diventate voci, e va scritto
perché nessuno le riapra.**

* **I file lunghi** — `workspace.rs` a 6685 righe, `traits.rs` a 4593 — non
  costano niente in compilazione, perché rustc lavora per crate e non per file.
  Se sono un problema è di leggibilità, ed è già mezza nominata dalla
  [§27.3](27-tre-scommesse-che-nessuno-ha-provato.md#273-la-grana-del-lucchetto-è-il-vault-e-chi-muterà-non-sarà-di-casa).
* **`fub-sdk` (2900 righe) e `fub-testkit` (628)** sembrano i due candidati a
  essere divisioni che non comprano niente, e non lo sono: il primo è ciò che un
  formato di terzi importa senza vedere il kernel, il secondo è già una
  dev-dependency e costa 0,1 s. Nessuno dei due va riassorbito.

---

### 28.1 Ogni file di prova è un eseguibile, e sono centoventuno

*chiusa dalla [0145](../decisions/0145-gli-eseguibili-restano-a-calare-e-quanto-pesa-un-link.md) ·
strato **presidi** · **P1***

## Com'è finita, e cosa lascia

La domanda era **quanti eseguibili vogliamo davvero, e quali test hanno bisogno
di un processo tutto loro**. La risposta è **tutti quelli di adesso, e tutti**:
gli eseguibili restano uno per file di prova, e a calare è **quanto pesa un
link**. La chiude la
[0145](../decisions/0145-gli-eseguibili-restano-a-calare-e-quanto-pesa-un-link.md)
con una riga di `[profile.dev]` — `split-debuginfo = "unpacked"` — più il
presidio che la tiene, `.github/scripts/check-profilo-dev.mjs`.

**La premessa non reggeva, ed è la parte che vale il giro.** La voce attribuiva i
quattro minuti al **numero** degli eseguibili. Il numero è però solo uno dei due
fattori, e l'altro — quanto costa **un** link — non l'aveva misurato nessuno:
era il default di cargo, che ricopia l'informazione di debug dentro ogni binario.
Sembrava vera per un motivo onesto, e vale ricordarlo: il numero è l'unica delle
due grandezze che si vede, perché mentre si aspetta cargo stampa una riga per
eseguibile e il totale sale insieme al conteggio sotto gli occhi.

Misurato sulla stessa macchina a quattro core, stesso protocollo (build piena,
poi `touch crates/fub-kernel/src/lib.rs`, poi
`cargo test --no-run --workspace`):

| | mediana di un eseguibile | i centotrentasette insieme | il giro dopo un `touch` |
|---|---|---|---|
| com'era | 62,4 MB | 13,8 GB | 189,8 s |
| con `unpacked` | **25,6 MB** | **4,94 GB** | **119,0 s** |

I secondi sono il numero meno affidabile dei tre, per la ragione della
[0113](../decisions/0113-il-banco-conta-le-operazioni.md). Le due colonne che
decidono sono le altre, perché sono un conto: il linker scrive quasi nove
gigabyte in meno a ogni passata, e li scrive in meno per ognuno degli eseguibili
— cioè anche per ogni file di prova che il resto della roadmap aggiungerà, senza
che nessuno debba ricordarsene. Non si perde un byte di informazione di debug:
resta nei `.o` accanto ai binari, e un backtrace continua a stampare file e riga
(verificato dentro un banco `cargo test` vero, non solo a mano).

**Il tetto delle forme (a) e (b), misurato invece che stimato.** Con `--timings`,
dopo un `touch` del kernel, cargo ricostruisce 130 unità: **123 sono bersagli di
prova e valgono 212,2 s di CPU**, tutto il resto — librerie, binario, esempi —
sono 7 unità per 20,8 s. Ma la mediana di un bersaglio è **0,77 s**, il massimo
14,53 s, e **tredici bersagli su centoventitré portano metà della CPU**. Il costo
fisso per eseguibile — l'unico che la consolidazione toglie — è grosso modo la
mediana: centoventitré meno sei, per meno di un secondo l'uno. L'altra metà è
codegen del codice di prova, che consolidare non toglie: lo sposta.

**Il prezzo che le due forme chiedevano in cambio era permanente**, e la voce ne
sottostimava una parte. I sei passi `cargo test -p … --test <nome>` di `ci.yml`
sarebbero diventati filtri per nome, e un filtro sbagliato passa in silenzio dove
un `--test` sbagliato è un errore. Ma il peggio è che ogni file di prova nuovo
avrebbe dovuto essere aggiunto a un elenco di `mod` — e un `mod` dimenticato è
**un file che compila e non gira mai** — e prima esaminato per stato globale al
processo. Quest'ultimo esame è più largo di come la voce lo descriveva: i file
con stato globale non sono uno ma **cinque**, perché oltre al `set_current_dir` di
`la_radice_non_si_muove.rs` ci sono quattro `panic::set_hook` (`il_panico.rs`,
`batch_and_origin.rs`, `un_lucchetto_solo.rs`, `annullare.rs`) che il `grep`
proposto qui non trovava.

**Una misura è invecchiata in poche ore, e il modo in cui è invecchiata dà
ragione al criterio della [seduta 17](17-presidi-che-restano.md)**: i file di
`tests/` erano centoventuno quando questa seduta è stata scritta e sono
**centoventotto** quando è stata chiusa, lo stesso giorno. Il titolo resta quello
di allora perché è un'ancora citata da fuori.

**Cosa questa seduta lascia al piano.** Non un lavoro: un metro. Una misura che
cronometra un totale e conta gli oggetti che lo compongono ha sempre **due**
fattori, e attribuire il tempo a quello che si vede è il modo naturale di
sbagliare. La domanda che avrebbe risparmiato il giro è una sola — *quanto costa
**uno**?* — e qui costava 0,77 s di mediana, cioè un numero che nessuna delle tre
forme proposte guardava.

**Non ci sono caselle.** Restano due cose scritte apposta perché nessuno le
riapra come se fossero lavoro:

* **il prezzo, dichiarato**: l'informazione di debug segue `target/`, quindi un
  eseguibile copiato fuori di lì resta senza. Per dei binari di prova e per
  l'app in sviluppo non lo paga nessuno, e sul profilo `release` la riga non c'è;
* **dove guardare** se un giorno l'attesa tornasse a farsi sentire: i tredici
  bersagli che portano metà della CPU (`i_moduli_non_si_parlano` e
  `la_foglia_senza_contesto_costa_di_piu` 14,5 s l'uno, `le_sveglie` 12,8,
  `la_radice_non_si_muove` 12,7, l'esempio `una_ricerca` 10,0, `search_e2e` 9,7,
  `i_cataloghi` 7,8). È una misura mirata su tredici file, non una
  riorganizzazione di centoventotto.

**Come si rimisura.**

```sh
# tutti i comandi di questo blocco si danno dalla radice del repo
ls crates/*/tests/*.rs | wc -l
for c in crates/*/; do echo "$(basename $c) $(ls $c/tests/*.rs 2>/dev/null | wc -l)"; done
touch crates/fub-kernel/src/lib.rs && time cargo test --no-run --workspace
touch crates/fub-kernel/src/lib.rs && cargo test --no-run --workspace --timings
grep -c '\-\-test ' .github/workflows/ci.yml
grep -rln "set_current_dir\|set_var\|set_hook" crates/*/tests
node .github/scripts/check-profilo-dev.mjs
```
