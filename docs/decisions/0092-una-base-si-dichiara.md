# 0092 — Una base si dichiara

**Voce**: [§23.11](../roadmap/23-cosa-costano-le-decisioni-chiuse.md#2311-la-base-di-una-scrittura-è-facoltativa-e-la-passa-un-chiamante-solo) ·
**Seduta**: [23. Cosa costano le decisioni chiuse](../roadmap/23-cosa-costano-le-decisioni-chiuse.md) ·
**Strato**: contratto · **Priorità**: P0 ·
**Commit**: *(questo commit)*

---

`write_document` prendeva `base: Option<Revision>`. Adesso prende un
`WriteBase`, che è un tipo a due casi nominati:

```rust
pub enum WriteBase {
    /// «Scrivi solo se il file è ancora quello da cui sono partito.»
    DescendsFrom(Revision),
    /// «Scrivi: questo testo non discende da un testo di prima, e se ne copre
    /// uno è voluto.»
    Dictated,
}
```

Il numero di modi di scrivere un documento non cambia: erano due prima e sono
due adesso. Cambia **che si dicano**. E cambia una cosa che non è di stile: con
l'`Option`, scrivere ciechi era ciò che succedeva **omettendo** un argomento —
cioè il default, e un default non lo sceglie nessuno.

---

## Cosa aveva lasciato a metà la 0089, e perché è un ritaglio due commit dopo

Questa voce l'ha aperta la [0089](0089-da-cosa-e-partita-una-scrittura.md), che
è di tre commit fa. Quel verbale ha aggiunto la guardia che mancava — dire da
cosa si è partiti, ricevere `Conflict` invece di sovrascrivere in silenzio — e
l'ha resa opzionale con un argomento che **è ancora buono**: una riscrittura
totale può essere compiuta da sé. Un importer che crea una nota, un template che
scrive la nota di oggi, il ripristino di una versione non stanno correggendo un
testo che hanno letto; obbligarli a esibire una base vorrebbe dire farsela
inventare, e una base inventata è una guardia che dice sempre di sì.

Quell'argomento non è stato riaperto: è la ragione per cui `Dictated` **esiste**
invece di essere stato tolto. Ciò che non reggeva era la forma. Un `Option` non
fa scegliere fra due mestieri, ne fa **omettere** uno; e ciò che si omette non si
legge in un diff. La 0089 si è chiesta *se* la guardia esistesse e ha risposto
bene. Non si è chiesta **come si sbaglia a non usarla**, e la risposta era: non
si sbaglia, si dimentica — che è il modo in cui una guardia protegge chi se ne
ricorda e nessun altro.

Ne viene un fatto che vale scrivere invece che nascondere: **la linea di base è
stata ritagliata due volte sulla stessa firma in tre commit.** Il commento della
0089 in `wit/frozen/0.1.0.wit` è ancora lì e argomenta il primo; il paragrafo di
questa decisione gli sta accanto, e la riga nuova nella
[tabella dei ritagli](../architecture/wit-congelato.md) lo dice in chiaro. Fra i
due ritagli non c'è stato nessun rilascio, quindi il costo è di questo repo e non
di chi ha compilato un plugin. Dopo M4 lo stesso cambio costerebbe una major, ed
è la ragione per cui questa voce era P0 per il **tipo** e non per l'importanza —
il criterio di questa roadmap.

**La strada additiva è la stessa che il repo ha già rifiutato due volte.** Una
`write_document_declaring` accanto lascerebbe per sempre due modi di scrivere un
documento intero, di cui uno cieco e più corto da scrivere; è il ripiego che la
[0049](0049-una-posizione-dentro-un-documento.md) ha scartato per `resolved`, che
la 0089 ha scartato per sé stessa, e che la [0007](0007-contesto-di-sessione.md)
descrive come la trappola delle due firme per la stessa domanda.

---

## Il criterio, che è già scritto e questa è la terza volta di fila

La [0007](0007-contesto-di-sessione.md) lo dice dello span: *«un flag che
chiunque può dimenticare di leggere protegge meno di un campo che, quando non è
vero, non c'è»*. La [0091](0091-un-orario-di-parete-non-e-un-intervallo.md) l'ha
appena applicato a `zone: option<string>`, dove i due stati sono due significati
e non un valore e la sua mancanza.

Qui la stessa regola dice l'altra metà: **quando c'è una scelta, la si nomina**.
Il campo non manca mai — c'è sempre una risposta alla domanda «da cosa parti?» —
e allora la firma la deve **chiedere**, non accettare il silenzio come una delle
due risposte.

Tre decisioni di fila che applicano lo stesso criterio a tre firme diverse non
sono una ripetizione: sono la parte di questo progetto in cui una regola smette
di essere un'opinione di un verbale e diventa un modo di leggere le firme.

---

## I chiamanti, passati uno per uno

La voce diceva che la distinzione esisteva già a verbale e non era mai stata
applicata al codice. Applicarla è stato il lavoro di sostanza, e la risposta non
è la stessa per tutti.

**Dettano davvero** — e ognuno per una ragione sua, scritta accanto alla riga:

- `fub-features/src/versioning.rs`, il comando `version.restore`: un ripristino
  non discende dal testo che c'è adesso, lo sostituisce apposta. Guardarlo con la
  revisione corrente vorrebbe dire rifiutare il ripristino ogni volta che c'è
  qualcosa da ripristinare, cioè sempre. Ciò che copre non è perduto: il dedup
  (D6) ne fotografa una versione prima.
- `fub-host/src/session.rs`, `restore_version`: l'altra metà dello stesso gesto,
  e adesso le due righe dicono la stessa parola.
- `fub-format-markdown/src/transfer.rs`, l'import: è il caso in cui la parola si
  guadagna il nome. E con `ConflictPolicy::Replace` la sovrascrittura è per di
  più **richiesta**, da chi ha scelto la politica — le altre due strade di quel
  `match` esistono apposta per chi non la vuole.
- `fub-kernel/src/host/kernel.rs`, `create_document`, e
  `fub-kernel/src/workspace.rs`, `create_note`: creano un documento che **non
  c'è**, e l'hanno appena verificato. Non c'è nessuna revisione da cui
  discendere, e chiederne una sarebbe chiedere l'impronta del nulla.

**Discendono**: la shell, che è sempre stata l'unica a portare una base vera; e
`apply_edit` del doppio di `fub-sdk`, che scrive il testo su cui ha appena
calcolato gli edit — dire `Dictated` lì sarebbe stato il falso in una firma che
esiste per non dirlo.

**Inoltrano e basta**, senza decidere niente: `fub-kernel/src/host/guard.rs`,
`fub-host/src/jobs.rs`, e l'impl del trait in `host/kernel.rs`.

### La forma a due argomenti dentro casa è sparita

`Workspace::write_document` a due argomenti chiamava
`write_document_from(.., None)`. Era la stessa trappola del contratto, in
miniatura e in casa: **due firme per la stessa domanda, di cui una cieca e più
corta da scrivere**. Lasciarla in piedi avrebbe chiuso la voce a metà — il modo
silenzioso di scrivere ciechi sarebbe rimasto, solo un piano più in basso.

Quindi è sparita, e `write_document_from` ha preso il suo nome. Il prezzo è che
ogni scrittura del kernel, test compresi, adesso dichiara: sono
duecentonovantadue punti, e **duecentosettantaquattro di loro dicono
`Dictated`**. Che il rapporto sia questo non è un argomento contro il cambio, è
la sua misura: prima duecentosettantaquattro scritture cieche si scrivevano senza
dire niente, e trovarle voleva dire leggere una funzione alla volta. Adesso
`rg 'WriteBase::Dictated'` le elenca.

### E la shell, dove il difetto si ripeteva un piano sopra

`Buffer.base` in `frontend/src/panels/document.ts` era `string | null`, e il
`null` teneva insieme **due cose diverse**: «non so da cosa discendo» — una bozza
recuperata da una sessione che non lo sapeva — e «ho scelto di sovrascrivere» —
il «vince il mio testo» dopo un conflitto. Sono due frasi che si leggono uguali
proprio nel punto in cui contano.

Adesso il buffer tiene un `WriteBase`, e le due si dichiarano **dove
succedono**: chi recupera una bozza senza base scrive `DETTA` lì, dove il fatto
si scopre, invece che al salvataggio, dove sembrerebbe una scelta di chi salva.
Il comando `write_document` dell'IPC prende un `base` **non opzionale**: un campo
mancante è un errore di deserializzazione, cioè una shell che dimentica di
dichiarare smette di scrivere invece di scrivere di nascosto.

---

## Il ritrovamento: il banco non era cieco, era la prova a mancare

La voce sospettava che `wit_additivity` non vedesse un parametro *ritipato* —
fra le rotture simulate c'erano «un parametro in più» e «un parametro
rinominato», e un cambio di tipo no.

**Eseguendo, il sospetto è caduto per metà.** Il confronto prende la rottura:
`prefix` confronta le coppie `(nome, tipo)` posizione per posizione, e il suo
messaggio nomina già il ritipo. Ciò che mancava non era il presidio: era la
**prova che quel ramo funzioni**. Un ramo che nessuno esercita è un ramo di cui
si scopre lo stato il giorno che serve — che è la stessa specie di silenzio che
la [0090](0090-una-sequenza-e-una-modalita-che-scade.md) aveva trovato nel
conflitto di prefisso, dove la cosa utile non era la feature ma ciò che
nascondeva.

Le rotture simulate sono quindi **venti** e non più diciannove. È la sesta volta
di fila che rileggere una voce contro i sorgenti la cambia prima di scriverla, e
questa volta l'ha cambiata in meglio: la voce prometteva un buco del presidio, e
la misura ha detto che il buco era nel banco di prova. Le due cose non si
sarebbero distinte discutendone.

---

## Il pericolo, messo in scena invece che descritto

La voce nominava il caso e nessuno l'aveva mai provato. Messo accanto alla
[0030](0030-il-rilevamento-si-puo-chiedere.md): con `watching: false` — vault su
share di rete, cloud drive, vault sincronizzato — il watcher non vede la modifica
esterna **e**, finché la base era `Option` col default `None`, il salvataggio non
la portava. La guardia era **opt-in proprio dove il rilevamento non c'è**, e il
lavoro di qualcun altro spariva senza che nessuno dei due meccanismi potesse
accorgersene.

`crates/fub-kernel/tests/scrittura_guardata.rs` adesso lo mette in scena, e il
banco *è* quel vault: non monta nessun watcher, e il test se lo fa dichiarare da
`IndexQuery::VaultStatus` invece di assumerlo. Poi qualcun altro scrive; il
salvataggio che discende viene rifiutato **e il file resta il suo**; e la
scrittura dettata copre, che è ciò che le si chiede — ma adesso è una frase nel
sorgente di chi la fa.

Accanto c'è la prova più corta e più netta: la stessa scrittura, sullo stesso
documento cambiato sotto, dà **due esiti opposti**, e la differenza è soltanto
quale dei due casi si è nominato. Un `Option` questa proprietà non la può
esprimere, perché il secondo esito è la sua assenza.

---

## Dove sta

- [`crates/fub-abi/src/edit.rs`](../../crates/fub-abi/src/edit.rs) — `WriteBase`,
  accanto a `Revision`, con la ragione dei due casi e di chi sono. `expected()`
  è la sola lettura che serve a chi la guardia la **applica** — un punto solo,
  dentro l'host — e a chi chiama non serve mai.
- [`crates/fub-abi/src/traits.rs`](../../crates/fub-abi/src/traits.rs) — la firma
  del contratto.
- [`crates/fub-abi/wit/fub/abi.wit`](../../crates/fub-abi/wit/fub/abi.wit) e
  [`wit/frozen/0.1.0.wit`](../../crates/fub-abi/wit/frozen/0.1.0.wit) — il
  `variant write-base` e il secondo ritaglio, col suo paragrafo accanto a quello
  della 0089.
- [`docs/architecture/wit-congelato.md`](../architecture/wit-congelato.md) — la
  riga nella tabella dei ritagli.
- [`crates/fub-kernel/src/workspace.rs`](../../crates/fub-kernel/src/workspace.rs) —
  una firma sola, e la guardia che confronta col **disco** e non con l'anagrafe
  (la ragione è della 0089 e non cambia).
- [`crates/fub-abi/tests/wit_additivity.rs`](../../crates/fub-abi/tests/wit_additivity.rs) —
  la ventesima rottura.
- [`crates/fub-kernel/tests/scrittura_guardata.rs`](../../crates/fub-kernel/tests/scrittura_guardata.rs) —
  nove prove: le sette della 0089, riscritte nella lingua nuova, più le due di
  questa decisione.
- [`frontend/src/host/contract.ts`](../../frontend/src/host/contract.ts),
  [`frontend/src/host/ipc.ts`](../../frontend/src/host/ipc.ts) e
  [`frontend/src/panels/document.ts`](../../frontend/src/panels/document.ts) — il
  tipo rispecchiato, la porta senza default, e il buffer che non confonde più
  «non lo so» con «ho scelto».

---

## Cosa resta

Niente di questa voce: le quattro caselle sono chiuse.

Della seduta 23 restano **due P0 di firma** prima del freeze di M4 — la
[§23.4](../roadmap/23-cosa-costano-le-decisioni-chiuse.md) (`Selection` ne porta
una sola) e la §23.12 (`random-bytes` tronca in silenzio) — e il criterio con cui
questa decisione è stata scelta fra le tre vale ancora per loro: P0 qui non vuol
dire «importante», vuol dire **scade col freeze**.
