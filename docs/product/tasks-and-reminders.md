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
- Il recinto ```` ```tasks ```` nelle note e i promemoria non ci sono ancora.

## Il componente

«Compiti» è un componente di Fub, con la sua riga nella pagina **Componenti**
delle impostazioni, dove si spegne. Nel codice è la cargo feature `tasks` di
`fub-features`, che accende la ricerca: la vista è in
`crates/fub-features/src/tasks.rs`, e la sua prova end-to-end è
`crates/fub-features/tests/tasks_e2e.rs`.
