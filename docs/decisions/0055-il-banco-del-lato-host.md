# 0055 — Il banco del lato host: un builder, perché i trentacinque non erano lo stesso vault

|  |  |
|---|---|
| **Decisa** | 2026-07-29 |
| **Origine** | `todo.md` §16.2 (seduta 16) |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) · [la seduta](../roadmap/16-crate-sdk-banchi-di-prova.md) · [il gemello, lato provider](0054-il-banco-del-lato-provider.md)

---

Si legge dopo la [0054](0054-il-banco-del-lato-provider.md), che decide dove sta
il confine fra i due banchi e perché il kernel non può stare dall'altra parte.
Qui si decide **che forma ha** il banco che il kernel ce l'ha.

## I numeri, ricontati — e uno di loro non regge la lettura

Il §16.2 diceva **35** helper `vault()`/`workspace()`, **25** `impl
FormatProvider` giocattolo, di cui **nove** `PlainProvider`. Ricontati:

| | la voce | contato | nota |
|---|---|---|---|
| helper `vault()`/`workspace()` | 35 | **35** | esatto |
| `impl FormatProvider` giocattolo | 25 | **25** negli integration test, **più due** negli unit test di `kernel/src/registry.rs` | la voce contava solo `tests/` |
| `PlainProvider` | 9 | **9** | esatto |

I conteggi tengono. Ma il §16.2 non chiedeva soltanto quanti fossero: chiedeva —
implicitamente, chiamandoli *copie* — se fossero la **stessa cosa**. E quella
domanda ha una risposta diversa.

### Le nove `PlainProvider` sono tre comportamenti, non nove copie

Lette una per una, il `descriptor()` dice:

| estensione | file | resa |
|---|---|---|
| `txt` | `trash`, `index_feeding`, `la_maschera`, `transfer_dispatch`, `disattivazione`, `quando_qualcosa_va_storto` (**sei**) | testo nudo |
| `md` | `invoke_command`, `structural_host` (**due**) | testo nudo |
| `md` | `provider_reentrancy` (**una**) | `<pre>…</pre>` |

L'estensione **cambia quali file il kernel instrada a chi**, cioè cambia il
soggetto del test. Sostituire le nove con un `PlainProvider` unico avrebbe
voluto dire cambiare in silenzio ciò che sei test provano, oppure lasciarne
fuori tre — e in entrambi i casi il conteggio sarebbe sceso a uno mentre la
copertura scendeva con lui.

**È il reperto che decide la forma del banco.** Nove nomi uguali su tre
comportamenti sono il caso peggiore possibile: la duplicazione *sembra* più
grande di quello che è nella misura, e più piccola di quello che è nel rischio.

### E i trentacinque helper non costruiscono lo stesso vault

Variano su cinque assi indipendenti, e nessun asse è dominante:

- **dove sta la radice** — 27 fanno un `tempdir`, 8 ricevono la cartella da un
  `&self` (sono metodi su una struct di banco già inventata a mano nel file);
- **quale formato è registrato** — nessuno (5), il testo piatto su `txt` (6) o su
  `md` (3), un provider specifico che fa qualcosa (`LinkListProvider`,
  `TestoNudo`, `MarkdownProvider`…);
- **quali plugin sono dichiarati** — da zero a ventotto id;
- **che file ci sono dentro** — niente, o un corpus con frontmatter e wikilink
  precisi;
- **se si è già scandito**.

Una `fn vault() -> (TempDir, Workspace)` sola avrebbe servito il sottoinsieme
che non chiede niente e sarebbe stata scavalcata da tutti gli altri. **Che è
esattamente il modo in cui si arriva a trentacinque copie**: ogni volta che il
banco comune non copre il caso, se ne scrive uno accanto — e nessuno lo toglie,
perché toglierlo vorrebbe dire allargare quello comune.

## Deciso: `crates/fubmd-testkit`, e dentro un **builder**

```rust
let mut banco = Banco::nuovo()
    .con_estensione("txt")
    .con_plugins(["prova.plugin", "recorder"])
    .con_file("nota.txt", "corpo")
    .con_spia()
    .monta();
```

Un metodo per asse misurato, e il default è il caso più frequente: radice
temporanea, testo di prova su `md`, nessun plugin, nessun file, già scandito.

`Montato` fa `Deref`/`DerefMut` verso `Workspace`, quindi `banco.reindex()` e
`banco.with_host(…)` si scrivono come prima; e **tiene vivo il tempdir da sé**,
che toglie di mezzo il `let (_dir, mut ws) = vault();` — dove l'underscore
sbagliato cancella il vault prima del primo `assert` e il test fallisce dicendo
che un file non c'è.

`TestoDiProva` è **una** struct parametrica sui due assi che variavano davvero
(`per_estensione`, `dentro_un_pre`): nove copie diventano un tipo, senza che
nessun test cambi soggetto.

