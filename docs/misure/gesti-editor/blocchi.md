# I gesti dell'editor: blocchi e trascinamento

Confronto gesto per gesto fra il prototipo dell'editor Markdown (`PLAN-ui/editor.html`) e l'app, nell'area dei blocchi: maniglia e «+», menu del blocco, selezione di più blocchi, eliminazione e spostamento, trascinamento, cambio di tipo, Invio, Backspace e Tab nei blocchi, cursore fra un blocco e l'altro.

> **Per chi:** chi corregge l'editor, per sapere quali gesti sono diversi dal prototipo prima di cambiarli.
> **Risultato:** su 102 gesti, 59 sono uguali, 31 diversi, 3 mancano nell'app, 2 non si possono provare sul banco e 7 non sono stati provati in questa misura, con il motivo nella riga.

## Come è misurato

- **Data:** 2026-11-21.
- **Prototipo:** `PLAN-ui/editor.html` sul ramo `piano/editor-completo`, commit `c8b643653`.
- **App:** codice del ramo `misure/gesti-1`, che parte da `80e7c92eb` (`integra/editor-3`). La misura non cambia il codice dell'app.
- Ogni gesto parte da una pagina nuova. Il prototipo si apre da file, con la finestra piena e la luce del giorno; l'app è la scena dei blocchi del banco, con la luce chiara e la finestra da 1280 px.
- Il gesto è fatto col mouse e con la tastiera. L'esito si legge dallo stato prima e dopo: blocchi e testo del Markdown, maniglia, menu, selezione, banda e avvisi.
- Il riferimento è il codice del prototipo: la colonna «prototipo» dà le righe dello script. Ogni comportamento è anche confermato facendo il gesto.
- La colonna «elemento» dà il selettore nei due lati, come nella mappa della conformità.

## Limiti della misura

- Il banco gira in Chromium, non nella finestra di Tauri (WebKit). Dove il comportamento dipende dal motore, come le frecce fra blocchi del prototipo, va riverificato nell'app vera.
- Il prototipo carica i caratteri da Google Fonts: nella misura la rete è chiusa, e si vedono i caratteri di ripiego. Non cambia i gesti.
- L'host del banco è finto: i comandi che scrivono in un'altra nota (spostare un blocco in un'altra nota) non girano. Per questo quei gesti risultano «non provabili sul banco».

## Gesti

Esiti: **uguale** (stesso effetto), **diverso** (effetto diverso, dettagli nella riga), **manca nell'app** (il gesto del prototipo non fa niente nell'app), **non provabile sul banco** (il banco non può farlo), **non provato** (non misurato in questa sessione, con il motivo).

