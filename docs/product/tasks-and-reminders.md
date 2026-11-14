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

La scadenza è la data scritta dopo l'ultimo `📅`, nel formato `AAAA-MM-GG`. Una
data che non esiste, come `2026-02-30`, non sparisce: il compito va in «Senza
data» con l'etichetta «Data non leggibile».

Un compito annidato in un'altra lista, o dentro una citazione, conta come
qualunque altro. Un compito già fatto (`- [x]`) non compare.

Un compito ricorrente (`🔁 every week`, e le altre forme del plugin Tasks)
mostra la sua scadenza, come è scritta nella nota. Quando lo si spunta, la riga fatta resta nella
nota e la successiva nasce sopra di lei, come fa il plugin Tasks.

## Come si spunta

Il riquadro accanto al testo spunta il compito. La spunta usa lo stesso comando
di sempre, `note.task.toggle`: cambia il carattere fra le parentesi e nient'altro
del compito. La nota d'origine si scrive con la sua revisione, quindi una
modifica fatta nel frattempo non viene sovrascritta.

Due casi non scrivono niente e lo dicono nella vista:

- **La nota è cambiata sotto la vista.** Se in quella posizione non c'è più lo
  stesso compito, con lo stesso simbolo e lo stesso testo, la vista si
  ridisegna e chiede di ricontrollare.
- **La nota è in sola lettura.** Il compito resta com'è.

Il nome della nota d'origine, accanto al compito, apre la nota.

## Limiti

- La vista legge al più **10.000** compiti aperti e ne disegna al più **300**,
  nell'ordine dei gruppi. Quando taglia lo scrive sotto la lista. Per restringere
  si usa la ricerca.
- La vista legge le note con compiti aperti dall'indice di ricerca. Se il vault
  non ha un indice attivo, la vista lo dice invece di mostrare un elenco vuoto.
- I promemoria non ci sono ancora.

## La scadenza nel testo

Nella nota, in Live e in Lettura, il `📅` con la sua data diventa una
pastiglia: grigia di solito, **arancione** quando il compito è aperto e la
scadenza cade prima di sette giorni dal giorno corrente (scaduti compresi). La pastiglia
mostra la data com'è scritta: il file non cambia. Un compito fatto resta
grigio; una data che non esiste (`2026-02-30`) resta testo semplice. In Live,
dove sta il cursore, torna il testo semplice.

## Il recinto ```` ```tasks ````

Un recinto di codice con la parola `tasks` mostra, dentro la nota, i compiti
che rispondono alle sue righe, come il plugin Tasks di Obsidian. Si vede in Live
(fuori dal cursore) e in Lettura; il testo del recinto resta nel file com'è.

```tasks
not done
due before tomorrow
path includes Progetti
tag includes #lavoro
```

Ogni riga restringe la lista (valgono tutte insieme). Le righe capite:

| Riga | Cosa tiene |
| --- | --- |
| `not done` | i compiti aperti |
| `done` | i compiti fatti |
| `due before <data>`, `due after <data>`, `due on <data>`, `due <data>` | i compiti aperti con la scadenza prima, dopo o in quel giorno |
| `path includes <testo>` | i compiti delle note il cui percorso contiene il testo |
| `tag includes <tag>` | i compiti con quel tag, o con un suo figlio (`#lavoro/fub`) |

La data è `AAAA-MM-GG`, oppure `today`, `tomorrow`, `yesterday`. Le righe
vuote e quelle che iniziano con `#` non contano. Senza una riga sullo stato il
recinto mostra aperti e fatti, come il plugin. Una riga che Fub non capisce
(`sort by`, `group by`, `hide`…) non ferma il recinto: è saltata e il recinto
lo scrive sopra la lista. Un recinto vuoto non mostra tutto il vault: dice come
si scrive.

Le righe diventano una ricerca di Fub (`task:todo`, `due:<`, `path:`, `tag:`):
la ricerca trova le note, e il recinto legge i compiti di ognuna. La lista è
ordinata per scadenza, poi per nota e posizione. Il riquadro accanto a un
compito lo spunta con `note.task.toggle`, come nella vista: se la nota nel
frattempo è cambiata in quel punto non scrive e lo dice; dopo la spunta il
recinto si ridisegna. Il nome della nota apre la nota.

Il recinto legge al più **50** note e disegna al più **100** compiti: quando
taglia lo scrive. Se il componente «Compiti» è spento il recinto lo dice invece
di cercare. Il recinto non si aggiorna da solo quando cambia un'altra nota: si
aggiorna quando la nota che lo contiene si ridisegna.

La traduzione delle righe e la lettura dei compiti di una nota sono in
`apps/client/src/editors/text/profiles/markdown/tasks-query.ts`; il disegno del
recinto e la pastiglia in Lettura in `query-block.ts`, la pastiglia in Live in
`livepreview.ts`.

## Il componente

«Compiti» è un componente di Fub, con la sua riga nella pagina **Componenti**
delle impostazioni, dove si spegne. Nel codice è la cargo feature `tasks` di
`fub-features`, che accende la ricerca: la vista è in
`crates/fub-features/src/tasks.rs`, e la sua prova end-to-end è
`crates/fub-features/tests/tasks_e2e.rs`.
