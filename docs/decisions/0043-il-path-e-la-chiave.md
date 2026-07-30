# 0043 — Il path è la chiave, e un id stabile è una proprietà

|  |  |
|---|---|
| **Decisa** | 2026-07-28 |
| **Origine** | `todo.md` §13.1 (seduta 13) |
| **Commit** | *(questo commit)* |

Torna all'[indice delle decisioni](README.md) · [todo.md](../todo.md) · [la seduta](../roadmap/13-identita-del-documento.md)

---

Il §13.1 offriva due strade e chiedeva di sceglierne una prima del freeze,
perché **ogni firma del contratto prende `DocId`** e dopo il freeze la seconda
costa una major:

1. il path è **per sempre** la chiave, e i redirect sono una feature sopra;
2. si introduce ora un `DocRef` a due forme — path *oppure* id opaco.

La scelta è la prima. Ma la ragione per cui è la prima non è che la seconda
costi troppo: è che **la seconda non funziona**, o è già esprimibile. Vale la
pena scrivere l'argomento prima dei dettagli, perché è il tipo di cosa che fra
un anno qualcuno riproporrà:

> **Un id stabile o vive dentro il file — e allora è una proprietà — o vive
> fuori, e allora non sopravvive a ciò per cui esiste.**

## La domanda che decide: dove vivrebbe quell'id?

FEATURES lo chiede in tre posti diversi: «UUID opzionale per nota» (2.2),
«Stable note ID» e «Redirect da note rinominate» (7.1), «ID univoco nota» e
l'id Zettelkasten (8.3). Sembrano tre richieste della stessa cosa, e la
differenza fra loro è tutta in *dove* quella cosa starebbe.

**Fuori dal file**, in una tabella `path → id` tenuta dal kernel. È la forma che
sembra più pulita — nessun file dell'utente sporcato — ed è quella che non
regge il caso per cui l'id stabile esiste: **la rinomina fatta mentre Fub è
chiuso**. Il Finder sposta `Nota.md` in `Archivio/Nota.md`, l'app riapre, e la
tabella nomina un path che non c'è più mentre il path nuovo non ha un id. Cioè:
esattamente lo stesso buco del path, con un file in più da tenere in sincronia.
È il path con un costume addosso.

**Dentro il file**, nel frontmatter. Questo sopravvive davvero — perché
sopravvive *il file*, che è la sola cosa che una rinomina non tocca. Ma allora
non è una chiave: **è una proprietà**, e le proprietà il contratto le sa già
dire. `Frontmatter::property`, `QueryPredicate::Property`,
`IndexQuery::PropertyValues`: un UUID per nota e un id Zettelkasten sono
esprimibili **oggi**, senza toccare una firma, da un plugin che li scrive e li
interroga come qualunque altro campo.

Quindi la seconda strada o è già percorribile, o porta dove non voleva andare.
È il caso raro in cui una voce P0 si chiude **senza cambiare la firma che
nominava**, e la ragione non è che si rimanda: è che la firma che serviva
esisteva già ed era un'altra.

## Cosa è entrato lo stesso, e perché era necessario