| n | gesto | elemento (prototipo → app) | prototipo (riga dello script) | app | esito | note |
|---|---|---|---|---|---|---|
| 1 | Passaggio del mouse su un paragrafo | `#gutter` → `.cm-fub-block-handles` | 2855–2869: Compaiono la maniglia e il «+» sul blocco sotto il puntatore | Compaiono la maniglia e il «+» sul blocco sotto il puntatore | uguale | — |
| 2 | Passaggio del mouse su un titolo di sezione | `#gutter` → `.cm-fub-block-handles` | 2855–2869: La maniglia compare sul titolo | La maniglia compare sul titolo | uguale | — |
| 3 | Il puntatore esce dalla colonna a destra | `#gutter` → `.cm-fub-block-handles` | 2866: La maniglia si nasconde | La maniglia si nasconde | uguale | — |
| 4 | Il puntatore esce dall'area di scorrimento | `#scroll` → area di scorrimento | 2870: La maniglia si nasconde | La maniglia si nasconde | uguale | — |
| 5 | Clic sul «+» | `#g-add` → `.cm-fub-block-add` | 3020–3023: Paragrafo nuovo sotto, cursore dentro, «/» scritto come testo; nessun menu | Riga nuova sotto, cursore dentro, «/» scritto e si apre il pannello dei comandi «/» | diverso | nel prototipo il «/» resta testo; nell'app il pannello propone Collegamenti e media, Persone e date, Promemoria |
| 6 | Alt+clic sul «+» | `#g-add` (con Alt) → `.cm-fub-block-add` (con Alt) | 3021: Blocco nuovo sopra il blocco | Blocco nuovo sotto, come il clic normale | manca nell'app | l'app non legge il tasto Alt sul «+» |
| 7 | Clic sulla maniglia, senza trascinare | `#g-grip` → `.cm-fub-block-grip` | 2929: Menu del blocco sotto la maniglia; il cursore resta dov'era | Menu del blocco; il testo del blocco si seleziona e il fuoco va alla ricerca del menu | diverso | nell'app il testo del blocco diventa selezione all'apertura del menu |
| 8 | Tasto destro sulla maniglia | `#g-grip` → `.cm-fub-block-grip` | 2919–2931 (risponde a ogni pulsante): Lo stesso menu, sotto la maniglia | Lo stesso menu, nel punto del puntatore; il testo del blocco si seleziona | diverso | stesso menu, punto di apertura diverso |
| 9 | Tasto destro sul testo di un paragrafo, senza selezione | testo del blocco → testo del blocco | 4266–4300: Incolla, Trasforma il blocco, Inserisci un blocco…, Copia il link a questo punto | Stesse quattro voci | uguale | — |
| 10 | Menu del blocco → «Trasforma in» (apre i tipi) | voce «Trasforma in» → voce «Trasforma» | 2879, 2883: Otto tipi: Testo, Titolo 2, Titolo 3, Elenco puntato, Elenco di attività, Citazione, Riquadro, Ripiegabile | Undici tipi: Testo, Titolo 1, Titolo 2, Titolo 3, Elenco puntato, Elenco numerato, Elenco di attività, Citazione, Riquadro, Blocco di codice, Ripiegabile | diverso | l'app ha in più Titolo 1, Elenco numerato e Blocco di codice |
| 11 | Trasforma → Titolo 2 | voce del tipo | 2751–2758: Il paragrafo diventa titolo 2 | Il testo riceve «## » in testa | uguale | — |
| 12 | Trasforma → Titolo 3 | voce del tipo | 2751–2758: Il paragrafo diventa titolo 3 | Il testo riceve «### » in testa | uguale | — |
| 13 | Trasforma → Titolo 1 | voce del tipo | voce assente: Non c'è la voce | Il testo riceve «# » in testa | diverso | solo nell'app |
| 14 | Trasforma → Elenco puntato | voce del tipo | 2751–2758: Il paragrafo diventa elemento di elenco | Il testo riceve «- » in testa | uguale | — |
| 15 | Trasforma → Elenco numerato | voce del tipo | voce assente: Non c'è la voce | Il testo riceve «1. » in testa | diverso | solo nell'app |
| 16 | Trasforma → Elenco di attività | voce del tipo | 2751–2758: Il paragrafo diventa attività | Il testo riceve «- [ ] » in testa | uguale | — |
| 17 | Trasforma → Citazione | voce del tipo | 2751–2758: Il paragrafo diventa citazione | Il testo riceve «> » in testa | uguale | — |
| 18 | Trasforma → Riquadro | voce del tipo | 2751–2758: Diventa riquadro con titolo «Nota» | Diventa riquadro «> [!note]» con titolo «Note» | uguale | solo il titolo cambia di parola |
| 19 | Trasforma → Ripiegabile | voce del tipo | 2751–2758: Diventa blocco ripiegabile | Diventa blocco `<details>` | uguale | nel file l'app scrive HTML |
| 20 | Trasforma → Codice | voce del tipo | voce assente: Non c'è la voce: il codice nasce dal «/» | Diventa blocco di codice con recinto | diverso | solo nell'app |
| 21 | Trasforma → Testo (da un titolo) | voce del tipo | 2751–2758: Il titolo torna paragrafo | Via il «## » in testa: torna paragrafo | uguale | — |
| 22 | Menu del blocco → Colore → rosso | `[data-sw]` → campione «Rosso» di Testo | 2884: Il testo riceve uno span con la classe del colore (avviso «Scritto in HTML ammesso») | Sottomenu Colore con due livelli (Testo e Fondo); la scelta non cambia né il Markdown né il colore della riga misurato | non provato | effetto non misurabile dalla sonda: da verificare a vista |
| 23 | Menu del blocco → Commenta | voce «Commenta» → assente | 2885: Si apre il campo del commento sul blocco | La voce non c'è nel menu del blocco | manca nell'app | Ctrl Alt M nell'app apre il campo del commento (ultima riga della tabella) |
| 24 | Menu del blocco → Porta su una lavagna | voce «Porta su una lavagna» → (scheda) | 2888: Avviso che descrive la lavagna; non fa nulla | Non misurato: la nota della sonda non ha schede vive | non provato | richiede una scheda viva (pdf, foglio o lavagna) |
| 25 | Menu del blocco → Mostra come (scheda) | voce «Mostra come» → (scheda) | 2889–2890: Avviso che descrive; non fa nulla | Non misurato: come la riga precedente | non provato | richiede una scheda viva |
| 26 | Menu del blocco su una tabella → Trasforma in foglio | voce «Trasforma in foglio» → voce della tabella | 2886: Avviso che descrive il foglio; non fa nulla | Il menu di una tabella non ha «Trasforma in foglio»: ha Duplica, Sposta in…, Copia il link al blocco, Blocco sincronizzato ed Elimina | manca nell'app | la voce del prototipo per le tabelle non esiste nell'app |
| 27 | Menu del blocco → Duplica | voce «Duplica» → (Ctrl D) | 2892: Copia sotto il blocco | Copia sotto il blocco; il cursore va sulla copia | uguale | nel prototipo il cursore resta sull'originale |
| 28 | Menu del blocco → Sposta in… → scelta della nota | voce «Sposta in…» → nota | 2893, 2907–2910: Il blocco va in fondo alla nota; al suo posto resta un link ↗ e un avviso con «Annulla» | Si apre la scelta della nota; poi il comando di spostamento non è nell'host finto del banco | non provabile sul banco | il banco non ha il comando di spostamento della nota |
| 29 | Menu del blocco → Copia il link al blocco | voce «Copia il link al blocco» | 2894: Avviso «Copiato [[…]]», e il blocco riceve un id | Avviso «Link al blocco copiato» con un id; il testo non cambia | uguale | — |
| 30 | Menu del blocco → Blocco sincronizzato | voce «Blocco sincronizzato» | 2895: Avviso che la trasclusione è copiata; non fa nulla | Si apre la scelta della nota dove incollare il blocco | diverso | — |
| 31 | Menu del blocco → Elimina | voce «Elimina» (Canc) | 2897, 2900–2906: Il blocco va via; avviso «Eliminato» con «Annulla» | Il blocco va via; nessun avviso e nessun «Annulla» | diverso | manca un passo d'annullamento visibile |
| 32 | Menu della maniglia: freccia giù e Invio | tasti del menu | 2659–2670: Invio su «Colore» apre il sottomenu Testo e Sfondo | Stesso sottomenu Testo e Fondo | uguale | — |
| 33 | Si scrive «Elim» nel menu | campo di ricerca del menu | 2586–2680: La lista si riduce a «Elimina» | La lista si riduce a «Elimina» | uguale | — |
| 34 | Esc chiude il menu del blocco | menu del blocco | 2659–2670: Il menu si chiude | Il menu si chiude | uguale | — |
| 35 | Clic fuori dal menu del blocco | titolo della pagina / barra in alto | 4335–4337: Il menu si chiude (clic sul titolo) | Si chiude con un clic nello spazio vuoto dell'editor; con un clic sulla barra in alto resta aperto | diverso | dipende dal punto del clic |
| 36 | Si scrive «Sposta» nel menu | campo di ricerca del menu | 2893: Solo «Sposta in…» | «Sposta in…», «Sposta su» e «Sposta giù» (con Ctrl Maiusc ↑↓) | diverso | voci in più dell'app |
| 37 | Due blocchi selezionati, poi la maniglia del primo | `#g-grip` con selezione | 2878–2899: Menu del blocco singolo (il primo) | Il menu si intitola «Blocco · 2 blocchi» e ha Trasforma in, Colore, Duplica, Sposta in… ed Elimina; mancano Copia il link al blocco e Blocco sincronizzato | diverso | il prototipo apre il menu del solo primo blocco, senza il conteggio |
| 38 | Esc nel testo di un paragrafo: il blocco si seleziona | paragrafo → blocco selezionato (`.sel`, `.cm-fub-block-selected`) | 4390–4399, 2871–2877: Il blocco è segnato come selezionato; banda «1 blocco: Paragrafo» | Il testo del blocco si seleziona e il blocco è evidenziato | diverso | nel prototipo si evidenzia il blocco, nell'app il suo testo |
| 39 | Blocco selezionato: Maiusc+freccia giù | tasti della selezione | 4412–4413: La selezione diventa di due blocchi | La selezione diventa di due blocchi | uguale | — |
| 40 | Blocco selezionato: freccia giù | tasti della selezione | 4413: La selezione passa al blocco dopo | La selezione passa al blocco dopo | uguale | — |
| 41 | Blocco selezionato: freccia su | tasti della selezione | 4413: La selezione passa al blocco prima | La selezione passa al blocco prima | uguale | — |
| 42 | Blocco selezionato: Maiusc+freccia su | tasti della selezione | 4412–4413: La selezione si allarga verso l'alto | La selezione si allarga verso l'alto | uguale | — |
| 43 | Esc con una selezione di blocchi | tasti della selezione | 4398: La selezione si toglie e il fuoco esce dal testo | La selezione si toglie; il cursore resta alla fine del blocco | uguale | cambia solo dove resta il cursore |
| 44 | Ctrl A nel testo (prima pressione) | testo del blocco | 4405–4407: Seleziona il testo del blocco | Seleziona il testo del blocco | uguale | — |
| 45 | Ctrl A nel testo (seconda pressione) | testo del blocco | 4407–4408: Seleziona tutti i blocchi (28 nella nota di prova) | Seleziona tutti i blocchi del corpo | uguale | — |
| 46 | Blocchi spenti dal menu della pagina: Ctrl A | preferenza «Blocchi: maniglie e selezione» | 4304–4306, 4311: Ctrl A prende tutto il testo della nota | Non misurato: la preferenza sta nelle impostazioni, che la sonda non apre | non provato | da provare dalle impostazioni |
| 47 | Blocco selezionato: Canc | tasti della selezione | 4415: Elimina il blocco; avviso «Eliminato» con «Annulla» | Elimina il blocco; nessun avviso | diverso | manca il passo d'annullamento visibile |
| 48 | Blocco selezionato: Backspace | tasti della selezione | 4415: Elimina il blocco; avviso «Eliminato» con «Annulla» | Elimina il blocco; nessun avviso | diverso | come la riga precedente |
| 49 | Blocco selezionato: Ctrl Maiusc+freccia giù | tasti della selezione | 4412, 2911–2916: Il blocco scende di un posto | Il blocco scende di un posto | uguale | — |
| 50 | Blocco selezionato: Ctrl Maiusc+freccia su | tasti della selezione | 4412, 2911–2916: Il blocco sale di un posto | Il blocco sale di un posto | uguale | — |
| 51 | Cursore in un paragrafo: Ctrl Maiusc+freccia giù | tasti nel blocco | 4422: Il blocco scende di un posto | Il blocco scende di un posto | uguale | — |
| 52 | Cursore in un titolo: Ctrl Maiusc+freccia su | tasti nel blocco | 4422: Il blocco sale di un posto | Il blocco sale di un posto | uguale | — |
| 53 | Blocco selezionato: Ctrl D | tasti della selezione | 4414: Copia sotto la selezione | Copia sotto la selezione | uguale | — |
| 54 | Cursore in un paragrafo: Ctrl D | tasti nel blocco | 4402–4414 (solo con selezione): Nessun effetto | Duplica il blocco e il cursore va sulla copia | diverso | nell'app Ctrl D funziona anche senza selezione |
| 55 | Blocco selezionato: Invio | tasti della selezione | 4417: Il cursore torna alla fine del testo del blocco | Il cursore torna alla fine del testo del blocco | uguale | — |
| 56 | Blocco selezionato: Ctrl C | tasti della selezione | 4418: Avviso «Copiati N blocchi come Markdown»; negli appunti non va nulla | Il Markdown del blocco va negli appunti | diverso | il prototipo mostra solo l'avviso |
| 57 | Blocco selezionato: Ctrl X | nessun gestore | —: Nessun effetto: il blocco resta | Il blocco si taglia e il Markdown va negli appunti | diverso | — |
| 58 | Clic fuori dai blocchi | titolo della pagina / barra in alto | 4339: La selezione si toglie (clic sul titolo) | Nello spazio vuoto dell'editor la selezione si toglie; sulla barra in alto resta | diverso | dipende dal punto del clic |
| 59 | Clic nel testo di un blocco selezionato | testo del blocco | 4335–4339: La selezione si toglie; il cursore va nel punto del clic | La selezione si toglie; il cursore va nel punto del clic | uguale | — |
| 60 | Maiusc+clic su un altro blocco | testo di un altro blocco | nessun gestore: Nessuna selezione fra blocchi: il cursore resta | Seleziona il testo fra i due blocchi | diverso | — |
| 61 | Invio alla fine di un paragrafo | testo del blocco | 4424–4429: Paragrafo vuoto nuovo sotto, cursore dentro | Riga vuota nuova (paragrafo), cursore dentro | uguale | — |
| 62 | Invio nel mezzo di un paragrafo | testo del blocco | 4424–4429: Il paragrafo si divide in due blocchi | Va a capo nello stesso paragrafo: nessun blocco nuovo | diverso | — |
| 63 | Invio all'inizio di un paragrafo | testo del blocco | 4424–4429: Blocco vuoto sopra, testo sotto | Riga vuota sopra, testo sotto | uguale | — |
| 64 | Invio alla fine di un elemento di elenco | elemento di elenco | 4426: Nuovo elemento di elenco vuoto | Nuovo «- » in testa | uguale | — |
| 65 | Invio su un elemento di elenco vuoto | elemento di elenco vuoto | 4427: Diventa paragrafo | Non provato: con la sonda, «/puntato» e Invio non hanno creato l'elemento; il testo è rimasto com'era | non provato | da rifare dal menu del blocco su una riga vuota: la maniglia della riga vuota non si trova con il cursore |
| 66 | Invio alla fine di un'attività | attività | 4426: Nuova attività vuota | Nuovo «- [ ] » in testa | uguale | — |
| 67 | Invio alla fine di un titolo | titolo | 4426: Nuovo paragrafo sotto | Riga vuota nuova (paragrafo) | uguale | — |
| 68 | Ctrl+Invio su un'attività | attività | 4423: La spunta si mette e l'avviso dice «Scritto: [x]» | Scrive «[x]» | uguale | il prototipo aggiunge anche la data nell'avviso |
| 69 | Maiusc+Invio nel paragrafo | testo del blocco | 4424 (non gestito): A capo nel blocco | A capo nel paragrafo | uguale | — |
| 70 | Backspace all'inizio di un paragrafo | inizio del paragrafo | 4430–4437: Il testo si unisce al blocco di testo sopra | Il testo si unisce al titolo sopra | uguale | — |
| 71 | Backspace su un paragrafo vuoto | paragrafo vuoto | 4434–4435: Il blocco va via; il cursore va in fondo al blocco sopra | La riga vuota va via; il cursore va in fondo alla riga sopra | uguale | — |
| 72 | Backspace all'inizio di un titolo | inizio del titolo | 4433: Il titolo diventa paragrafo | Via il «## » in testa: diventa paragrafo | uguale | — |
| 73 | Backspace all'inizio di un elemento di elenco | inizio dell'elemento | 4433: L'elemento diventa paragrafo | Via il «- » in testa: diventa paragrafo | uguale | — |
| 74 | Backspace al primo blocco della nota | inizio del primo blocco | 4430–4437: Nessun effetto (il primo blocco è un paragrafo) | Il titolo principale diventa paragrafo | diverso | i due primi blocchi non sono uguali: nell'app è un titolo |
| 75 | Backspace nel mezzo del testo | testo del blocco | 4430: Cancella un carattere | Cancella un carattere | uguale | — |
| 76 | Tab in un paragrafo | testo del blocco | nessun gestore: Il fuoco passa al blocco dopo; nessun rientro | Inserisce due spazi in testa al paragrafo | diverso | — |
| 77 | Tab in un elemento di elenco | elemento di elenco | nessun gestore: Il fuoco passa al blocco dopo; nessun rientro | L'elemento rientra e diventa annidato | diverso | — |
| 78 | Maiusc+Tab in un elemento di elenco | elemento di elenco | nessun gestore: Il fuoco torna al pulsante prima | Nessun cambio: è già al primo livello | diverso | — |
| 79 | Tab dentro un blocco di codice | codice | nessun gestore: Il fuoco esce dal codice; nessun rientro | Inserisce un carattere di tabulazione al cursore | diverso | il codice del prototipo nasce dal «/» (sonda) |
| 80 | Freccia giù alla fine di un blocco | testo del blocco | nessun gestore (nativo): Il cursore resta nel blocco | Il cursore passa alla riga vuota dopo | diverso | nel prototipo ogni blocco è un campo a sé; da verificare nel motore dell'app (WebKit) |
| 81 | Freccia su all'inizio di un titolo | testo del titolo | nessun gestore (nativo): Il cursore resta nel titolo | Il cursore passa alla riga vuota sopra | diverso | come la riga precedente |
| 82 | Freccia giù in un blocco su più righe | testo del blocco | nativo: Il cursore scende di una riga nello stesso blocco | Stesso comportamento | uguale | — |
| 83 | Clic dentro un paragrafo | testo del blocco | nativo: Il cursore va nel punto del clic | Stesso comportamento | uguale | — |
| 84 | Trascinare la maniglia oltre la soglia: il blocco si solleva | `#g-grip` → `.cm-fub-block-grip` | 2919–2931, 2934–2954: Il blocco si solleva e il suo posto si apre; l'etichetta dice «in «Da fare»» | Il blocco si solleva con il suo testo | uguale | l'etichetta della sezione compare solo nel prototipo |
| 85 | Trascinare un'attività in basso, oltre la seconda | maniglia dell'attività | 2967–2986: Diventa fratella: si mette dopo la seconda | Diventa figlia della seconda: annidata | diverso | — |
| 86 | Trascinare in alto, sopra la prima | maniglia dell'attività | 2967–2986: Sale sopra la prima | Sale sopra la prima | uguale | — |
| 87 | Esc durante il trascinamento | tasto Esc | 2928: Il blocco torna al suo posto | Il blocco torna al suo posto | uguale | — |
| 88 | Trascinare appena e rilasciare nello stesso posto | maniglia | 2996–3019: Nessun cambio | Nessun cambio | uguale | — |
| 89 | Trascinare fuori dalla colonna a sinistra | maniglia → fuori dalla colonna | 2970–2972: Rilascio su una riga del cassetto, se sotto il puntatore | Il punto scelto non era un bersaglio: nessun cambio | non provato | il punto non è un bersaglio nell'app; la prova sul cassetto è sotto |
| 90 | Trascinare su una nota del cassetto | riga del cassetto → nota | 2971–2972: Il blocco diventa un link ↗ nella nota, con avviso e «Annulla» | Avviso «Il blocco non si è spostato» dall'host finto del banco | non provabile sul banco | il banco non ha il comando di spostamento della nota |
| 91 | Ctrl mentre si trascina | maniglia con Ctrl | 2934–2954 (Ctrl non letto): Nessuna copia: il blocco si sposta | Nessuna copia nel testo: il blocco si sposta (la copia c'è solo verso una lavagna, non misurata) | uguale | — |
| 92 | Trascinare al bordo inferiore e aspettare | maniglia vicino al bordo | 2987–2995: La pagina scorre (954 px) e il blocco scende | La pagina scorre (671 px) e il blocco scende | uguale | la posizione d'arrivo dipende dal tempo di attesa |
| 93 | Due blocchi selezionati: si trascina la maniglia di uno | maniglia di un blocco selezionato | 2919–2931, 2934–2954: Si sposta solo il blocco preso; l'altro resta dov'era | Si spostano insieme i due blocchi selezionati | diverso | — |
| 94 | Trascinare sulla voce «In cima alla nota» della struttura | voce della struttura → `In cima` | 3004: Non provato: la struttura è un pannello a parte, che la sonda non apre | Non provato: l'app ha bersagli «In fondo a …» fuori colonna, non misurati | non provato | da provare con il pannello della struttura |
| 95 | Ctrl Alt 0 su un titolo | tasti nel blocco | 4403: Il titolo diventa testo | Il titolo diventa testo | uguale | — |
| 96 | Ctrl Alt 1 su un paragrafo | tasti nel blocco | 4403 (la cifra 1 dà h2): Diventa titolo 2 | Diventa titolo 1 | diverso | nel prototipo la cifra 1 e la 2 danno lo stesso tipo |
| 97 | Ctrl Alt 2 su un paragrafo | tasti nel blocco | 4403: Diventa titolo 2 | Diventa titolo 2 | uguale | — |
| 98 | Ctrl Alt 3 su un paragrafo | tasti nel blocco | 4403: Diventa titolo 3 | Diventa titolo 3 | uguale | — |
| 99 | Ctrl Alt 4 su un paragrafo | tasti nel blocco | 4403: Diventa elenco di attività | Diventa elenco di attività | uguale | — |
| 100 | Ctrl Alt 5 su un paragrafo | tasti nel blocco | 4403: Diventa elenco puntato | Diventa elenco puntato | uguale | — |
| 101 | Ctrl Alt 7 su un paragrafo | tasti nel blocco | 4403: Diventa ripiegabile | Diventa ripiegabile | uguale | — |
| 102 | Ctrl Alt M nel testo di un paragrafo: commento | tasti nel blocco | 4402: Si apre il campo del commento sul blocco | Si apre il campo del commento | uguale | — |

## Riepilogo

- Uguali: 59.
- Diversi: 31.
- Mancano nell'app: 3.
- Non provabili sul banco: 2.
- Non provati: 7 (con il motivo nella riga).
- Totale: 102 gesti.

## I cinque più visibili

1. **«Commenta» manca nel menu del blocco.** Il prototipo apre il campo del commento dal menu; nell'app la voce non c'è. Nell'app il commento si apre con Ctrl Alt M, che il prototipo ha anch'esso.
2. **Il «+» apre i comandi «/» nell'app.** Il prototipo scrive «/» come testo e non apre niente; nell'app compare il pannello dei comandi. Alt+clic per inserire sopra manca nell'app: inserisce sotto, come il clic normale.
3. **Invio nel mezzo di un paragrafo.** Nel prototipo il paragrafo si divide in due blocchi; nell'app si va a capo nello stesso paragrafo.
4. **Trascinare un'attività sotto un'altra.** Nel prototipo diventa il blocco successivo, allo stesso livello; nell'app diventa figlia di quella sopra, annidata.
5. **Eliminare un blocco senza un passo visibile per annullare.** Nel prototipo l'avviso «Eliminato» ha «Annulla»; nell'app il blocco sparisce senza avviso.

## Da provare nel passo successivo

- L'effetto del colore sul testo (menu del blocco, Colore).
- Le voci del menu delle schede vive: «Porta su una lavagna» e «Mostra come».
- Il trascinamento verso la voce «In cima alla nota» della struttura.
- La preferenza «Blocchi: maniglie e selezione» nelle impostazioni, con Ctrl A.
- Il trascinamento fuori dalla colonna, su un punto che sia davvero un bersaglio.