E `con_spia()` è la seconda metà di ciò che la voce chiedeva al banco del lato
host — *«asserire su cosa è stato emesso»* — con una scelta dentro: il registro
si **svuota dopo il montaggio**, perché ciò che è successo seminando non è ciò
che il test guarda. Chi vuole anche quello ha `senza_scansione()`.

## La misura, che è l'unica prova che la voce sia chiusa

`crates/fubmd-kernel/tests/il_banco_regge.rs`, scritto dopo il banco e non
prima:

| | righe di impalcatura prima della prima asserzione |
|---|---|
| mediana dei 32 file di `kernel/tests/` | **135** |
| il file nuovo | **2** (due `use`) |

E sedici file migrati, contati col diff: **−481 righe, +121**, cioè **−360**
netto. La mediana dei trentadue file preesistenti scende da **135** a **128,5**,
che è meno di quanto quel numero suggerisca — ed è giusto, perché in quei file
gran parte di ciò che sta prima del primo `#[test]` non è impalcatura: sono i
provider che *fanno* qualcosa, cioè il soggetto.

### E il conteggio che la voce aveva scelto non misurava il costo di cui parlava

Gli helper `vault()`/`workspace()` sono passati da **35** a **33**. Due.

Non è un fallimento della migrazione: è che **quel numero non misura niente**.
Un helper non sparisce quando il banco lo assorbe — diventa un involucro di
quattro righe attorno a `Banco::nuovo()…monta()`, e resta contato uguale. Ciò
che è sparito è il **corpo**: le trecentosessanta righe. Nello stesso giro, i
`PlainProvider` sono passati da 9 a **zero** e gli `impl FormatProvider`
giocattolo negli integration test da 25 a **16** — quelli sì, perché lì il
conteggio contava una cosa che scompare davvero.

