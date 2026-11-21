# Gesti dell'editor: scrittura, «/», «@», link e barra di formato

Inventario dei gesti del prototipo `PLAN-ui/editor.html` in quest'area, e la prova di ogni gesto nell'app sul banco, prototipo contro app.

## Dati

- Data: 2026-11-21.
- Prototipo: `PLAN-ui/editor.html` sul ramo `piano/editor-completo`, commit `c8b643653`.
- App: ramo `misure/gesti-2` a partire da `80e7c92eb` (`integra/editor-3`). Nessuna modifica al codice.
- Banco: porta 1691. Prototipo a 1680 × 1000, luce giorno, larghezza piena, movimento ridotto. App a 1280 × 800, luce chiara, la nota «Live» con `formatbar=1&slash=1` (con `toolbar=completa` per la barra piena).
- Prova: ogni gesto è un tasto, un clic, un passaggio del mouse o una combinazione di tasti veri, a partire dalla stessa riga vuota (prototipo: fine del primo paragrafo, a capo; app: riga sotto il titolo). Le schermate e i dati di prova stanno fuori dal repo.

## Come leggere la tabella

- Esito: **uguale**; **diverso** (le note dicono in che cosa); **manca nell'app** (il gesto nell'app non c'è); **non provabile sul banco** (con il motivo).
- La colonna «prototipo (riga dello script)» dà la riga di `PLAN-ui/editor.html` del gestore.
- Due cose non sono differenze di gesto. Le date relative: nel prototipo il giorno corrente è fissato al 9 novembre 2026, nel banco è il giorno della prova (21 novembre 2026). Le persone: il vault del banco non ha la cartella Persone, quindi l'app non propone persone.
- Dove il prototipo sbaglia, l'esito dice «diverso» e la nota dice «difetto del prototipo»: il comportamento è stato osservato nella prova, e il codice non fa quello che la sua banda promette.

## La tabella

