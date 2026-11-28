# I gesti dell'editor: testata, proprietà, commenti, sbirciata e ispettore

Inventario dei gesti del prototipo dell'editor per la testata, le proprietà,
i commenti, la sbirciata dei link e l'ispettore, con la prova di ogni gesto
nell'app sul banco. È una misura: le differenze si correggono in task separati.

> **Risultato:** al ripasso del 2026-11-28, su 122 gesti 36 sono uguali, 49 diversi, 12 mancano nell'app, 4 non si possono provare sul banco e 21 sono fuori dal lavoro.

- Data della misura: 2026-11-21.
- Prototipo: `PLAN-ui/editor.html` sul ramo `piano/editor-completo`. Il file
  è cambiato l'ultima volta al commit `fe8548e36` (2026-11-17); la testa del
  ramo è `c8b643653`.
- App: ramo `misure/gesti-3`, a partire da `80e7c92eb` (`integra/editor-3`).
  Il banco gira sulla porta 1692.

## Ripasso del 2026-11-28

- **App:** ramo `misure/gesti-ripasso`, che parte da `ebd0e4be2` (`integra/editor-cornice-1`). Il ripasso non cambia il codice dell'app.
- **Prototipo:** `PLAN-ui/editor.html` al commit `9a4cf1e94`. Lo script è lo stesso del 21/11 con una riga in più prima: i numeri delle righe da 1849 in su crescono di uno.
- **Prova:** le righe sono rifatte con le sonde dei gesti (`apps/client/bench/gesti/`, voci in `voci-testata-commenti-ispettore.mjs`), sulle note della Live che le scene già usano (`live=testata`, `proprieta`, `opzioni`, `relazioni`, `commenti`). Il comando è `node bench/gesti/sonda.mjs --pagina=testata-commenti-ispettore` dalla cartella `apps/client`. Le righe uguali che la sonda non ha raggiunto restano uguali «dal codice», e lo dicono nelle note.
- **Conti:** 36 uguali, 49 diversi, 12 mancano nell'app, 4 non provabili sul banco, 21 fuori dal lavoro. Il 21/11 erano 43, 51, 19 e 9.
- **Cambiati dal 21/11:** 28 esiti.
  - Ora fuori dal lavoro: l'ispettore e la barra del titolo (88, 89, 91, 92, 106-122), fuori dal foglio della cornice.
  - Ora provati: il campo del primo commento, dopo il nome (74 e 76 diversi, senza avviso; 75 uguale), e i pulsanti della sbirciata su una nota che c'è (96, 97 diversi: aprono davvero, il prototipo mostra solo l'avviso).
  - Ora diversi: il clic e Invio su un'etichetta della riga dei dati (69, 71), che aprono la ricerca.
- **Cambiati nei dettagli, con lo stesso esito:** «Aggiungi una proprietà» non apre ancora il menu, ma ora porta il cursore nel frontmatter, e ciò che si scrive ci finisce (27-32); la casella mostra il valore nuovo (61); il segno del commento si vede nel testo, ma il clic non apre la discussione (80); la ricerca dell'icona filtra anche le figure (9).

## Come si legge

- La colonna del prototipo dà la riga dello script di `PLAN-ui/editor.html`
  dove sta il gesto. Ogni gesto è stato letto nel codice e poi fatto nel
  prototipo.
- La colonna dell'app dice che cosa succede nel banco, sullo stesso elemento.
  Le scene sono quelle di `bench/scene.mjs` (testata, proprietà, opzioni,
  commenti, ispettore).
- Esiti: **uguale** (stesso effetto: valore, fuoco, elemento, avviso);
  **diverso** (con la differenza scritta); **manca nell'app** (il gesto non
  fa niente o l'elemento non c'è); **non provabile sul banco** (con il motivo);
  **fuori dal lavoro** (fuori dal foglio della cornice: ispettore, barra del
  titolo, banda, binario, linguette). Le righe del prototipo sono quelle del
  commit `9a4cf1e94`.
- Le parole diverse non cambiano l'esito: si annotano nelle note.
- Il banco usa un finto host. Dove il comando non c'è, l'app mostra il suo
  errore e il gesto non si può provare (righe 19, 38, 63).

## La tabella

