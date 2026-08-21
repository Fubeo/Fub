# 0101 — Un'operazione a metà lo dice, e una voce di undo non è un passo

|  |  |
|---|---|
| **Decisa** | 2026-08-05 |
| **Origine** | `todo.md` §23.14 ([seduta 23](../roadmap/23-cosa-costano-le-decisioni-chiuse.md)) — **chiude la voce** |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) ·
[la seduta](../roadmap/23-cosa-costano-le-decisioni-chiuse.md) ·
[il lotto, 0011](0011-il-lotto.md) ·
[l'undo ha due pile, 0045](0045-l-undo-ha-due-pile.md) ·
[ciò che va storto è un evento, 0052](0052-cio-che-va-storto-e-un-evento.md) ·
[un tetto che si fa sentire, 0094](0094-un-tetto-che-si-fa-sentire.md)

---

Tre verbali dichiaravano lo stesso buco su tre superfici senza che nessuno dei
tre lo nominasse come lo stesso buco: la [0011](0011-il-lotto.md) (*«se una
delle N scritture fallisce le altre restano fatte»*), la
[0041](0041-un-errore-e-testo-che-qualcuno-legge.md) (*«il successo parziale non
è esprimibile»*) e la [0045](0045-l-undo-ha-due-pile.md), che è il caso peggiore
perché il danno arriva dopo — *«la voce risultante non dice che è parziale, e
chi la annulla non sa che stava disfacendo undici note su dodici»*.

La decisione in una riga:

> **Un'operazione a metà è riuscita, non fallita, e lo dice con un conto invece
> che con una frase. Una voce di undo non è un passo ma una lista, quindi ha due
> conti e non uno: com'era andata l'operazione, e com'è andato l'annullamento.**

## Cosa la rilettura ha cambiato, prima che si progettasse qualcosa

La voce dichiarava cinque cose. **Tre erano false**, e due di esse avrebbero
portato a costruire la cosa sbagliata.

### «L'esito parziale manca a tre posti diversi» — sono due

La voce elencava l'esito di un lotto, l'esito di un comando e la voce di undo.
Il primo non esiste: `Workspace::batch` non ha un tipo di esito, restituisce
intatto il valore della chiusura e **documenta di non essere una transazione**.
Non è una dimenticanza — è la 0011 stessa che l'ha deciso, e nella stessa pagina
in cui ha scritto che *«il lotto di un plugin è la sua invocazione di comando,
che l'host apre e chiude per lui»*. Cioè: **il primo posto era già collassato
nel secondo dal verbale che l'aveva aperto**, e la voce non se n'era accorta
perché leggeva tre verbali invece del codice.

### «Oggi ha solo due parole, riuscito e fallito» — ne aveva già tre, dette male

Il parziale il vault lo diceva già, in tre comandi: `done.replace_partial`,
`done.archive_partial`, `done.settings_import_partial`. Il buco non era che non
si potesse dire: era **dove** lo si diceva.

| dove | come |
|---|---|
| `vault.replace` | `{occurrences}`, `{notes}`, `{failed}` |
| `vault.archive` | `{count}`, `{folder}`, `{failed}` |
| `settings.import` | `{count}`, `{skipped}`, `{reasons}` |

Tre elenchi di argomenti diversi per la stessa notizia, tutti e tre **solo
dentro la notifica**, e i guasti appiattiti a mano in una `String` con un
`format!("{doc} ({e})")`. Un'automazione che invoca `vault.replace` non aveva
modo di sapere che undici note su dodici erano cambiate se non leggendo una
frase italiana e cercandoci dentro una parola; e chi disegna non aveva un
`DocId` a cui attaccare un link, perché il nome della nota era già dentro la
prosa.

È il criterio *«quante volte è scritto»* applicato a una cosa che non sembrava
scritta affatto. E cambia il progetto: non serviva **inventare** un modo di dire
«a metà», serviva **dare un nome** a ciò che veniva già detto tre volte, e farlo
leggere dai tre posti che lo dicevano.

### «La strada del `Trouble` costa meno» — non risolve il caso che la voce chiama decisivo

La voce proponeva tre strade e ne indicava una come la più economica: un
[`Event::Trouble`](0052-cio-che-va-storto-e-un-evento.md) accanto all'esito
riuscito. Misurata, quella strada **non può** chiudere l'undo, e non per una
questione di prezzo: un evento si emette *adesso*, e la voce di undo si legge
mesi dopo da una pila che il kernel tiene in memoria. Non c'è modo di far
arrivare un evento del 3 agosto all'etichetta che qualcuno leggerà in un menu il
14 settembre.

Cioè: la strada dichiarata più economica era l'unica strutturalmente incapace di
chiudere la metà che la voce stessa dichiarava *«il caso che decide»*, e *«la
cosa da fare per prima»*. Sceglierla avrebbe prodotto un giro che si dichiarava
chiuso avendo fatto l'altra metà.

### «Un campo in più è la migrazione della 0007» — qui non costa niente, e si misura

La voce temeva il prezzo di un campo su `CommandOutcome`. Nel
`wit/frozen/0.1.0.wit` — la linea di base, cioè *ciò che è stato pubblicato* —
`command-outcome` ha **due campi**, `notify` ed `effect`: `undo` è già stato
aggiunto in coda dopo il taglio, e `undo-last` **non c'è affatto**. Quindi:

- `partial` in coda a `command-outcome` è additivo per la regola scritta in
  [wit-congelato.md](../architecture/wit-congelato.md), e `wit_additivity` è
  verde perché lo è;
- ritipare `undo-last` è un ritaglio reale per chi compila contro l'`abi.wit` di
  oggi, ma **non tocca la linea di base**: è il caso della
  [0049](0049-una-posizione-dentro-un-documento.md), verde *con ragione*, ed è
  in tabella lì.

E il prezzo che la 0007 descrive è di **chi riceve** un record, non di chi lo
produce: `CommandOutcome` lo costruiscono i comandi, e con `#[serde(default)]`
un comando che non lo nomina compila e serializza come prima.

### E il quinto: il difetto più grave stava fuori dalla voce

È la seconda volta di fila dopo la
[0099](0099-una-rinomina-che-non-ha-visto-nessuno.md), e qui il difetto era
**nel codice che la voce descriveva**, un livello sotto dove guardava.

`Workspace::undo_last` eseguiva i passi con un `?` dentro la chiusura del lotto:

```rust
for step in &undo.steps {
    match step {
        UndoStep::Edit(planned) => { ws.apply_edit(&planned.doc, planned.edit.clone())?; }
        UndoStep::Command { command, args } => { ws.invoke_command_here(…)?; }
    }
}
```

Una voce di undo **non è un passo**: è una lista, e il passo che fallisce sta in
mezzo agli altri. Con quel `?`, annullare un'archiviazione di dodici note e
inciampare alla quinta faceva tre cose insieme, tutte in silenzio: lasciava
applicati i quattro passi già fatti, **non provava** i sette dopo, e restituiva
un errore nudo — mentre la voce era **già uscita dalla pila**, deliberatamente e
per una buona ragione scritta lì (*«riproporla vorrebbe dire riprovare a fare il
pezzo che era già riuscito»*).

Il risultato per chi usa l'app: preme «Annulla», vede la parola *fallito*, e il
vault è in uno stato che nessuna delle due parole descrive — e non c'è più modo
di finire il lavoro, perché la voce non c'è più.

È **peggio** del danno che la voce descriveva. Quello era: *«ne rimette undici
su dodici credendo dodici»*. Questo è: *«ne ha rimesse quattro su dodici, non te
l'ha detto, e ha buttato via il modo di riprovare»*. La voce aveva trovato il
secondo danno dal lato giusto — l'undo — e dal verso sbagliato.

E il contratto lo diceva male per iscritto: *«un annullamento può fallire come
qualunque scrittura»*. **Come una**, quando sono N.

## La decisione

### `Partial`: di N cose, quante e quali

```rust
pub struct Partial {
    pub attempted: u32,
    pub done: u32,
    pub failures: Vec<Failure>,
}
pub struct Failure {
    pub subject: Option<DocId>,   // NONE quando il soggetto non è un documento
    pub error: PluginError,
}
```

Tre decisioni dentro, e nessuna è estetica.

**I guasti sono uno per uno, non un numero.** «Undici su dodici» non dice
*quale* nota riaprire. È la scelta della
[`IndexLoss`](0051-l-alimentazione-risponde.md), e per la stessa ragione: un
esito che nomina è un esito su cui si può fare qualcosa.

**Il perché è un `PluginError` e non un `Text`.** La specie del guasto è metà
dell'informazione — un `Conflict` si ricalcola, un `PermissionDenied` no — e chi
mostra l'esito deve poterli dire diversamente
([0041](0041-un-errore-e-testo-che-qualcuno-legge.md)). Il
`format!("{doc} ({e})")` di prima buttava via esattamente quella metà. Nel caso
dell'import delle impostazioni il guadagno è visibile: una chiave rifiutata
perché un programma non può scriverla resta un `permission-denied` invece di
diventare una stringa, e chi disegna può dire *«l'ha bloccata chi amministra»*
invece di *«qualcosa è andato storto»*.

**La quarta parte non ha un campo, ed è deliberato.**
`attempted - done - failures.len()` sono le cose su cui non è successo niente e
nessuno ha detto perché. Ci si arriva in **due** modi che un solo nome farebbe
mentire: c'era *niente da fare* (una nota già nella cartella d'archivio) oppure
non sono state *provate* (l'annullamento si è fermato al passo caduto). Dargli
un nome vorrebbe dire sceglierne uno e sbagliare l'altro, quindi il conto resta
un'aritmetica documentata.

### `Partial::of` risponde `None`, e non è una comodità

```rust
pub fn of(attempted: usize, done: usize, failures: Vec<Failure>) -> Option<Partial>
```

Un'operazione con dodici note davanti, undici cambiate e una che non aveva
niente da fare **è riuscita**. Un esito che si dichiarasse a metà lì
insegnerebbe a chi lo legge che gli avvisi di questa app si cliccano via — che è
il modo in cui un avviso smette di valere, ed è la lezione della
[0100](0100-i-tasti-che-arrivano-da-fuori.md), dove il difetto più grave del
giro era un falso positivo e non un falso negativo. La regola sta in **un posto
solo**, la porta di costruzione, così nessuno dei tre comandi può sbagliarla e
il quarto la eredita.

Il presidio è un test che si chiama `nothing_missing_means_no_partial_at_all`, e
resta verde per costruzione: è il controllo negativo, e vale quanto gli altri.

### Il conto lo appaia l'**host**, non chi ha scritto il comando

La metà che la 0045 dichiarava mancante si chiude in una riga di
`invoke_command`:

```rust
if let Some(undo) = outcome.undo.clone() {
    self.undo.push(undo, outcome.partial.clone());
}
```

L'esito e la voce arrivano da lì **insieme** e si separano una riga dopo:
l'esito torna a chi ha invocato, la voce resta in pila. Se non si appaiano
adesso non si appaiano più, e mesi dopo, davanti al menu che disfa, nessuno sa
più che quell'archiviazione era di undici note su dodici.

Che a portarlo sia l'host è la forma della
[0098](0098-un-permesso-si-vede-e-si-nega.md) e della 0100: *una regola che vale
per tutti i chiamanti si scrive nel posto che tutti attraversano*. Un conto da
ricopiare a mano nella `Undo` è un conto che il secondo comando dimentica — e
sarebbe stato scrivibile in due posti, che è la condizione da cui nasce il
disaccordo.

Per la stessa ragione **`Undo` non ha guadagnato un campo**: quel record lo
riempie chi scrive il comando, e il conto non è una cosa che lui dichiara — è
una cosa che l'host ha osservato. La coppia vive nella `Entry` della pila, che è
privata del kernel.

### `undo_last` restituisce `Undone`, con **due** conti

```rust
pub struct Undone {
    pub label: Text,
    pub operation: Option<Partial>,  // l'operazione era GIÀ a metà
    pub replay: Option<Partial>,     // l'annullamento È andato a metà
}
```

Sono due fatti su due momenti diversi, e un campo solo dovrebbe scegliere quale
raccontare. *Un'operazione intera annullata a metà* e *una a metà annullata per
intero* hanno rimediato a cose diverse, e chi legge deve poterle distinguere: la
prima si può ritentare, la seconda no perché non c'è niente da ritentare.

Le risposte diventano **quattro** dove erano due:

| cosa è successo | cosa risponde |
|---|---|
| tutti i passi sono andati | `Ok(Some(Undone { replay: None, … }))` |
| qualcuno sì e qualcuno no | `Ok(Some(Undone { replay: Some(…), … }))` |
| **niente** è cambiato | `Err(…)` — il primo perché |
| non c'era niente da annullare | `Ok(None)` |

**La terza riga è la parte da non perdere.** Se non è cambiato niente resta un
errore, alla lettera della promessa che il contratto faceva già — e chi invocava
`undo_last` aspettandosi un `Err` continua a riceverlo, compreso il presidio del
conflitto che c'era da tre sedute. Smette di essere un errore **soltanto** il
caso in cui una parte del lavoro è stata fatta: buttarla via insieme alla
notizia sarebbe l'unica risposta peggiore del silenzio. È la forma della
[0094](0094-un-tetto-che-si-fa-sentire.md) — *i significati erano tre e non due*
— applicata a un esito invece che a un valore di ritorno.

### Ci si ferma al passo caduto, e **non** si tira dritto

È l'opposto della regola di `vault.replace` (*«si applica tutto, anche se una
nota fallisce»*), e la differenza non è di gusto: là le N note sono
**indipendenti**, qui i passi non lo sono. L'inverso di «crea `A`, poi
rinominala in `B`» è `[rinomina B→A, cestina A]`, e proseguire dopo che la prima
è fallita vorrebbe dire cestinare una nota `A` che non è quella — cioè **fare un
danno per rimediare a un danno**.

