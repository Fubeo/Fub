# Compiti

Questa pagina risponde a una domanda: quali compiti aperti ci sono nel vault,
quando scadono e come si spuntano. I compiti sono le righe di Markdown che
iniziano con `- [ ]`, scritte come le scrive il plugin Tasks di Obsidian, e
restano nella nota dove stanno.

## Dove si vedono

La vista **Compiti** sta nell'ispettore, la colonna a destra. È una scheda
come le altre: si apre quando la si chiede, e non si apre da sola. Mostra i
compiti aperti di **tutte** le note del vault, non solo di quella aperta.

## Come sono raggruppati

Ogni compito cade in uno di quattro gruppi, nell'ordine in cui compaiono:

- **Scaduti**: la scadenza è prima del giorno corrente.
- **Questa settimana**: la scadenza va dal giorno corrente all'ultimo giorno
  della settimana.
- **Più avanti**: la scadenza è dopo la fine di questa settimana.
- **Senza data**: il compito non ha una scadenza, oppure la data non si legge.

Il giorno corrente e la settimana sono quelli di chi guarda: seguono il fuso
orario e il primo giorno della settimana della macchina. A mezzanotte del
proprio fuso il giorno cambia: al disegno successivo il compito del giorno
prima è in «Scaduti», anche se nessun file è cambiato.

