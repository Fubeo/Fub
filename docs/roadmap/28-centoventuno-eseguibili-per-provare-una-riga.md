# 28. Centoventuno eseguibili per provare una riga

Una **seduta** della [roadmap infrastrutturale](../todo.md), e per la prima
volta il soggetto non è il prodotto: è il **ciclo di lavoro di chi lo scrive**.
Una sola voce, perché la misura ne ha trovata una sola che chieda di decidere —
tutto il resto di ciò che è stato cronometrato è un difetto, e sta in
[todo.md](../todo.md#i-difetti-misurati).

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
roadmap, e la voce qui sotto non tocca né un test né un'asserzione: tocca
**quanti eseguibili** ne escono.

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

*aperta · strato **presidi** · **P1***

**1. La domanda.** In Cargo ogni file in `tests/` è un crate a sé, che linka
l'intero albero e produce un eseguibile suo. Sono centoventuno. Il numero non è
stato scelto: è cresciuto un file per volta, ognuno per una ragione buona.
**Quanti eseguibili vogliamo davvero, e quali test hanno bisogno di un processo
tutto loro?**

**2. Che cosa si osserva oggi, misurato.** Cronometrato il 2026-08-11 su quattro
core, profilo `dev`.

I centoventuno file stanno così:

| Crate | File in `tests/` |
|---|---|
| `fub-kernel` | 51 |
| `fub-features` | 27 |
| `fub-host` | 19 |
| `fub-format-markdown` | 11 |
| `fub-abi` | 10 |
| `fub-app` | 3 |

Ogni file diventa un eseguibile che linka tutto ciò che sta sotto di lui. La
mediana di un binario di prova è **61 MB**; i binari di prova su disco fanno
**55 GB**, e `target/` sta a **79 GB** (60 di `deps/`, 17 di `incremental/`).

La cifra che conta però non è quella del disco, è quella dell'attesa. Il ciclo
di chi lavora — cambiare una riga del kernel, e voler far girare i test:

```
touch crates/fub-kernel/src/lib.rs
cargo test --no-run --workspace     →  250 secondi
```

Quattro minuti e dieci prima che un solo test possa partire. E non sono
compilazione: le unità ricompilate sono sei (i sei crate con dei test), e il
tempo se ne va nel **rilinkare decine di eseguibili da 61 MB, quattro alla
volta**. Per confronto, ricostruire le sole librerie dopo aver toccato il crate
radice costa fra i 6 e gli 11 secondi.

Due cose vanno dette prima di proporre qualunque forma, perché sono il prezzo
vero:

* **La CI chiama sette binari per nome.** `ci.yml` ha almeno sette passi della
  forma `cargo test -p <crate> --test <nome>` — `wit_conformance`,
  `wit_additivity`, `dependency_invariant`, `ts_enums`, `le_cargo_feature`,
  `i_moduli_non_si_parlano` — e ognuno esiste come passo separato perché ha una
  ragione scritta accanto. Consolidare i file vuol dire riscrivere quei passi in
  filtri per nome di test, che è una cosa più debole: un filtro sbagliato passa
  in silenzio, un `--test` sbagliato è un errore.
* **Almeno un file ha bisogno davvero del suo processo.**
  `crates/fub-kernel/tests/la_radice_non_si_muove.rs` chiama `set_current_dir`,
  che è globale al processo: metterlo insieme ad altri li avvelena. È il caso
  che dimostra che la risposta non può essere «un binario per crate e basta».

**Come si rimisura.**

```sh
# tutti i comandi di questo blocco si danno dalla radice del repo
ls crates/*/tests/*.rs | wc -l
for c in crates/*/; do echo "$(basename $c) $(ls $c/tests/*.rs 2>/dev/null | wc -l)"; done
touch crates/fub-kernel/src/lib.rs && time cargo test --no-run --workspace
grep -c '\-\-test ' .github/workflows/ci.yml
grep -rln "set_current_dir\|env::set_var" crates/*/tests
```

**3. Le forme, e chi paga.**

- [ ] **(a) Un eseguibile per crate, con i file di oggi come moduli.** Sei file
      d'ingresso (`tests/kernel.rs` con `mod storage; mod workspace; …`) e i
      centoventuno file spostati sotto una cartella, invariati. Stessi test,
      stessi nomi, **sei link invece di centoventuno**. Paga **la CI**, che
      perde i sette `--test` e deve dire la stessa cosa con dei filtri; e paga
      **l'isolamento**: un `abort` o un `set_current_dir` porta giù i vicini,
      quindi i pochi file che ne hanno bisogno vanno tenuti fuori a mano e la
      ragione va scritta accanto — cioè nasce una regola nuova da mantenere.
- [ ] **(b) Consolidare solo dove pesa, e lasciare il resto.** I cinquantuno di
      `fub-kernel` e i ventisette di `fub-features` sono i due terzi del
      problema; `fub-abi` e `fub-app` si lasciano come sono, e con loro cinque
      dei sette `--test` della CI. Paga **chi legge il repo**: due crate seguono
      una convenzione e quattro un'altra, e la differenza va spiegata ogni
      volta. In cambio si prende quasi tutto il guadagno senza toccare i
      presidi che la CI nomina.
- [ ] **(c) Com'è oggi.** Paga **chi lavora al repo**, quattro minuti per volta,
      e la cifra cresce da sola: ogni file di prova nuovo è un eseguibile nuovo,
      e i file di prova nuovi sono esattamente ciò che il resto di questa
      roadmap produce. È il costo che non si vede perché non fallisce mai.

**4. Che cosa il repo ha già deciso qui vicino.**

* La [seduta 16](16-crate-sdk-banchi-di-prova.md): i banchi e i confini fra
  crate si sono decisi **prima** di ciò che li moltiplica. Questa voce è ciò che
  li ha moltiplicati, arrivato al conto.
* La [seduta 17](17-presidi-che-restano.md): il criterio per la scadenza di un
  presidio è **se il costo cresce con l'attesa**. Qui cresce, ed è il motivo per
  cui la voce non è una P2: ogni voce chiusa della roadmap aggiunge dei file a
  `tests/`, quindi decidere dopo vuol dire consolidarne di più.
* La [0054](../decisions/0054-il-banco-del-lato-provider.md) e la
  [0055](../decisions/0055-il-banco-del-lato-host.md): due banchi, uno per lato.
  Quella divisione è di **soggetto** e non di file, e non è in discussione qui:
  resterebbe intera anche con sei eseguibili.
* Il difetto [`0229`](../todo.md#i-difetti-misurati): la stessa misura, ma
  meccanica. I due si sommano — chi tocca il crate radice paga prima i tre
  codegen di `fub-app`, poi i centoventuno link — e si possono chiudere in
  qualunque ordine.