| n | gesto | elemento (prototipo → app) | prototipo (riga dello script) | prototipo: cosa succede | app: cosa succede | esito | note |
|---|---|---|---|---|---|---|---|
| 1 | «/» in riga vuota apre il menu | menu «/» (`#pop.slash`) → `.slash-panel` | 3186, 3094 | menu con tessere, gruppi e dettaglio | menu con tessere, gruppi e dettaglio | uguale | le voci differiscono, vedi sotto |
| 2 | «/» dopo uno spazio in una frase | trigger del «/» | 3186 | apre il menu | apre il menu | uguale | - |
| 3 | «/» attaccato a una parola (`a/`) | trigger del «/» | 3186 | nessun menu | nessun menu | uguale | - |
| 4 | «/tit» filtra le voci | filtro del menu | 3099-3106 | tre voci: Titolo 1, 2, 3 | Titolo 1-6, Indice, «Cerca «tit» fra tutti i comandi» | diverso | l'app ha anche H4-H6 e l'indice |
| 5 | Esc chiude il «/» e lascia il testo | tasto Esc | 4390-4399, 3150 | chiude, il «/» resta | chiude, il «/» resta | uguale | - |
| 6 | Frecce ↓ due volte | tasti freccia | 3144-3145 | evidenzia «Titolo 1» | evidenzia «Titolo 2» | diverso | il prototipo parte dal gruppo «Testo» |
| 7 | Frecce ← → fra le tessere | tessere rapide | 3146 | due volte → porta su «Riquadro» | due volte → porta su «Riquadro» | uguale | - |
| 8 | Tab va al gruppo dopo | tasto Tab | 3147 | va alla prima voce di «Testo» | va alla prima voce «Titolo 1» | diverso | gruppo di partenza diverso |
| 9 | Passaggio del mouse su una voce | voci del menu | 3137 | cambia la voce attiva | cambia la voce attiva | uguale | - |
| 10 | Clic su una voce («Citazione») | voce del menu | 3136, 3122-3134 | citazione e avviso | citazione, nessun avviso | diverso | manca l'avviso |
| 11 | Invio su «Titolo 2» | voce del menu | 3122-3134 | titolo 2 e avviso «al posto della riga vuota» | «## » senza avviso | diverso | manca l'avviso |
| 12 | Invio senza risultati (`/qwerty`) | ricerca dei comandi | 3135, 4171 | apre la ricerca dei comandi | apre la ricerca dei comandi, senza risultati | uguale | le scritte degli stati vuoti differiscono |
| 13 | «/persona» scrive «@» e apre le persone | voce Persona | 3164, 3127 | «@» e quattro persone con le date | «@» e solo le date e «Nuova persona» | diverso | il banco non ha persone nel vault |
| 14 | «/domani» inserisce la data | voce Data (parseWhen) | 3105, 3130 | pillola «10 novembre 2026» | link alla nota giornaliera con la data | diverso | forma diversa |
| 15 | «/separatore» | voce Separatore | 3131 | linea e paragrafo sotto | linea «---» e riga nuova | uguale | - |
| 16 | «/tabella» (voce del menu) | voce Tabella | 3133 | solo avviso «Nel prodotto», nessuna tabella | passo della tabella (griglia 3 × 3) | diverso | il prototipo non inserisce la tabella |
| 17 | «/tab 3x4» (comando rapido) | comando rapido | 3101-3102 | solo avviso «Nel prodotto»: 3 colonne e 4 righe | tabella di 4 colonne: il primo numero sono le righe | diverso | nel prototipo il primo numero sono le colonne |
| 18 | «/riquadro» | voce Riquadro | 3132 | riquadro di tipo predefinito e avviso | passo della scelta del tipo | diverso | - |
| 19 | «/compito» | voce Elenco di attività | 3132 | compito e avviso | compito | uguale | solo l'avviso |
| 20 | «/elenco puntato» | voce Elenco puntato | 3132 | elenco e avviso | elenco | uguale | solo l'avviso |
| 21 | «/codice» | voce Codice | 3132 | blocco di codice e avviso | passo della lingua, poi il blocco | diverso | - |
| 22 | «/formula» (blocco) | voce Formula | 3129 | blocco con il campo LaTeX a fuoco | blocco con i due dollari | diverso | nel prototipo il campo è a vista |
| 23 | «/formula in riga» | voce Formula in riga | 3128 | formula in riga con il campo a fuoco | nessuna voce: «Nessun blocco per «formula in»» | manca nell'app | anche il dollaro singolo non la apre |
| 24 | «/link» (link a una nota) | voce Link a una nota | 3127 | scrive «[[» e apre l'elenco delle note | prima voce «Link» (Markdown): scrive «[testo]()» | diverso | l'app ha anche «Link a una nota [[» come seconda voce |
| 25 | «/base» | voce Base | 3133 | solo avviso «Nel prodotto» | nessuna voce Base: Invio inserisce un elenco di attività | manca nell'app | la Base non compare nel «/» di questo banco |
| 26 | «/colonne» | voce Colonne | 3133 | solo avviso «Nel prodotto» | inserisce le colonne | diverso | - |
| 27 | «/diagramma» | voce Diagramma | 3133 | solo avviso «Nel prodotto» | passo della scelta del tipo di diagramma | diverso | - |
| 28 | «/ripiegabile» | voce Ripiegabile | 3132 | elenco ripiegabile e avviso | blocco ripiegabile | uguale | solo l'avviso |
| 29 | «/citazione» | voce Citazione | 3132 | citazione e avviso | «> » | uguale | solo l'avviso |
| 30 | «/titolo 3» | voce Titolo 3 | 3132 | titolo 3 e avviso | «### » | uguale | solo l'avviso |
| 31 | «/data» (voce del menu) | voce Data | 3160 | apre il menu «@» con persone e date | passo Data con il calendario | diverso | - |
| 32 | «/» in riga vuota: tessere e gruppi | tessere e gruppi | 3098-3115 | Attività, Titolo, Riquadro, Tabella, Base, Scheda | Attività, Titolo, Riquadro, Tabella, Punti, Codice | diverso | Base e Scheda non ci sono nel banco |
| 33 | «# » a inizio riga | regola di scrittura | 3178, 3184 | titolo 2 e avviso «è diventato Titolo 2» | Titolo 1 (H1) | diverso | nel prototipo il Titolo 1 è un H2 |
| 34 | «## » a inizio riga | regola di scrittura | 3178 | titolo 2 e avviso | titolo 2 | uguale | solo l'avviso |
| 35 | «### » a inizio riga | regola di scrittura | 3178 | titolo 3 e avviso | titolo 3 | uguale | solo l'avviso |
| 36 | «- » a inizio riga | regola di scrittura | 3178 | elenco puntato e avviso | elenco puntato | uguale | solo l'avviso |
| 37 | «- [ ] » a inizio riga | regola di scrittura | 3178 | elenco puntato con «[ ]» nel testo | compito | diverso | nel prototipo il trattino converte prima: il compito non si crea così |
| 38 | «[] » a inizio riga | regola di scrittura | 3178 | compito e avviso | compito | uguale | - |
| 39 | «> » a inizio riga | regola di scrittura | 3178 | citazione e avviso | citazione | uguale | solo l'avviso |
| 40 | «1. » a inizio riga | nessuna regola | non c'è | resta testo | elenco numerato | diverso | solo nell'app |
| 41 | «$» a inizio riga | regola del dollaro | 3189-3190 | formula in riga con il campo a fuoco | resta il dollaro | diverso | - |
| 42 | Invio a fine paragrafo | gestore di Invio | 4424-4429 | nuovo paragrafo | nuova riga | uguale | - |
| 43 | Invio a metà paragrafo | gestore di Invio | 4424-4429 | la coda passa nel paragrafo nuovo | la coda passa nella riga nuova | uguale | - |
| 44 | Invio in un elenco puntato | gestore di Invio | 4426 | nuovo elemento | nuovo elemento | uguale | - |
| 45 | Invio su una voce vuota di elenco | gestore di Invio | 4427 | torna paragrafo | torna testo | uguale | - |
| 46 | Invio in un compito | gestore di Invio | 4426 | nuovo compito | nuovo compito | uguale | - |
| 47 | Ctrl Invio spunta il compito | gestore di Ctrl Invio | 4423 | spunta e scrive la data del giorno | spunta e scrive [x] | diverso | il prototipo aggiunge la data di completamento |
| 48 | Backspace in testa a un titolo | gestore di Backspace | 4433 | torna paragrafo | toglie il segno del titolo | uguale | - |
| 49 | Backspace in testa a un paragrafo | gestore di Backspace | 4434-4437 | unisce con il precedente | unisce con il precedente | uguale | - |
| 50 | Backspace su una riga vuota | gestore di Backspace | 4435 | la riga va via | la riga va via | uguale | - |
| 51 | Tab in un elenco | nessun gestore: Tab nativo | non c'è | il cursore va al blocco successivo | rientra la voce | diverso | - |
| 52 | Ctrl Alt 0: testo | tasti Ctrl Alt | 4403 | torna paragrafo | torna testo | uguale | - |
| 53 | Ctrl Alt 2: titolo 2 | tasti Ctrl Alt | 4403 | titolo 2 | titolo 2 | uguale | - |
| 54 | Ctrl Alt 1: titolo | tasti Ctrl Alt | 4403 | titolo 2 | titolo 1 | diverso | nel prototipo il tasto 1 dà H2 |
| 55 | Ctrl Alt 3: titolo 3 | tasti Ctrl Alt | 4403 | titolo 3 | titolo 3 | uguale | - |
| 56 | Ctrl Alt 4: elenco di attività | tasti Ctrl Alt | 4403 | compito | compito | uguale | - |
| 57 | Ctrl Alt 5: elenco puntato | tasti Ctrl Alt | 4403 | elenco puntato | elenco puntato | uguale | - |
| 58 | Ctrl Alt 6 | tasti Ctrl Alt | non c'è | nessun effetto | elenco numerato | diverso | solo nell'app |
| 59 | Ctrl Alt 7: ripiegabile | tasti Ctrl Alt | 4403 | ripiegabile | ripiegabile | uguale | - |
| 60 | Ctrl Alt 8 | tasti Ctrl Alt | non c'è | nessun effetto | blocco di codice | diverso | solo nell'app |
| 61 | Ctrl B grassetto sulla parola scelta | tasto nativo del campo | non c'è | grassetto | grassetto | uguale | il prototipo scrive tag, l'app asterischi |
| 62 | Ctrl I corsivo | tasto nativo del campo | non c'è | corsivo | corsivo | uguale | - |
| 63 | Ctrl U sottolineato | tasto nativo del campo | non c'è | sottolineato | sottolineato | uguale | - |
| 64 | Ctrl Maiusc X barrato | nessun gestore (il titolo del pulsante lo dice) | non c'è | nessun effetto | barrato | diverso | manca nel prototipo |
| 65 | Ctrl K con testo scelto | nessun gestore (la banda lo scrive) | non c'è | nessun effetto | apre «Inserisci un collegamento» | diverso | manca nel prototipo |
| 66 | Ctrl K senza testo scelto | nessun gestore | non c'è | nessun effetto | apre la finestra del collegamento | diverso | manca nel prototipo |
| 67 | Ctrl Z annulla | annullamento del campo | non c'è | annulla una lettera: «Uno» diventa «Un» | annulla la parola intera | diverso | granularità diversa |
| 68 | Ctrl Y ripete | ripetizione del campo | non c'è | ripete: «Uno» | ripete: «Uno» | uguale | - |
| 69 | Ctrl Maiusc 8: elenco puntato | nessun gestore | non c'è | nessun effetto | elenco puntato | diverso | solo nell'app |
| 70 | Ctrl Maiusc 7: elenco numerato | nessun gestore | non c'è | nessun effetto | elenco numerato | diverso | solo nell'app |
| 71 | Selezionare testo mostra la minibarra | minibarra (`#minibar`) → `.mini-bar` | 3193-3205 | Trasforma, B, I, U, S, codice, collega, colore, commenta | gli stessi pulsanti | uguale | - |
| 72 | Minibarra: B grassetto | pulsante B | 3209 | grassetto | grassetto | uguale | - |
| 73 | Minibarra: I corsivo | pulsante I | 3209 | corsivo | corsivo | uguale | - |
| 74 | Minibarra: U sottolineato | pulsante U | 3209 | sottolineato | sottolineato | uguale | - |
| 75 | Minibarra: S barrato | pulsante S | 3209 | barrato | barrato | uguale | - |
| 76 | Minibarra: codice in riga | pulsante codice | 3210 | codice in riga | codice in riga | uguale | - |
| 77 | Minibarra: collega | pulsante collega | 3213, 3217 | menu con le note, in alto a sinistra della finestra | finestra «Inserisci un collegamento» | diverso | nel prototipo l'ancora è già nascosta |
| 78 | Minibarra: colore | pulsante colore | 3214 | due file di colori: Testo e Sfondo | due file di colori: Testo e Sfondo | uguale | - |
| 79 | Minibarra: Trasforma | pulsante Trasforma | 3212 | menu del blocco: Trasforma in, Colore, Commenta, Duplica | menu di trasformazione: Testo, titoli, citazione, elenchi | diverso | - |
| 80 | Minibarra: commenta | pulsante Commenta | 3215 | apre il commento sulla selezione | apre il commento sulla selezione | uguale | - |
| 81 | Selezione tolta: la minibarra si nasconde | selectionchange | 3200-3202 | si nasconde | si nasconde | uguale | - |
| 82 | Pannello del link: incolla un indirizzo https | voce «indirizzo web» | 3219 | link sul testo scelto | [testo](https://…) | uguale | forma diversa |
| 83 | Pannello del link: sceglie una nota | voce della nota | 3219 | link alla nota con il testo scelto | [[Benvenuto.md/testo]] | uguale | forma diversa |
| 84 | Pannello del link: Esc | tasto Esc | 4390 | chiude, il testo resta | chiude, il testo resta | uguale | - |
| 85 | Pannello del link: scrive per filtrare | campo di ricerca | 3219 | elenco filtrato (vuoto per «sint») | elenco filtrato dal vault | uguale | dati diversi |
| 86 | Pannello del link: pulsante Annulla | nessun pulsante | non c'è | non c'è | chiude senza inserire | diverso | solo nell'app |
| 87 | Link: Alt Invio apre il link | tasti Alt Invio sul link | non c'è (la banda, riga 2530, lo promette) | nessun effetto | apre la nota a lato: «Apri qui», «A lato» | diverso | manca nel prototipo |
| 88 | Link: Alt clic (sbirciata) | clic con Alt sul link (`#peek`) | 3289 | apre la sbirciata: «Apri qui», «A lato» | apre la sbirciata: «Apri qui», «A lato» | uguale | - |
| 89 | Link: Ctrl sopra il link (anteprima) | anteprima sul link (`#hovercard`) | 3291-3296 | scheda con il testo della nota | scheda con «Apri», «Di fianco», «Nuova linguetta» e il testo | uguale | pulsanti diversi |
| 90 | «[[» apre l'elenco delle note | trigger «[[» | 3188, 3172 | elenco di sei note | note del vault; chiude da sé le parentesi [[]] | diverso | auto-chiusura nell'app |
| 91 | «[[bib» filtra | filtro | 3173 | Biblioteca civica e «Crea «bib»» | Benvenuto | uguale | dati diversi |
| 92 | «[[» con Invio sulla nota | scelta della voce | 4383, 3173 | nessun link: errore nella pagina e a capo | inserisce [[Benvenuto]] | diverso | difetto del prototipo |
| 93 | «[[» con clic su una nota | clic sulla voce | 3173 | nessun link: errore nella pagina | inserisce [[Benvenuto]] | diverso | difetto del prototipo |
| 94 | «[[Zeta» (nome nuovo) | voce Crea | 3173 | «Crea «Zeta» nella cartella delle note nuove» | nessuna proposta | manca nell'app | - |
| 95 | «[[Zeta» con Invio | scelta della voce Crea | 3173 | nessun link: errore e a capo | a capo dentro il link: «]]» va alla riga dopo | diverso | entrambi sbagliano; l'app lascia il link spezzato |
| 96 | «[[^^» cerca i blocchi | ricerca di blocchi | 3173 | solo «Crea «^^»»: nessun blocco | nessuna proposta | diverso | - |
| 97 | «[[^^tema» cerca i blocchi | ricerca di blocchi | non c'è | solo «Crea»: il prototipo non cerca i blocchi | blocchi del vault, per esempio «Sintassi di Fub» | diverso | manca nel prototipo |
| 98 | «[[#» cerca i titoli | ricerca di titoli | 3173 | solo «Crea «#»» | etichette del vault (#banco…) | diverso | l'app propone etichette, non titoli |
| 99 | Esc sul completamento dei link | tasto Esc | 4390 | chiude, «[[» resta | chiude, «[[]]» resta | uguale | - |
| 100 | «@» in riga vuota | trigger «@» | 3187, 3160 | quattro persone e le date del giorno e di domani | solo le date del giorno e di domani | diverso | il banco non ha persone |
| 101 | «@» dopo uno spazio | trigger «@» | 3187 | come sopra | come sopra | diverso | persone |
| 102 | «mail@» (attaccato a una parola) | trigger «@» | 3187 | nessun menu | nessun menu | uguale | - |
| 103 | «@an» filtra le persone | filtro persone | 3162 | Anna Bianchi e «Nuova persona» | solo «Nuova persona «an»» | diverso | dati diversi |
| 104 | «@an» con Invio su una persona | scelta della voce | 3164 | nessun inserimento: errore e a capo | crea Persone/an e il link | diverso | difetto del prototipo |
| 105 | «@an» con clic su una persona | clic sulla voce | 3164 | nessun inserimento: errore | non c'è una persona da scegliere | non provabile sul banco | il vault del banco non ha persone |
| 106 | «@domani» con Invio | scelta della data | 3165 | nessun inserimento: errore e a capo | link alla nota giornaliera | diverso | difetto del prototipo |
| 107 | «@domani» in un compito | scelta della data nel compito | 3165 | nessun inserimento: errore | link alla giornaliera; la scadenza 📅 è nella lista | diverso | difetto del prototipo |
| 108 | «@Zeta» (persona nuova) con Invio | voce Nuova persona | 3166 | nessuna persona creata: errore | crea Persone/Zeta e il link | diverso | difetto del prototipo |
| 109 | Esc sul menu «@» | tasto Esc | 4390 | chiude, «@» resta | chiude, «@» resta | uguale | - |
| 110 | «@venerdì» | parseWhen | 2460-2473 | venerdì 13 novembre 2026 e nuova persona | venerdì prossimo e nuova persona | uguale | data diversa per l'orologio |
| 111 | «@20 marzo» | parseWhen | 2468 | 20 marzo 2027, il prossimo | 20 marzo 2026 e 20 marzo 2027 | diverso | l'app elenca anche la data passata |
| 112 | «@fra due settimane» | parseWhen | 2466 | data a 14 giorni | data a 14 giorni | uguale | - |
| 113 | «@» con la parola del giorno corrente | parseWhen | 2462 | il giorno fissato: 9 novembre 2026 | il giorno del banco, la data della prova | uguale | data diversa per l'orologio |
| 114 | «@20/3» | parseWhen | 2469 | 20 marzo 2026 e nuova persona | nessuna proposta | diverso | - |
| 115 | «@2027-03-20» | parseWhen | 2471 | 20 marzo 2027 | 20 marzo 2027 | uguale | - |
| 116 | «@prossimo martedì» | parseWhen | 2464 | martedì della settimana dopo | martedì della settimana dopo | uguale | data diversa per l'orologio |
| 117 | Barra: annulla | pulsante Annulla | 3416 | annulla una lettera: «Uno» diventa «Un» | annulla la parola intera | diverso | come Ctrl Z |
| 118 | Barra: ripeti | pulsante Ripeti | 3416 | ripete | ripete | uguale | - |
| 119 | Barra: stile del paragrafo (menu) | pulsante stile | 3411 | sei voci con scorciatoie Ctrl Alt | sei voci, «Altri titoli›», scorciatoie Ctrl Maiusc | diverso | - |
| 120 | Barra: stile, scelta di Titolo 2 | voce del menu | 3411 | titolo 2 | titolo 2 | uguale | - |
| 121 | Barra: grassetto con testo scelto | pulsante B | 3417 | grassetto | grassetto | uguale | - |
| 122 | Barra: grassetto senza testo scelto | pulsante B | 3417 | avviso «Seleziona del testo…» | scrive **** nel testo | diverso | l'app sporca il testo |
| 123 | Barra: corsivo con testo scelto | pulsante I | 3417 | corsivo | corsivo | uguale | - |
| 124 | Barra: barrato (barra completa) | pulsante S | 3417 | barrato | nessun pulsante nella barra | manca nell'app | il barrato c'è solo nella minibarra |
| 125 | Barra: codice in riga (barra completa) | pulsante codice | 3420 | solo avviso «Nel prodotto» | codice in riga | diverso | - |
| 126 | Barra: collega senza testo scelto | pulsante Link | 3418 | avviso «Seleziona il testo da collegare» | scrive «[parola]()» con la parola sotto il cursore | diverso | - |
| 127 | Barra: collega con testo scelto | pulsante Link | 3418 | menu delle note | scrive «[parola]()» vuoto | diverso | - |
| 128 | Barra: elenco puntato | pulsante elenco | 3419 | elenco puntato | elenco puntato | uguale | - |
| 129 | Barra: elenco di attività | pulsante compito | 3419 | compito | compito | uguale | - |
| 130 | Barra: citazione (barra completa) | pulsante citazione | 3419 | citazione | citazione | uguale | - |
| 131 | Barra: tabella (barra completa) | pulsante tabella | 3420 | solo avviso «Nel prodotto» | tabella, dal menu «Altri strumenti» | diverso | - |
| 132 | Barra: Inserisci (menu dei blocchi) | pulsante Inserisci | 3422-3425 | menu «Cerca un blocco» con i blocchi del «/» | menu «Cerca un blocco» con i blocchi | uguale | stesse sezioni, voci diverse |
| 133 | Barra: Inserisci, scelta di Titolo 2 | voce del menu | 3424 | titolo 2 | titolo 2 | uguale | - |
| 134 | Barra del compito: Scadenza | pulsante Scadenza | 3412 | calendario con le scelte rapide per il giorno, domani e la settimana, il mese, Togli la data | inserisce «@» nel compito, nessun calendario | diverso | - |
| 135 | Barra del compito: Promemoria | pulsante Promemoria | 3412 | calendario con l'ora | calendario del promemoria | uguale | l'ora non è stata provata nell'app |
| 136 | Barra del riquadro: tipo | pulsante del tipo | 3413 | cinque tipi con nomi in italiano: Consiglio, Nota, Attenzione, Domanda, Fatto | dieci tipi con nomi in inglese: Abstract, Info, Todo, Tip… | diverso | nomi in inglese nell'app |
| 137 | Barra del riquadro: Ripiegabile | pulsante Ripiegabile | 3414 | solo avviso che spiega il «+» | scrive «+» nel tipo: il riquadro si ripiega | diverso | - |
| 138 | Barra della tabella: Riga | pulsante Riga | non c'è | aggiunge la riga e la mette a fuoco | aggiunge una riga | uguale | conteggio e schermata |
| 139 | Barra della tabella: Ordina | pulsante Ordina (`#tb-sort`) | 3722 | ordina subito in crescente, sulla colonna della cella scelta | apre il menu: «Dalla A alla Z», «Dalla Z alla A» | diverso | nel prototipo una sola direzione |
| 140 | Barra della Base: A tutta pagina | pulsante (contesto Base) | 3414 | solo avviso «Apre «Opere.base»…» | non provato | non provabile sul banco | la nota di prova non ha una Base: va provato con la scena della Base |
| 141 | Barra del foglio: Apri, Mostra come | pulsanti (contesto Foglio) | 3414 | solo avvisi | non provato | non provabile sul banco | la nota di prova non ha un foglio vivo |
| 142 | Barra della trasclusione: Apri l'origine | pulsante (contesto Trasclusione) | 3414 | solo avviso | non provato | non provabile sul banco | la nota di prova non ha una trasclusione |
| 143 | Banda: riga vuota | suggerimenti base | 2523, 2546 | «/ inserisce un blocco · @ persone e date · Ctrl O cerca o esegue · Esc seleziona il blocco» | la stessa frase, con Ctrl+O | uguale | solo la forma del tasto |
| 144 | Banda: testo scelto | suggerimenti del testo | 2526, 3204 | «Ctrl B Ctrl I · Ctrl K collega · Ctrl Alt M commenta» | «Ctrl+B grassetto · Ctrl+I corsivo · Ctrl+K collega» | diverso | parole diverse |
| 145 | Banda: dentro un compito | suggerimenti del compito | 2527, 3403 | «Ctrl Invio spunta · una data scritta con @ diventa la scadenza · Tab rientra» | «Ctrl+Enter spunta · @ una data diventa la scadenza · Tab rientra» | uguale | solo la forma |
| 146 | Banda: menu «/» aperto | suggerimenti del «/» | 2531, 3152 | «↑↓ scegli · ↵ metti · Tab gruppo dopo · Esc lascia il testo · Ctrl / tutti i comandi» | «↑↓ scegli · Enter metti · Tab gruppo dopo · Esc lascia il testo · Ctrl+/ tutti i comandi» | uguale | solo la forma |
| 147 | Banda: passaggio su un link | suggerimenti del link | 2530, 3296 | «Ctrl sopra un link: l'anteprima · Alt clic: la sbirciata · Alt Invio lo apre» | «Ctrl sopra il link: l'anteprima · Alt+Enter lo apre» | diverso | manca «Alt clic: la sbirciata» |
| 148 | Ctrl E: lettura | modo lettura | 4401, 4112 | passa alla lettura | passa alla lettura | uguale | il testo della banda in lettura non è stato confrontato |
| 149 | Esc seleziona il blocco | gestore di Esc | 4396-4397 | seleziona il blocco | seleziona il testo della riga | diverso | - |
| 150 | Avviso dopo un inserimento dal «/» | avviso (`#toast`) | 2512-2519, 3132 | avviso con il testo e la scorciatoia | nessun avviso | manca nell'app | il prototipo spiega la scorciatoia |

## Riassunti

- Uguali: 75.
- Diversi: 66.
- Mancanti nell'app: 5.
- Non provabili sul banco: 4.
- Totale dei gesti: 150.

Non provabili sul banco, con il motivo: il clic su una persona da «@» (il vault del banco non ha persone), e il pulsante Base, il foglio e la trasclusione della barra di formato. Per questi tre contesti la nota di prova non ha una Base, un foglio né una trasclusione: servono le scene del banco che li contengono, e questa sonda non le apre. È un limite della prova, non un difetto del banco.

## I cinque più visibili per chi scrive

1. **`[[` chiude da sé le parentesi.** Scrivendo `[[` l'app mette `[[]]` (tabella, n. 90); il prototipo mette solo `[[`. Con Invio su un nome nuovo l'app spezza il link su due righe (tabella, n. 95).
2. **Grassetto senza testo scelto.** Il pulsante B dell'app scrive `****` nel testo (tabella, n. 122). Il prototipo mostra un avviso che spiega come fare.
3. **Tipi di riquadro in inglese.** Il menu del riquadro nell'app dice Abstract, Info, Todo, Tip, e così via (tabella, n. 136). Il prototipo ha Consiglio, Nota, Attenzione, Domanda, Fatto.
4. **Scadenza del compito.** Il pulsante Scadenza nell'app inserisce `@` e non apre il calendario che il prototipo mostra (tabella, n. 134).
5. **Barrato senza pulsante nella barra.** Nell'app il barrato c'è in minibarra e con Ctrl Maiusc X, ma non nella barra di formato (tabella, n. 124).

## Difetti del prototipo emersi dalla prova

Sono nella tabella, con l'esito «diverso» e la nota. In sintesi:

- Invio o clic su una voce di «[[» e di «@» non inserisce nulla e lascia un errore nella pagina (`Cannot read properties of null`): il menu si chiude prima che la voce legga il suo punto di inserimento.
- Digitare `- [ ] ` crea un elenco con «[ ]» nel testo, non un compito.
- Ctrl Maiusc X, Ctrl K e Alt Invio non fanno nulla, anche se la banda o il pulsante li scrivono.
- Sette casi provati mostrano solo l'avviso «Nel prodotto» e non inseriscono niente: le voci del «/» tabella, tabella 3×4, base, colonne e diagramma, e i pulsanti codice in riga e tabella della barra.
- Il pannello del link della minibarra si apre in alto a sinistra della finestra, perché la sua ancora è già nascosta.
- «[[^^» non cerca i blocchi: propone solo «Crea».