| n | gesto | elemento (prototipo → app) | prototipo (riga dello script) | app | esito | note |
|---|---|---|---|---|---|---|
| 1 | Clic sul titolo e scrittura | titolo → titolo della pagina | 1577, 2744 | Il clic porta il cursore nel titolo e la scrittura entra dove si è cliccato | uguale | Nel banco il nome in alto non è stato misurato |
| 2 | Invio nel titolo cambiato | titolo → titolo della pagina | 4441 | Il file cambia nome (la scheda diventa «LiveZ»), il cursore va nel testo, nessun avviso | diverso | Il prototipo avvisa «Rinominata in…md»; il banco no |
| 3 | Freccia giù nel titolo | titolo → titolo della pagina | 4441, banda 2529 | Il prototipo porta il cursore nel testo, ma la sua banda dice «alle proprietà». L'app porta alla prima proprietà, e la sua banda dice «scende nel testo» | diverso | Entrambi dicono una cosa e ne fanno un'altra: decide il task che corregge |
| 4 | Titolo svuotato | titolo → titolo della pagina | 292, 4445 | Il prototipo mostra «Senza titolo» grigio, e la briciola dice lo stesso. Il banco mostra il campo vuoto, senza segnaposto | diverso | Nel banco il segnaposto manca |
| 5 | Titolo in Lettura | titolo → titolo della pagina | 2744 | In Lettura il titolo non è un campo: la scrittura non entra | uguale | Nel banco il titolo è un'intestazione. Il 28/11 l'esito è dal codice: la sonda non trova il titolo in Lettura |
| 6 | Clic sull'icona della pagina | icona → icona della pagina | 4354, 2842–2852 | Pannello piccolo sotto l'icona, con tre schede (Figure, Emoji, Togli), ricerca e griglia. Nel banco pannello largo sopra la nota, senza schede | diverso | Figure ed emoji stanno in un'unica lista |
| 7 | Icona: Tab e Invio | icona → icona della pagina | 2842 | Invio apre il pannello; il fuoco va nella ricerca | uguale |  |
| 8 | Scheda Emoji del pannello | schede → nessuna | 2845–2847 | Clic su «Emoji»: compaiono le emoji | manca nell'app | Nel banco non ci sono schede |
| 9 | Scrivere nella ricerca dell'icona | ricerca → campo di ricerca | 2845 | La ricerca filtra figure ed emoji: «casa» lascia una figura e 🏠. Il prototipo non filtra niente | diverso | Nel banco la ricerca filtra solo le emoji: «casa» lascia 🏠 e le figure restano tutte |
| 10 | Clic su una figura | figura → figura | 2848–2849 | L'icona diventa la figura, il pannello si chiude, il fuoco torna sull'icona, avviso «Scritto: icon: fub:cal…» | diverso | Nel banco il fuoco va nel testo e non c'è avviso |
| 11 | Clic su un'emoji | emoji → emoji | 2848 | Come la riga 10, con l'emoji | diverso | Stessa differenza della riga 10 |
| 12 | Togli l'icona | voce Togli → voce Togli l'icona | 2847 | La nota resta senza icona, con l'avviso «Tolta l'icona…» | diverso | Nel banco la nota torna all'icona del suo tipo, senza avviso |
| 13 | Esc chiude il pannello dell'icona | pannello → pannello | 2575, 4391 | Chiude; il fuoco torna sull'icona | uguale |  |
| 14 | Clic fuori dal pannello | pannello → pannello | 4336 | Chiude | uguale | Nel banco il clic porta anche il cursore nel testo |
| 15 | Nota senza icona: «Aggiungi un'icona» | icona → strumento della testata | 1575 | Il prototipo ha sempre l'icona. Il banco mostra lo strumento «Aggiungi un'icona», che apre lo stesso pannello | diverso | Il prototipo non ha lo stato senza icona |
| 16 | Clic sul nome di una proprietà | nome → nome della proprietà | 2774, 4356, 2812–2815 | Menu con l'intestazione (nome · tipo), Rinomina, Tipo, Togli dall'evidenza, Togli dalla nota. Il fuoco va sulla prima voce | uguale | Le intestazioni dipendono dal tipo dei dati di prova |
| 17 | Menu: Rinomina | voce → voce Rinomina | 2814 | Prototipo: solo un avviso («Rinomina la proprietà in ogni nota…»), nessun nome cambia. Banco: apre il campo «Nuovo nome di «stato»» | diverso |  |
| 18 | Menu: Tipo | voce → voce Tipo | 2814 | Prototipo: sottomenu con 10 tipi. Banco: 11 tipi (Testo, Numero, Selezione, Stato, Casella, Data, Data e ora, Elenco, Etichette, Relazione, URL), senza «Persone». Il fuoco esce dal menu | diverso | Nel banco il fuoco si perde |
| 19 | Menu Tipo: scegliere un tipo | voce del sottomenu → voce del sottomenu | 2814 | Prototipo: il tipo cambia per tutto il vault, con avviso. Banco: avviso «Il tipo di «stato» non è cambiato: host fake…» | non provabile sul banco | Il finto host non ha il comando per cambiare il tipo |
| 20 | Menu: Togli dall'evidenza | voce → voce | 2814 | Prototipo: la proprietà passa dalla testata alle «Altre», senza avviso (verificato). Banco: esce dalla testata con l'avviso «…non è più in evidenza nelle note di tipo Progetto» e «Annulla» | diverso | Nel banco si può annullare |
| 21 | Menu: Togli dalla nota, poi Annulla | voce rossa → voce | 2814 | Prototipo: la proprietà esce, con avviso e «Annulla», che la rimette (verificato). Banco: la proprietà esce subito, senza avviso e senza «Annulla» | diverso | Rischio: nel banco un clic toglie la proprietà senza ritorno |
| 22 | Menu: freccia giù e Invio | tastiera → tastiera | 2660 | Prototipo: la freccia va su «Tipo», Invio apre il sottomenu, il fuoco resta sulla voce. Banco: stesso sottomenu, ma il fuoco va al corpo della nota | diverso | Il fuoco si perde |
| 23 | Menu: freccia sinistra | tastiera → tastiera | 2660 | Prototipo: torna al menu principale. Banco: resta nel sottomenu, senza fuoco | diverso | Stessa causa della riga 22 |
| 24 | Menu: Esc | tastiera → tastiera | 2575 | Chiude e riporta il fuoco sul nome della proprietà | uguale |  |
| 25 | Menu: scrivere | tastiera → tastiera | 2587 | Nessuno dei due menu ha ricerca: scrivere non fa niente | uguale |  |
| 26 | Nome della proprietà da tastiera | nome → nome della proprietà | 2774 | Tab porta al valore in entrambi. Invio: nel prototipo non fa niente, nel banco apre il menu | diverso | Nel prototipo la tastiera non apre il menu |
| 27 | Clic su «Aggiungi una proprietà» | pulsante → pulsante | 2777, 2816–2820 | Il clic non apre il menu: il cursore entra nel frontmatter e lascia una riga vuota fra le proprietà. Nella nota senza proprietà il pulsante ora si vede e scrive un frontmatter vuoto («---⏎⏎---») | manca nell'app | Rischio: ciò che si scrive dopo finisce nel frontmatter (riga 29) |
| 28 | «Aggiungi»: Tab e Invio sul pulsante | pulsante → pulsante | 2816 | Invio fa come il clic della riga 27: nessun menu, il cursore entra nel frontmatter | manca nell'app |  |
| 29 | «Aggiungi»: scrivere un nome | campo → campo | 2816–2819 | Nessun campo: il nome battuto («Autore») entra nel frontmatter come riga senza chiave | manca nell'app | Rischio: il frontmatter diventa illeggibile |
| 30 | «Aggiungi»: nome e tipo Testo | voce → voce | 2818–2819 | Prototipo: aggiunge la proprietà e la apre. Banco: nessun menu, quindi nessuna voce | manca nell'app |  |
| 31 | «Aggiungi»: proprietà suggerita (Priorità) | voce → voce | 2818 | Prototipo: aggiunge la proprietà. Banco: nessun menu | manca nell'app |  |
| 32 | «Aggiungi»: Esc | tastiera → tastiera | 2575 | Esc non chiude niente: resta la riga vuota nel frontmatter, col cursore dentro | manca nell'app |  |
| 33 | «Aggiungi»: un tipo Numero apre il campo | voce → voce | 2819 | Prototipo: il campo del numero si apre subito. Banco: nessun menu | manca nell'app |  |
| 34 | «Altre N proprietà»: apre e chiude | pulsante → pulsante | 2775–2776 | Apre e chiude in entrambi. Il prototipo perde il fuoco; il banco lo porta nel testo della nota | diverso |  |
| 35 | Stato: clic sul valore | valore → valore | 2796–2801 | Elenco a gruppi (Da fare, In corso, Fatto) con «Cerca o crea un'opzione…». Banco: stesso elenco, con il segno ✓ sulla scelta attuale | uguale | Le opzioni dipendono dai dati di prova |
| 36 | Stato: scrivere per cercare | campo → campo | 2796 | Filtra e propone «Crea «fa»…» | uguale |  |
| 37 | Stato: scegliere un'opzione | opzione → opzione | 2796–2800 | Prototipo: imposta «Fatto», con avviso «Scritto nel frontmatter: stato: Fatto». Banco: imposta «Arrivata» (nel gruppo Fatto), senza avviso | diverso | Nel banco il gruppo Fatto non ha un'opzione «Fatto» |
| 38 | Stato: «Crea» un'opzione nuova | voce Crea → voce Crea | 2800 | Banco: «L'opzione «Bloccato» non è stata creata: host fake…» | non provabile sul banco | Il finto host non ha il comando per creare opzioni |
| 39 | Data: clic sul valore | valore → valore | 2821–2839 | Calendario con le scelte rapide, il mese, i giorni, «Togli la data» e «Aggiungi l'ora». Il banco ha in più il pulsante «Ora» | diverso |  |
| 40 | Data: scrivere «venerdì» e Invio | campo → campo | 2834–2835 | Imposta la data e chiude. Prototipo: avviso «Scritto: scadenza: …» | diverso | Nel banco nessun avviso |
| 41 | Data: testo non valido | campo → campo | 2834 | Il testo del campo diventa rosso in entrambi (verificato) | uguale |  |
| 42 | Data: scelta rapida del giorno dopo | pulsante → pulsante | 2832 | Imposta e chiude; il prototipo mostra l'avviso | diverso | Nel banco nessun avviso |
| 43 | Data: mese successivo | pulsante → pulsante | 2837 | Cambia mese e il calendario resta aperto, in entrambi (verificato) | uguale |  |
| 44 | Data: clic su un giorno | giorno → giorno | 2837 | Imposta e chiude; il prototipo mostra l'avviso | diverso | Nel banco nessun avviso |
| 45 | Data: «Togli la data» | pulsante → pulsante | 2832 | Vuota la data; il prototipo mostra l'avviso «Tolta la scadenza.» | diverso | Nel banco nessun avviso |
| 46 | Data: «Aggiungi l'ora» | pulsante → pulsante | 2832 | Prototipo: il campo non cambia e un avviso spiega che con l'ora il valore diventa data e ora. Banco: apre il campo dell'ora («Togli l'ora») | diverso |  |
| 47 | Data: Esc | tastiera → tastiera | 2575 | Chiude senza cambiare; il fuoco torna sul valore | uguale |  |
| 48 | Persone: clic sul valore | valore → valore | 2802 | Elenco con le spunte e il campo «Cerca una persona…» | uguale | Il banco ha solo due persone |
| 49 | Persone: clic su una persona | voce → voce | 2802 | Spunta o toglie la persona; l'elenco resta aperto (verificato in entrambi) | uguale |  |
| 50 | Persone: scrivere per cercare | campo → campo | 2802 | Filtra e propone di crearla. Prototipo: «Nuova persona «ma»»; banco: «Aggiungi «ma»» | uguale | Cambia solo l'etichetta |
| 51 | Persone: nome nuovo | voce → voce | 2802 | Prototipo: crea la nota Persone/Chiara Neri.md e avvisa «Creata…». Banco: aggiunge «[[Chiara Neri]]» con la spunta, senza avviso | diverso | Non verificato se il banco crea la nota |
| 52 | Relazione: clic sul valore | valore → valore | 2803 | Prototipo: elenco delle note con le spunte. Banco: il clic al centro del valore apre la nota legata (qui «Il libro perduto», che non c'è: si apre vuota); l'elenco si apre dalla parte destra del valore | diverso |  |
| 53 | Relazione: spuntare una nota | voce → voce | 2803 | Spunta o toglie; l'elenco resta aperto (verificato nel banco) | uguale |  |
| 54 | Relazione: clic sul nome della nota | nome → nome | 2803, 3280 | Prototipo: avviso «Apre «Biblioteca civica» in questo riquadro…», la nota non cambia. Banco: apre la nota «Dune» | diverso |  |
| 55 | Numero: clic sul valore | valore → valore | 2804–2806 | Campo con il numero selezionato | uguale |  |
| 56 | Numero: scrivere e Invio | campo → campo | 2807–2808 | Salva il valore nuovo (5.000 € nel prototipo, 5000 nel banco) | uguale |  |
| 57 | Numero: Esc | campo → campo | 2808 | Annulla e torna il valore di prima | uguale |  |
| 58 | Numero: testo non numerico e Invio | campo → campo | 2807 | Avviso «Non è un numero: il valore resta quello di prima.» | uguale |  |
| 59 | Testo: clic sul valore | valore → valore | 2796 | Prototipo: il clic non fa niente, perché non c'è un editor del testo. Banco: apre il campo di testo | diverso |  |
| 60 | Testo: Tab sul valore e Invio | tastiera → tastiera | 2774 | Prototipo: Invio non fa niente. Banco: apre il campo di testo | diverso |  |
| 61 | Casella: clic sul valore | valore → valore | 2796 | Prototipo: «Sì» o «No» come testo, il clic non fa niente. Banco: la casella passa a «Sì» e il file scrive «true» | diverso | Il 21/11 la casella restava su «No» |
| 62 | Indirizzo (URL): clic sul valore | valore → valore | 2796 | Prototipo: il clic non fa niente. Banco: apre una scheda con l'indirizzo | diverso | Nel banco la scheda è esterna |
| 63 | Etichette: clic sul valore | valore → valore | 2796 | Prototipo: nessun editor per le etichette. Banco: l'etichetta non si può creare, perché «Aggiungi una proprietà» non apre il menu (riga 27) | non provabile sul banco | Vedi riga 27; la sonda del 28/11 non trova la riga «tags» nella testata |
| 64 | Selezione: clic sul valore | valore → valore | 2796 | Prototipo: nessun editor per la selezione, il clic non fa niente. Banco: elenco delle opzioni con il segno ✓ sulla scelta attuale | diverso |  |
| 65 | Selezione: scrivere un'opzione nuova | campo → campo | 2796 | Prototipo: non succede niente. Banco: «Crea «Media» con un colore libero» | diverso |  |
| 66 | «Modificata …» nella riga dei dati | dato → dato | 2793 | Prototipo: apre l'ispettore sulla scheda Cronologia. Banco: è solo testo, non c'è un'azione da cliccare | manca nell'app | Dal codice: «Modificata» è una parte senza azione (`note-facts.ts`) |
| 67 | «N collegamenti» o «in entrata» | dato → dato | 2793 | Apre l'ispettore sulla scheda Collegamenti, in entrambi (verificato) | uguale |  |
| 68 | «N commenti» nella riga dei dati | dato → dato | 2793 | Prototipo: apre la scheda Commenti. Banco: nella riga non c'è il conteggio dei commenti | manca nell'app |  |
| 69 | Clic su un'etichetta | etichetta → etichetta | 2793, 4360 | Prototipo: avviso «Cerca tag:… nel vault…». Banco: apre la ricerca dell'etichetta | diverso | Il 21/11 non succedeva niente. Nel banco le etichette della riga sono quelle del vault di prova (#tema, #banco) |
| 70 | Tab e Invio su «N collegamenti» | tastiera → tastiera | 2793 | Apre la scheda Collegamenti, in entrambi (verificato) | uguale |  |
| 71 | Tab e Invio su un'etichetta | tastiera → tastiera | 2793 | Prototipo: avviso. Banco: apre la ricerca dell'etichetta, come la riga 69 | diverso | Il 21/11 non succedeva niente |
| 72 | Selezione di testo e Ctrl Alt M | scorciatoia → scorciatoia | 3226–3232, 4403 | Prototipo: il testo selezionato si segna e si apre il campo del commento. Banco: il primo commento chiede prima il nome («Il tuo nome»), che finisce nel file della nota | diverso |  |
| 73 | Ctrl Alt M con il cursore in un blocco | scorciatoia → scorciatoia | 3233, 4403 | Prototipo: commenta l'intero blocco. Banco: stessa richiesta del nome, poi il campo del blocco | diverso |  |
| 74 | Campo del commento: Ctrl Invio | campo → campo | 3239 | Prototipo: il commento entra nel testo, con l'avviso «Commento scritto nel testo…». Banco: dopo il nome, il commento entra nel testo col nome («@Prova …»), senza avviso | diverso | Il 21/11 non provabile; il 28/11 la sonda scrive prima il nome |
| 75 | Campo del commento: Invio | campo → campo | 3239 | Va a capo nel campo, non invia, in entrambi | uguale | Il 21/11 non provabile |
| 76 | Campo del commento: «Commenta» | pulsante → pulsante | 3238 | Prototipo: invia e avvisa. Banco: invia, senza avviso | diverso | Il 21/11 non provabile |
| 77 | Campo del commento vuoto: «Commenta» | pulsante → pulsante | 3238 | Prototipo: non fa niente. Banco: il pulsante è disattivato, quindi non si clicca | uguale |  |
| 78 | Campo del commento: Esc | tastiera → tastiera | 2575, 3236 | Chiude il campo e riporta il fuoco nel testo. Il prototipo toglie anche il segno; nel banco non è stato controllato | uguale | Il 28/11: il campo si chiude, il fuoco torna nel testo e il testo scelto resta senza segno |
| 79 | Campo del commento: clic fuori | pannello → pannello | 4336, 3236 | Prototipo: chiude e toglie il segno. Banco: il campo resta aperto | diverso |  |
| 80 | Clic sul segno nel testo | segno → segno | 3245, 4361 | Prototipo: apre la discussione (verificato). Banco: il segno nel testo c'è, ma il clic porta il cursore dentro il segno e non apre la discussione | manca nell'app | Il 21/11 il segno non si vedeva |
| 81 | Clic sulla bolla nel margine | bolla → bolla | 3245, 4361 | Apre la discussione in entrambi (verificato) | uguale |  |
| 82 | Discussione: risposta con Ctrl Invio | campo → campo | 3249 | Aggiunge il messaggio. Prototipo: avviso «Risposta aggiunta in coda». Banco: nessun avviso, e la risposta è scritta senza nome («Senza nome») | diverso |  |
| 83 | Discussione: pulsante «Rispondi» | pulsante → pulsante | 3249 | Aggiunge il messaggio (verificato), senza avviso nel banco | diverso |  |
| 84 | Discussione: Risolvi | pulsante → pulsante | 3260–3266 | Il segno esce dal testo e la discussione va in archivio, con l'avviso e «Annulla» | uguale | Le parole dell'avviso sono diverse |
| 85 | Discussione risolta: Annulla | avviso → avviso | 3260 | Tornano bolle e segni (verificato in entrambi) | uguale |  |
| 86 | Discussione: Elimina | pulsante → pulsante | 3260 | Toglie segni e messaggi, con avviso e «Annulla» | uguale |  |
| 87 | Discussione: «Link» | pulsante → nessuno | 3256 | Prototipo: copia il link al commento, con avviso. Banco: nessuna azione Link (ci sono Risolvi ed Elimina) | manca nell'app |  |
| 88 | Scheda Commenti: clic su una scheda | scheda → scheda | 3367, 4361 | Apre la discussione della scheda, in entrambi (verificato) | fuori dal lavoro | Fuori dal foglio della cornice (l'ispettore); il 21/11: uguale |
| 89 | Scheda Commenti: «Svuota i risolti» | pulsante → pulsante | 3367–3388 | Prototipo: non c'è, c'è solo l'elenco «Risolti N». Banco: il pulsante c'è | fuori dal lavoro | Fuori dal foglio della cornice (l'ispettore); il 21/11: diverso |
| 90 | Tasto destro su un commento | menu → menu | 4284, 4267 | Prototipo: menu «Commento» con Apri la discussione, Risolvi, Copia il testo commentato. Banco: il menu del paragrafo (Incolla, Trasforma il blocco…) | diverso |  |
| 91 | Pulsante «Commenti» nella barra | pulsante → nessuno | 1553, 4350 | Prototipo: pulsante con il numero dei commenti, apre la scheda Commenti. Banco: nella barra non c'è | fuori dal lavoro | Fuori dal foglio della cornice (la barra del titolo); il 21/11: manca nell'app |
| 92 | Scheda Commenti senza commenti | testo → testo | 3367–3388 | «Nessun commento aperto. Seleziona del testo e premi Ctrl Alt M.» | fuori dal lavoro | Fuori dal foglio della cornice (l'ispettore); il 21/11: uguale |
| 93 | Clic semplice su un link | link → link | 4368, 3280 | Prototipo: avviso «Apre «…» in questo riquadro…», la nota non cambia. Banco: il cursore entra nel link, senza altro effetto | diverso |  |
| 94 | Ctrl clic su un link | link → link | 4368 | Prototipo: avviso «Apre «…» a lato». Banco: apre la nota «Benvenuto» nella stessa scheda | diverso |  |
| 95 | Alt clic su un link: la sbirciata | link → sbirciata | 3284–3288, 4368 | La sbirciata si apre in entrambi. Nel banco per una nota che non esiste dice «non c'è ancora» e propone «Crea la nota» | uguale |  |
| 96 | Sbirciata: «Apri qui» | pulsante → pulsante | 3290 | Prototipo: avviso «Apre «…» in questo riquadro». Banco: apre la nota nel riquadro | diverso | Il 21/11 non provabile; il 28/11 il link punta a una nota che c'è |
| 97 | Sbirciata: «A lato» | pulsante → pulsante | 3290 | Prototipo: avviso «Apre «…» in un riquadro a lato». Banco: apre la nota in un riquadro a lato | diverso | Come la riga 96 |
| 98 | Sbirciata: chiudere con la X | pulsante → pulsante | 3290 | Chiude in entrambi (verificato) | uguale |  |
| 99 | Sbirciata: Esc | tastiera → tastiera | 4394 | Chiude la sbirciata in entrambi. Con il puntatore ancora sul link resta la scheda di anteprima | uguale |  |
| 100 | Passaggio su un link, senza Ctrl | link → link | 3297 | Prototipo: nessuna scheda in Scrittura, solo la banda con le scorciatoie. Banco: la scheda di anteprima compare anche senza Ctrl | diverso |  |
| 101 | Ctrl tenuto sopra un link: anteprima | link → link | 3297, 3292 | La scheda compare in entrambi (verificato) | uguale |  |
| 102 | Lettura: passaggio su un link | link → link | 3297 | La scheda compare in entrambi (verificato) | uguale |  |
| 103 | Esc chiude la scheda di anteprima | tastiera → tastiera | 4393 | Chiude in entrambi (verificato) | uguale |  |
| 104 | Tasto destro su un link | menu → menu | 4283 | Prototipo: menu «Link alla nota» con Apri, Apri a lato, Sbircia, Copia il link, Togli il link. Banco: stesse voci, più Anteprima e Modifica il link… | diverso |  |
| 105 | Tasto destro su una persona | menu → nessuno | 4285 | Nella scena del banco la ricerca non trova una persona cliccabile nel testo | non provabile sul banco | Le persone nei valori si aprono come nella riga 48 |
| 106 | Ispettore: clic su una nota collegata | nota → nota | 4368, 1598 | Prototipo: apre la sbirciata (verificato). Banco: apre la nota «Nota lunga» nella scheda | fuori dal lavoro | Fuori dal foglio della cornice (l'ispettore); il 21/11: diverso |
| 107 | Pulsante «Ispettore» | pulsante → pulsante | 4349, 1500 | Nasconde e mostra in entrambi (verificato) | fuori dal lavoro | Fuori dal foglio della cornice (la barra del titolo e l'ispettore); il 21/11: uguale |
| 108 | Linguetta Struttura | linguetta → linguetta | 4352, 1598 | Mostra il contorno in entrambi | fuori dal lavoro | Fuori dal foglio della cornice (l'ispettore); il 21/11: uguale |
| 109 | Linguetta Collegamenti | linguetta → linguetta | 4352, 1599 | Mostra i collegamenti e le menzioni in entrambi | fuori dal lavoro | Fuori dal foglio della cornice (l'ispettore); il 21/11: uguale |
| 110 | Linguetta Commenti | linguetta → linguetta | 4352, 1600 | Mostra i commenti in entrambi | fuori dal lavoro | Fuori dal foglio della cornice (l'ispettore); il 21/11: uguale |
| 111 | Linguetta Compiti | linguetta → nessuno | 1601 | Prototipo: scheda con i compiti della nota e di altre note. Banco: la scheda non c'è | fuori dal lavoro | Fuori dal foglio della cornice (l'ispettore); il 21/11: manca nell'app |
| 112 | Linguetta Cronologia | linguetta → linguetta | 4352, 1602, 3384–3387 | Prototipo: righe statiche, nessun confronto né ripristino. Banco: elenco delle versioni con «Ripristina» | fuori dal lavoro | Fuori dal foglio della cornice (l'ispettore); il 21/11: diverso |
| 113 | Linguetta Proprietà | linguetta → nessuno | nessuna | Il prototipo non l'ha. Banco: scheda con parole, collegamenti, tag e data | fuori dal lavoro | Fuori dal foglio della cornice (l'ispettore); il 21/11: diverso |
| 114 | Frecce tra le linguette | tastiera → tastiera | nessuna | Prototipo: le frecce non spostano il fuoco. Banco: passano alla scheda successiva | fuori dal lavoro | Fuori dal foglio della cornice (l'ispettore); il 21/11: diverso |
| 115 | Struttura: clic su un titolo | voce del contorno → voce | 3371, 4367 | Prototipo e banco portano alla sezione scelta (verificato in entrambi) | fuori dal lavoro | Fuori dal foglio della cornice (l'ispettore); il 21/11: uguale |
| 116 | Struttura: «Inizio» in cima | voce → nessuno | 3371 | Prototipo: torna in cima (verificato). Banco: nel contorno non c'è la voce Inizio | fuori dal lavoro | Fuori dal foglio della cornice (l'ispettore); il 21/11: manca nell'app |
| 117 | Scorrere la nota: voce corrente evidenziata | scorrimento → scorrimento | 3390–3394 | Prototipo: la voce corrente cambia quando un titolo passa in alto (verificato). Banco: la nota scorre, ma nella foto nessuna voce del contorno risulta evidenziata | fuori dal lavoro | Fuori dal foglio della cornice (l'ispettore); il 21/11: diverso |
| 118 | Compiti: spunta di un compito della nota | spunta → nessuno | 3367–3388, 4362 | Prototipo: spunta il compito nella nota, con avviso. Banco: la scheda Compiti non c'è | fuori dal lavoro | Fuori dal foglio della cornice (l'ispettore); il 21/11: manca nell'app |
| 119 | Compiti: spunta di un compito di un'altra nota | spunta → nessuno | 4362–4363 | Prototipo: cambia solo l'aspetto della riga, con un avviso che dice «scrive nella nota d'origine». Il codice non scrive nella nota | fuori dal lavoro | Fuori dal foglio della cornice (l'ispettore); il 21/11: manca nell'app |
| 120 | Cronologia: clic su una versione | versione → versione | 3384–3387 | Prototipo: nessun effetto. Banco: la riga si seleziona, ma nel pannello non compare un confronto | fuori dal lavoro | Fuori dal foglio della cornice (l'ispettore); il 21/11: diverso |
| 121 | Ispettore a 700 px | ispettore → ispettore | 1596 | Nascosto in entrambi (verificato) | fuori dal lavoro | Fuori dal foglio della cornice (l'ispettore); il 21/11: uguale |
| 122 | Collegamenti: «Collega» una menzione | pulsante → pulsante | 3367–3388 | Prototipo: avviso «Collega: «Bando 2027» nomina…». Banco: il pulsante c'è; il clic non mostra avviso né cambi visibili | fuori dal lavoro | Fuori dal foglio della cornice (l'ispettore); il 21/11: diverso |

## Riassunto

- Gesti in tabella: 122.
- Uguali: 36. Diversi: 49. Manca nell'app: 12. Non provabili sul banco: 4.
  Fuori dal lavoro: 21.

## I cinque più visibili per chi usa Fub

1. «Aggiungi una proprietà» (righe 27-33): il clic non apre il menu e porta
   il cursore nel frontmatter. Ciò che si scrive dopo finisce lì come riga
   senza chiave, e il frontmatter diventa illeggibile.
2. Togliere una proprietà (righe 20-21): il prototipo offre «Annulla», il banco
   no. Un clic toglie la proprietà dalla nota senza ritorno.
3. Il primo commento (righe 72-79): il banco chiede il nome, il pulsante
   Commenta resta spento finché il nome è vuoto, il clic fuori non chiude il
   campo, e l'invio non dà avviso. Le risposte si scrivono senza nome (riga 82).
4. Il segno del commento nel testo (riga 80): si vede, ma il clic non apre la
   discussione; c'è solo la bolla nel margine.
5. Il menu della proprietà da tastiera (righe 18, 22, 23): aperto il
   sottomenu Tipo, il fuoco esce dal menu e la freccia sinistra non torna
   indietro.

## Limiti della prova

- Il finto host del banco non ha i comandi per cambiare il tipo di una
  proprietà e per creare un'opzione: le righe 19, 38 e 63 non si possono
  provare col banco. Vanno provate con l'app vera.
- Il banco ha dati di prova diversi dal prototipo (due persone, opzioni di
  stato diverse, un'opzione «Fatto» che nel banco è solo un gruppo, link a
  note che non esistono): i confronti sono per gesto e per effetto, non per
  valore.
- Il 21/11 il campo del commento, dopo il nome, non si era lasciato provare;
  il 28/11 la sonda scrive il nome e prova le righe 74-76.
- Le foto sono nello scratchpad della misura, non nel repository.
- Nessuna misura sull'app vera (WebView): il brief non la chiedeva.

## Note di metodo

- Un gesto è «uguale» quando produce lo stesso effetto. Un avviso mancante,
  un fuoco perso o un elemento assente rendono il gesto «diverso».
- Il prototipo è stato letto dal codice dello script. Il suo stato si legge
  dal DOM, perché lo script è chiuso in una funzione e le sue variabili non
  sono visibili dall'esterno.