Ciò che cambia non è dove ci si ferma: è che adesso il conto esce. Quanti passi
c'erano, quanti sono andati, e il perché di quello che ha fermato il giro; i
restanti stanno nel resto, come *non provati*.

### Un cliente vero, e sta nella shell

`consegna()` nella palette passa il tono a `notify` guardando il campo:

```ts
if (outcome.notify) host.notify(outcome.notify, outcome.partial ? "guasto" : "info");
```

Il `notify` lo diceva già a parole — *«Note archiviate: 11 · Non spostate: …»* —
ma **con lo stesso colore di un successo pieno**, e il colore è la cosa che si
legge per prima: chi scorre via un avviso verde non torna indietro a contare. È
la coppia avviso/stato della
[0080](0080-un-guasto-si-dice-a-chi-sta-lavorando.md) letta da questo lato.

E il tono lo decide il **campo**, non la frase. Prima della §23.14 quella riga
avrebbe dovuto cercare una parola dentro un messaggio già tradotto per sapere
com'era andata — che è la definizione di un dato che non c'è.

## Cosa NON è entrato, e perché

- **Il rollback.** Non è questa voce e la voce lo diceva: da quando c'è il
  journal ([0067](0067-il-registro-di-cio-che-e-successo.md)) una transazione di
  lotto è scrivibile, e [strozzature.md](../roadmap/strozzature.md) la assegna
  già a chi la userà. Questa voce è più stretta e il journal non la risolve:
  *anche un'operazione che nessuno vuole annullare deve poter dire di essere
  riuscita a metà*.