La scadenza è la data scritta dopo l'ultimo `📅` del testo del compito, nel
formato `AAAA-MM-GG`. Il testo del compito è il primo paragrafo della sua voce,
righe che lo continuano comprese, senza la sintassi: conta ciò che si legge. Il
testo dentro un codice o un evidenziato, l'etichetta di un link e un wikilink
con ciò che mostra (`[[Mario]]` è «Mario», un alias conta per l'alias) contano;
l'indirizzo di un link, un'immagine, un embed, una formula, le sottovoci e i
blocchi sotto il primo paragrafo no. Così `📅 [[2026-10-19]]`, la data collegata
alla nota del giorno, è una scadenza. Una data che non esiste,
come `2026-02-30`, non sparisce: il compito va in «Senza data» con l'etichetta
«Data non leggibile». La regola è una sola, in `fub_abi::rules::tasks`, con la
gemella TypeScript `taskDue` in `apps/client/src/rules/mirrored.ts` legata alla
stessa fixture: la usano la ricerca (`due:`), la vista, il recinto e la
pastiglia nel testo. Il corpus del formato Markdown tiene d'accordo le tre
letture del testo (il modello, la Live e la Lettura) sugli stessi casi.

Nella vista il testo del compito si legge senza la data, che sta sotto in una
pastiglia accanto al nome della nota: **rossa** quando la scadenza è passata,
**arancione** quando è vicina, con la stessa regola della pastiglia nel testo
(vedi sotto).

Un compito annidato in un'altra lista, o dentro una citazione, conta come
qualunque altro. Un compito già fatto (`- [x]`) non compare.

Un compito ricorrente (`🔁 every week`, e le altre forme del plugin Tasks)
mostra la sua scadenza, come è scritta nella nota. Quando lo si spunta, la riga fatta resta nella
nota e la successiva nasce sopra di lei, come fa il plugin Tasks.

## Come si spunta

Il riquadro accanto al testo spunta il compito. La spunta usa lo stesso comando
di sempre, `note.task.toggle`: cambia il carattere fra le parentesi e nient'altro
del compito. La vista passa al comando la revisione della nota che ha letto
(l'argomento `revision`): se la nota non è più quella, il comando risponde con
un conflitto e non scrive, e la scrittura stessa porta quella revisione, quindi
una modifica fatta nel frattempo non viene sovrascritta.

Due casi non scrivono niente e lo dicono nella vista:

- **La nota è cambiata sotto la vista.** Se in quella posizione non c'è più lo
  stesso compito, con lo stesso simbolo e lo stesso testo, o se la nota è
  cambiata anche altrove dopo che la vista l'ha letta, la vista si ridisegna e
  chiede di ricontrollare.
- **La nota è in sola lettura.** Il compito resta com'è.

Il nome della nota d'origine, accanto al compito, apre la nota.

## Limiti

- La vista tiene al più **10.000** compiti aperti e ne disegna al più **300**.
  Il taglio viene dopo l'ordine dei gruppi: fra i compiti delle note lette
  tiene i primi, non quelli delle prime note lette. Quando taglia lo scrive
  sotto la lista. Per restringere si usa la ricerca.
- A ogni ridisegno la vista legge al più **2.000** note con compiti aperti,
  nell'ordine dell'indice: oltre, le conta e scrive in cima che i compiti delle
  altre non ci sono. Su un vault di prova di 5.000 note e 15.000 compiti un
  ridisegno costa così circa 70 ms invece di 180.
- La vista legge le note con compiti aperti dall'indice di ricerca. Se il vault
  non ha un indice attivo, la vista lo dice invece di mostrare un elenco vuoto.
- I promemoria non ci sono ancora.

## La scadenza nel testo

Nella nota, in Live e in Lettura, il `📅` con la sua data diventa una
pastiglia: grigia di solito; col compito aperto, **rossa** quando la scadenza
è passata e **arancione** quando è vicina, cioè del giorno corrente o dei sei
seguenti (la regola `due_urgency`, con la gemella `dueUrgency`: la stessa della
pastiglia nella vista e nel recinto). Il contratto delle viste non ha un
intento «avviso»: la vista dice la scaduta `danger` e la vicina `primary`, e la
shell veste `primary` d'arancio nelle viste dei compiti. La
pastiglia mostra la data com'è scritta: il file non cambia. Un compito fatto
resta grigio. Una data che non si legge (`2026-02-30`, `📅 domani`) ha la
pastiglia tratteggiata in rosso, e passandoci sopra dice come si scrive. In Live
la pastiglia resta anche sulla riga del cursore: la data si scrive dentro. Una
pastiglia non si spezza mai: se la data sta a metà di un codice, di un link o di
un evidenziato, la pastiglia prende l'elemento intero.

## Il recinto ```` ```tasks ````

Un recinto di codice con la parola `tasks` mostra, dentro la nota, i compiti
che rispondono alle sue righe, come il plugin Tasks di Obsidian. Si vede in Live
(fuori dal cursore) e in Lettura; il testo del recinto resta nel file com'è.

```tasks
not done
due before tomorrow
path includes Progetti
tag includes #lavoro
sort by due
```

Ogni riga restringe la lista (valgono tutte insieme). Le righe capite:

| Riga | Cosa fa |
| --- | --- |
| `not done` | tiene i compiti aperti |
| `done` | tiene i compiti fatti |
| `due before <data>`, `due after <data>`, `due on <data>`, `due <data>` | tiene i compiti, aperti o fatti, con la scadenza prima, dopo o in quel giorno |
| `path includes <testo>` | tiene i compiti delle note il cui percorso contiene il testo, letterale e senza badare alle maiuscole |
| `tag includes <tag>` | tiene i compiti con quel tag, o con un suo figlio (`#lavoro/fub`) |
| `sort by due`, `sort by path`, con `reverse` in fondo | mette in ordine per scadenza (i compiti senza data in fondo) o per nota |
| `limit <n>`, `limit to <n> tasks` | tiene i primi `n`, dopo l'ordine |

La data è `AAAA-MM-GG`, oppure `today`, `tomorrow`, `yesterday`. Le righe
vuote e quelle che iniziano con `#` non contano. Senza una riga sullo stato il
recinto mostra aperti e fatti, come il plugin. Una riga che Fub non capisce
(`group by`, `hide`…) non ferma il recinto: è saltata, e il recinto scrive quale
sopra la lista. Un recinto senza righe che scelgono dei compiti non mostra tutto
il vault: dice cosa scriverci. Senza un ordine la lista va per scadenza.

Il recinto lo dichiara e lo disegna il componente «Compiti»: una regola di
sintassi riconosce il recinto (così la resa lo tratta come un blocco e non come
codice), e la vista `tasks_query` del componente, con le righe del recinto come
parametro, lo disegna con gli stessi nodi della vista dell'ispettore. Le righe
diventano una ricerca nell'indice (stato, tag e scadenza), e il componente
controlla ogni compito trovato contro tutte le righe, percorso compreso. Il
riquadro accanto a un compito lo spunta come nella vista, con la revisione letta;
il nome della nota apre la nota. Il recinto si ridisegna quando l'indice cambia,
come la vista dell'ispettore: una spunta, o un'altra nota che cambia, si vede da
sola.

Un `path includes` si guarda prima di leggere la nota: una nota fuori dal
percorso non si legge. Per i compiti fatti l'indice non tiene la scadenza (il
predicato `task_due` della ricerca vale per le task aperte, e resta così): una
riga `due` su un recinto che mostra anche i fatti la controlla il componente
sulle note lette, e a restringere quelle note sono le righe `tag` e `path`.

Il recinto tiene al più **10.000** compiti e ne disegna al più **100**; il
taglio, come il `limit`, viene dopo l'ordine. Quando il vault ne ha di più lo
scrive. La vista e il recinto leggono al più **2.000** note per ridisegno, il
recinto contando solo quelle dentro il suo `path includes`: le altre si
contano, e la vista lo scrive. Se il componente «Compiti» è spento il recinto non è dichiarato e resta
un blocco di codice; spegnendolo con la nota aperta, il recinto torna codice, e
riaccendendolo torna la vista.

La lettura delle righe è in `crates/fub-features/src/tasks/query.rs`, il
disegno in `crates/fub-features/src/tasks.rs`. Nella shell il recinto riceve il
posto in `apps/client/src/editors/text/profiles/markdown/query-block.ts`, che
monta la vista attraverso `apps/client/src/ui/embedded-views.ts`; la pastiglia è
in `task-due.ts` (con `query-block.ts` per la Lettura e `livepreview.ts` per la
Live).

## Il componente

«Compiti» è un componente di Fub, con la sua riga nella pagina **Componenti**
delle impostazioni, dove si spegne. Nel codice è la cargo feature `tasks` di
`fub-features`, che accende la ricerca: la vista e il recinto sono in
`crates/fub-features/src/tasks.rs`, e la loro prova end-to-end è
`crates/fub-features/tests/tasks_e2e.rs`.