Deciso che i redirect sono «una feature sopra il kernel», la domanda diventa:
quella feature si può scrivere? Le serve di sentire le rinomine (ce l'ha:
`DocumentRenamed` + `EventHandler`), di persistere (ce l'ha: `data_write`) e di
**essere interpellata** quando un nome non risolve.

L'ultima non c'era. E il modo in cui non c'era è la cosa interessante: la
risoluzione dei wikilink esisteva, funzionava, ed era raggiungibile da **una
sola** superficie — `resolve_link`, un comando IPC scritto apposta per la shell.
Un fatto sul vault che il core conosceva e un plugin no, cioè precisamente
l'asimmetria che il canale dati esiste per non avere
([0019](0019-il-canale-dati.md)).

`IndexQuery::Resolve { target, from }` → `IndexResult::Resolved(Option<DocId>)`.
Il comando bespoke sparisce (§16.6 di un'unità), e la domanda ha una porta sola.

> La risposta è cambiata dopo: dalla
> [0049](0049-una-posizione-dentro-un-documento.md) è
> `Resolved(Option<ResolvedRef>)`, perché mancava metà della risposta —
> `[[Nota#^blocco]]` porta un punto, e qui non c'era dove metterlo.

### Il bersaglio è un `LinkTarget`, e non una stringa

Perché `a/b.md` è due cose: un wikilink per path e un link markdown relativo, e
le due non risolvono allo stesso posto. Una firma che prendesse una stringa
avrebbe dovuto **indovinare** di quale specie fosse — cioè inventare una terza
regola che nessuno dei due lati ha. Riusare il vocabolario del modello significa
che chi chiede dice di che specie è il riferimento **perché lo sa**: è ciò che ha
parsato, o ciò che `LinkTarget::classify` gli ha appena risposto.

Ne segue il dettaglio che sembra un dettaglio e non lo è: `LinkTarget::Url`
risolve a `None` invece di essere un errore. È ciò che permette di passare qui
l'esito di `classify` senza filtrarlo prima — la shell non deve sapere quali
specie «vale la pena» chiedere.

### `from`, e la sola cosa che il presidio guarda due volte

`from` è il documento *dentro cui* il riferimento è scritto: serve ai `Path`, che
sono relativi alla cartella di chi li ospita. La stessa stringa, `Cucina.md`, con
`from: Progetti/Ferrite.md` risolve a `Progetti/Cucina.md` e senza `from` non
risolve affatto. Sono due risposte diverse per lo stesso testo, ed è la ragione
per cui `from` sta nella domanda invece di essere dedotto.

### Il proprietario è il kernel, e non si scavalca

`QueryKind::Resolve` è una **famiglia**, quindi ha un padrone solo
([0019](0019-il-canale-dati.md)), e il padrone è il kernel. Un plugin di redirect
non può prenderne il posto, e non è una svista: chi risolve al posto del kernel
decide anche dove puntano i link **nel grafo**, cioè riscrive l'anagrafe del
vault dal di fuori. Un redirect è ciò che si dice quando la risposta è `None`, e
vive **accanto** a questa domanda, non al suo posto.

## Cosa questa scelta lascia a carico, e a chi

Se il path è la chiave per sempre, allora la **migrazione della chiave a ogni
rinomina è per sempre un problema del kernel** — mentre con un id stabile
sarebbe stata un non-problema. Il §13.2 lo diceva già come ipotesi condizionale;
adesso la condizione è vera, e quella voce smette di essere una
generalizzazione facoltativa. È la [0044](0044-lo-stato-per-documento.md), e
questa decisione è la ragione per cui esiste.

## Cosa si è scartato, e perché

- **Un `DocRef` a due forme.** Vedi sopra: la forma che sopravvive è una
  proprietà, quella che non lo è non sopravvive. In più avrebbe costretto ogni
  firma del contratto a dichiarare *quale delle due* accetta, che è un secondo
  vocabolario dentro il primo.
- **Un `resolve` fra le capacità dell'`HostApi`.** Sarebbe stata una capacità
  nuova, e la [0013](0013-elenco-delle-capacita.md) ha chiuso quell'elenco con un
  criterio: ciò che è **una risposta con dei dati** passa dal canale dati. «Che
  documento è questo nome» è una risposta con un dato.
- **Lasciare `resolve_link` dov'era e aggiungere la variante accanto.** Due
  strade per la stessa risposta divergono, e diverge quella meno guardata —
  la regola della [0042](0042-il-catalogo-della-shell.md), applicata a una
  risposta invece che a un valore.
- **Una risposta paginata.** Risolvere non è cercare: la risposta è una o
  nessuna. Chi vuole i candidati di una ricerca per nome chiede `Documents` con
  `TextField::Name`, che è un'altra domanda e ha un'altra risposta — ed è la
  §21.5 (il quick switcher).
- **Distinguere nella risposta i tre modi di non esserci** (link rotto, URL
  esterno, nota rinominata via da sotto). Sono le ragioni di chi non c'è, e
  appartengono a chi chiede: la shell che ha appena chiesto un wikilink sa che un
  `None` vuol dire «proponi di crearla», e chi ha chiesto un URL sa che vuol dire
  «apri il browser».

## Cosa resta scoperto (e dove è scritto)

- **Il redirect non esiste ancora.** Questa decisione lo rende *scrivibile* —
  la domanda c'è, l'evento c'è, lo spazio dati c'è — e non lo scrive. Quando
  arriverà sarà una feature con un catalogo e un `EventHandler`, e il punto in
  cui si innesta è il `None` di `Resolve`, non la sua sostituzione.
- **`Resolve` non è ancora un cliente del quick switcher** (§21.5), che non
  esiste. Quando esisterà, la riga da non violare è quella scritta lì: tutto ciò
  che nella shell accetta del testo e propone delle note passa da
  `IndexQuery::Documents`. Risolvere e cercare restano due domande.
- **Un `DocId` si può ancora costruire dal nulla** (`DocId::new` è pubblica e
  prende qualunque stringa). Chi lo fa se lo vede rifiutare dal kernel
  (`valid_doc_id`, `fenced_doc_id`), ma *cosa è un path legale* resta una regola
  del kernel e non del contratto: è la §15.5, e questa decisione non la tocca.
- **Il limite del path lungo** non è di questa voce ma la sfiora: un `DocId` è
  un path, e i path hanno un tetto che il filesystem impone. Dove il tetto si
  vede — nello spazio dati per-documento — è dichiarato nella
  [0044](0044-lo-stato-per-documento.md).