- **Un rimedio dentro `Partial`.** Nessun «riprova quelle che mancano»:
  rimettere in piedi la parte caduta vuol dire rieseguire su un vault che nel
  frattempo è diverso, e il posto dove si decide se si può è il journal. Questo
  tipo dice ciò che è successo, che è la cosa che mancava.
- **`Undone` nel mirror TS.** Non attraversa il confine verso la shell: la shell
  invoca `vault.undo` come qualunque comando e riceve un `CommandOutcome`. È una
  capacità dell'`HostApi`, cioè roba di chi scrive un plugin, e mirrorarla
  avrebbe messo nel contratto della webview un tipo che quella webview non
  riceve mai.
- **Il `Trouble` accanto all'esito.** Vedi sopra: non è una rinuncia per
  economia, è che non arriva dove serve. Resta giusto per ciò che il kernel
  scopre **fuori** da un'invocazione, che è il mestiere per cui la 0052 l'ha
  fatto.

## I presidi, e i tre verificati rossi

Otto in tutto. Tre sono stati fatti fallire togliendo la riga che li riguarda,
perché un presidio che passa a vuoto è la classe di difetto che questo repo ha
già incontrato quattro volte:

| banco | cosa smette di funzionare togliendo | esito |
|---|---|---|
| `an_operation_that_half_succeeded_says_so_as_data` | `.partially(conto)` in `vault_archive` | rosso |
| `undoing_a_half_done_operation_says_it_was_half_done` | `outcome.partial.clone()` nel `push` | rosso |
| `an_undo_that_stops_halfway_says_where_it_stopped` | la guardia `fatti == 0` | rosso |
| `nothing_missing_means_no_partial_at_all` | — | **verde di proposito** |