Vale la pena scriverlo perché la [seduta 16](../roadmap/16-crate-sdk-banchi-di-prova.md)
faceva del conteggio degli helper il proprio argomento («sono **raddoppiati** da
quando la voce è stata aperta»), e la priorità della voce era decisa su quel
moltiplicatore. Il moltiplicatore era reale, il numero che lo rappresentava no.
È la famiglia del [§16.7](../roadmap/16-crate-sdk-banchi-di-prova.md#167-due-presidi-sono-esaustivi-a-memoria-non-per-costruzione)
con un difetto in più: là un numero scritto a mano diventava **falso** in
silenzio; qui il numero era **esatto ogni volta** — ricontato tre volte, tre
volte giusto — e misurava la cosa sbagliata. Un conteggio verificabile non è un
conteggio pertinente, e ricontarlo non lo rende tale.

Un banco che nessuno ha ancora usato per scrivere qualcosa di nuovo è una
promessa, non un guadagno: per questo il file nuovo prova anche il banco stesso.
Se `fubmd-testkit` mentisse, mentirebbero in blocco tutti i test che ci si
appoggiano, e lo farebbero **passando**. Un banco condiviso è codice di
produzione dei test, e va provato come tale — la prima asserzione del file è che
`con_estensione("txt")` instradi davvero su `txt`, che è la cosa che se fosse
falsa farebbe provare il vuoto a chiunque.

## Il `Deref` ha un buco, e va tappato con una via d'uscita generale

Trovato migrando: `Deref`/`DerefMut` prestano `&Workspace` e `&mut Workspace`, e
non bastano per un builder che **consuma `self`** — `Workspace::with_view_states(mut self) -> Self`
vuole il `Workspace` per valore, e il banco lo possiede.
`kernel/tests/stato_di_vista.rs` è rimasto fuori dalla migrazione per questo.

La tentazione è un metodo sul banco per ognuno di quei builder. È la scelta
sbagliata due volte: un banco che cresce di un metodo ogni volta che il kernel
ne aggiunge uno si riscrive dietro al kernel, e — peggio — **un banco che non
esprime un caso viene scavalcato con un helper scritto a mano accanto**, che è
esattamente il meccanismo con cui si arriva a trentacinque copie. Il difetto che
la voce descrive si riproduce dentro la cosa che dovrebbe curarlo.

Quindi `Montato::adatta(|ws| …)`, una via d'uscita sola che vale per tutti i
builder che consumano, presenti e futuri. Con quella `stato_di_vista.rs` è
migrato e i suoi cinque test passano.

## Il ciclo di dipendenze, verificato invece che supposto

`fubmd-testkit` dipende da `fubmd-kernel`, e `fubmd-kernel` dev-dipende da
`fubmd-testkit`. Cargo lo risolve — verificato, il workspace compila — perché
le dev-dependency non entrano nel grafo della libreria: la `lib` del kernel non
vede il testkit, solo i suoi `tests/` lo vedono.

Il presidio che lo tiene innocuo è `il_banco_di_prova_non_entra_in_nessuna_libreria`
in `dependency_invariant.rs`, e guarda **tutti i membri del workspace, presenti
e futuri**, non un elenco: è la forma che non invecchia quando nasce l'ennesimo
crate. L'altro — `l_sdk_non_vede_il_kernel` — è raccontato nella
[0054](0054-il-banco-del-lato-provider.md#linvariante-che-la-seduta-invoca-non-era-presidiata).

## Cosa il banco **non** assorbe, e va detto

I cinque helper di `fubmd-features/tests/` e `fubmd-format-markdown/tests/`
seminano un corpus con un frontmatter e dei wikilink precisi, e **quel corpus è
il soggetto del test**. Portarlo nel testkit vorrebbe dire che il crate spedisce
i dati di prova di quattro test che non si parlano.

Restano dove sono, e prendono dal banco solo l'impalcatura. Il §16.2 prometteva
che «uno solo li serva tutti»: è vero per l'impalcatura e falso per i dati, e la
differenza è quella che tiene un banco condiviso utile invece che gonfio.

Stessa cosa per i provider giocattolo che **fanno** qualcosa —
`LinkListProvider`, `TestoNudo`, `LinkLineProvider`: non sono impalcatura, sono
il soggetto. Il conteggio dei `FormatProvider` giocattolo scenderà meno di
quanto il numero 25 suggerisca, ed è giusto così.

## Il cappello di una seduta può dichiarare anche una separazione

La [0053](0053-il-contratto-ha-una-sorgente.md) ha inaugurato il caso in cui è
la **seduta** a dichiarare in anticipo che due voci vanno chiuse **insieme**.
Questa è il caso opposto, e vale la pena nominarlo perché il precedente
altrimenti si legge storto: un cappello che parla di due voci non sta sempre
dicendo «sono una».

Il cappello della 16 dichiarava un **confine** — l'SDK di qua, il testkit di là,
e non possono stare nello stesso crate. Un confine fra due cose è precisamente
ciò che le rende due, quindi la stessa forma retorica (una frase in testa alla
seduta che parla di entrambe le voci) ha prodotto qui la conclusione contraria:
due verbali, perché due ragionamenti interi.

Il criterio resta quello della [0031](0031-chi-possiede-i-bundle.md)/[0032](0032-il-runner-dei-job.md):
un verbale è un ragionamento intero, non una quota di lavoro. Ciò che si aggiunge
è che **un cappello va letto per cosa afferma, non per quante voci nomina** —
«sono la stessa domanda vista da due lati» chiede un verbale, «fra loro c'è un
confine» ne chiede due.

## Cosa si è scartato

- **Una `fn vault()` sola nel testkit.** È la proposta letterale della voce, ed è
  quella che i trentacinque helper hanno già scartato per conto loro: se un banco
  comune non copre il caso, se ne scrive uno accanto. Un builder non ha quel
  punto di rottura.
- **Un `PlainProvider` unico, non parametrico.** Avrebbe fatto scendere il
  conteggio a uno e la copertura con lui, in silenzio, su sei test.
- **Il banco dentro `fubmd-kernel`, sotto una cargo feature.** Toglie un crate ma
  mette il banco nella libreria del kernel, e l'unificazione delle feature lo
  accende per chiunque. È la stessa ragione per cui non sta nell'SDK
  ([0054](0054-il-banco-del-lato-provider.md)), applicata dall'altro lato.
- **Assorbire anche `tests/common/mod.rs`** (arrivato con la
  [0053](0053-il-contratto-ha-una-sorgente.md)). Non si toccano: quel modulo
  legge i sorgenti Rust per i presidi del contratto, serve solo `fubmd-abi`, e
  vive dentro `fubmd-abi/tests/`. Metterlo nel testkit metterebbe il **kernel**
  nel grafo di chi vuole solo leggere un file `.rs`. I due non si sovrappongono e
  la linea fra loro è la stessa di sempre: cosa serve avere fra le mani.

## Cosa resta scoperto, dichiarato

- **La migrazione degli helper che restano.** È lavoro che non decide niente —
  una casella residua nel senso della [0052](0052-cio-che-va-storto-e-un-evento.md),
  non una voce. La forma è decisa e provata; applicarla agli helper rimasti si fa
  senza aprire un verbale.
- **`ogni_view_ufficiale()`, che il [§16.7](../roadmap/16-crate-sdk-banchi-di-prova.md#167-due-presidi-sono-esaustivi-a-memoria-non-per-costruzione)
  chiede, ha adesso un posto naturale e non è stato costruito.** Sarebbe nel
  testkit, e costruirlo vorrebbe dire mettere `fubmd-features` fra le dipendenze
  di questo crate — che è una decisione della seduta 16 e non di questo verbale.
  Il posto è nominato nel sorgente perché chi aprirà quella voce lo trovi già
  scelto.
- **Il §16.3** resta la voce che questa sbloccava, e la sua precondizione è
  soddisfatta. Il suo *primo tempo* — la cargo feature per bundle — non è stato
  preso qui e resta scorporabile come la voce dichiara.