L'ultimo è il controllo negativo e non deve poter diventare rosso: una nota già
in archivio è *niente da fare*, non un guasto.

Il terzo non usa nessun finto host: archivia due note, lascia che qualcun altro
rimetta un file al posto vecchio della prima, e annulla. I passi girano
dall'ultima rinomina alla prima, quindi la seconda nota torna indietro e la
prima no — che è il caso vero di due applicazioni che guardano lo stesso vault,
cioè [il motivo per cui il contratto ha una base](0008-modifica-chirurgica.md).

Il giro del mirror è passato per intero: la fixture rigenerata ha reso rosso
`mirror.test.ts` finché `contract.ts` non ha guadagnato `Partial` e `Failure`,
che è esattamente ciò per cui quel presidio esiste.

## Cosa resta

Niente di questa voce: le tre caselle si chiudono, e non lascia residui.

Resta invece scritto qui un fatto che vale per chi tocca `Undo::steps`: **i
passi non sono indipendenti**, e il contratto lo dice solo di sbieco
(«nell'ordine in cui vanno eseguiti»). Finché ci si ferma al primo caduto la
cosa è innocua; il giorno in cui qualcuno vorrà tirare dritto — per esempio per
un annullamento di sole modifiche testuali, dove i passi *sono* indipendenti —
la differenza va dichiarata da chi compone l'operazione, non indovinata da chi
la esegue.
