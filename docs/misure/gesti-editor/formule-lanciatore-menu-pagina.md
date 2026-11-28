# I gesti dell'editor: formule, lanciatore, menu contestuali, modi ed esporta PDF

Per ogni gesto della mia area: che cosa fa il prototipo approvato e che cosa fa l'app, provati con lo stesso gesto. È un inventario, non una lista di correzioni: le correzioni le faranno altri task, partendo da queste righe.

> **Risultato:** al ripasso del 2026-11-28, su 190 gesti 117 sono uguali, 45 diversi, 20 mancano nell'app, 6 non si possono provare sul banco e 2 sono fuori dal lavoro.

- **Data:** 2026-11-21.
- **Prototipo:** `PLAN-ui/editor.html` sul ramo `piano/editor-completo`, commit `c8b643653`. Il comportamento è letto dal codice dello script (il numero tra parentesi è la riga del file) e confermato con una sonda sul file.
- **App:** base `80e7c92eb` del ramo `misure/gesti-5`. I gesti sono stati fatti sul banco (l'ambiente di prova dell'app, con una nota di prova e senza un vault reale): scene del banco e una sonda temporanea, poi cancellata.

## Ripasso del 2026-11-28

- **App:** ramo `misure/gesti-ripasso`, che parte da `ebd0e4be2` (`integra/editor-cornice-1`). Il ripasso non cambia il codice dell'app.
- **Prototipo:** `PLAN-ui/editor.html` al commit `9a4cf1e94`. Lo script è quello del 21/11 con una riga in più prima: i numeri delle righe da 1849 in su crescono di uno.
- **Misura ridotta, decisa dall'utente.** Le sonde rifanno solo le righe diverse, mancanti o non provate il 21/11, e quelle che possono far perdere testo o lasciare bloccati. Le righe uguali il 21/11 non sono rifatte e restano uguali. Le righe che dicono «dal codice» sono decise leggendo il codice dell'app, senza la sonda.
- **Prova:** le voci stanno in `apps/client/bench/gesti/voci-formule-lanciatore-menu-pagina.mjs`. Partono da una nota della Live con formule, compito, elenco, titolo, link, commento e codice, e dalle scene del foglio, della lavagna e della Base. Il comando è `node bench/gesti/sonda.mjs --pagina=formule-lanciatore-menu-pagina` dalla cartella `apps/client`.
- **Conti:** 117 uguali, 45 diversi, 20 mancano nell'app, 6 non provabili sul banco, 2 fuori dal lavoro. Il 21/11 erano 82, 41, 14 e 5, più 48 non provati.
- **Cambiati dal 21/11:** 56 esiti.
  - Le 48 righe non provate hanno ora un esito. Quelle dello spazio «Esporta in PDF» sono decise dal codice.
  - Ora uguali: il clic su un'altra formula (F3), la lista dopo `\fr` con Esc e Tab (F18-F20), il clic fuori dal blocco (F29), il menu del modo (M1).
  - Ora presenti: la tavolozza ha il campo di ricerca (F40) e il suggerimento sulla tessera, ancora senza il comando (F39).
  - Ora fuori dal lavoro: il tasto Aiuto del binario (L3) e la riga dei tasti, che sta nella banda (L38).

## Come leggere la tabella

Esito: **uguale** (stesso risultato); **diverso** (il risultato cambia, la differenza è nella nota); **manca nell'app** (il prototipo lo ha, l'app no); **non provabile sul banco** (serve il sistema, per esempio gli appunti); **fuori dal lavoro** (fuori dal foglio della cornice: ispettore, barra del titolo, banda, binario, linguette). Il 21/11 c'era anche **non provato**: al ripasso ogni riga ha un esito. Le righe del prototipo sono quelle del commit `9a4cf1e94`.

Limiti del banco. La scrittura negli appunti è negata: le copie non si verificano. Il banco finto non dichiara alcune impostazioni (`editor.math.source`, `editor.math.help`) e il comando dei profili (`pdf.profiles`): nel banco la scelta Sì/No del LaTeX dà un errore di pagina e l'elenco dei profili non si legge. La nota di prova non ha compiti, elenchi, codice, immagini, persone né commenti: quei menu li ho letti dal codice o dalla scena del banco che li apre.

## La tabella

| n | gesto | elemento (prototipo → app) | prototipo (riga dello script) | app | esito | note |
|---|---|---|---|---|---|---|
| F1 | clic su una formula in riga, chiusa | formula in riga `.mth` → `.cm-fub-math` | apre l'editor sotto la formula, cursore in fondo (4106, 4088) | apre l'editor, cursore dopo la prima lettera («v｜=») | diverso | Il 28/11 l'editor si apre sotto la formula in un riquadro sopra la pagina; il punto del cursore non è rimisurato |
| F2 | clic su una formula a blocco, chiusa | blocco `.mblk` → `.math-block` | apre l'editor a blocco, «A blocco» premuto (4106, 4098) | apre l'editor a blocco | uguale | Dal codice: uguale il 21/11, non rifatto |
| F3 | clic su un'altra formula con una già aperta | `.mth` → `.cm-fub-math` | chiude la prima, apre la seconda (4088, 4090) | chiude la prima e apre la seconda | uguale | Il 21/11 la prima restava aperta |
| F4 | scrivere una lettera nella formula | campo visivo | la lettera entra nella formula (4028) | la lettera entra | uguale | Dal codice: uguale il 21/11, non rifatto |
| F5 | digitare `^` | campo visivo | esponente vuoto `x^{}` con cursore dentro (4040) | esponente vuoto, annuncia «esponente di x, spazio vuoto» | uguale | Dal codice: uguale il 21/11, non rifatto |
| F6 | digitare `_` | campo visivo | pedice vuoto, cursore dentro (4040) | pedice vuoto, annuncia «pedice di v, spazio vuoto» | uguale | Dal codice: uguale il 21/11, non rifatto |
| F7 | digitare `/` dopo una lettera (`a/`) | campo visivo | frazione `\frac{a}{}` (4023) | frazione `\frac{a}{}` | uguale | in entrambi la frazione prende ciò che precede la barra. Dal codice: uguale il 21/11, non rifatto |
| F8 | digitare `*` | campo visivo | `\cdot` (4041) | `\cdot` | uguale | Dal codice: uguale il 21/11, non rifatto |
| F9 | digitare `"ab"` | campo visivo | `\text{ab}` (4024) | `\text{ab}` | uguale | Dal codice: uguale il 21/11, non rifatto |
| F10 | digitare `alpha` poi lo spazio | campo visivo | nessuna conversione: lo spazio esce dall'esponente e non si scrive (4028, 4040, 4043) | converte in `\alpha` e scrive lo spazio | diverso | nel prototipo, in modo visivo, lo spazio non entra |
| F11 | digitare `->` | campo visivo | `\to` (4022) | `\to` | uguale | Dal codice: uguale il 21/11, non rifatto |
| F12 | digitare `<=` | campo visivo | `\le` (4022) | `\le` | uguale | Dal codice: uguale il 21/11, non rifatto |
| F13 | digitare `sqrt` poi lo spazio | campo visivo | nessuna radice: lo spazio non entra (4025, 4043) | `\sqrt{}` | diverso | stessa causa di F10 |
| F14 | digitare `α` | campo visivo | `\alpha ` (4019) | il carattere non entra (osservato) | diverso | Il 28/11 il carattere arriva come testo inserito, non come tasto |
| F15 | digitare `(` | campo visivo | coppia `()` con cursore dentro (4061) | coppia `()` | uguale | Dal codice: uguale il 21/11, non rifatto |
| F16 | digitare `)` con `)` già dopo il cursore | campo visivo | salta la chiusura (4061) | salta la chiusura | uguale | Dal codice: uguale il 21/11, non rifatto |
| F17 | digitare la barra inversa | campo visivo | comando in corso, mostrato come testo (4037) | comando in corso `\text{\textbackslash }` | uguale | Dal codice: uguale il 21/11, non rifatto |
| F18 | digitare `\fr`: lista dei suggerimenti | campo visivo | elenco di simboli sotto la formula (4003–4007) | elenco sotto la formula: Frazione, Derivata, Derivata parziale, Freccia a destra, Freccia a sinistra, col disegno e il nome | uguale | Prototipo: fino a cinque simboli col disegno, il nome e il comando (riga 4005) |
| F19 | Esc con `\fr` in sospeso | campo visivo | chiude la lista, il testo resta (4031, 4038) | chiude la lista, il testo «\fr» resta | uguale | Il 21/11 il messaggio prometteva «Esc lo toglie»; ora dice «fine della formula» |
| F20 | Tab con `\fr` in sospeso | campo visivo | inserisce la voce scelta (4031) | inserisce la prima voce, la frazione (`\frac{}{}`), col cursore nel numeratore | uguale | Il 21/11 la prova era su un altro modello |
| F21 | Invio in una formula in riga | campo visivo | chiude e conferma (4058) | chiude e conferma se la formula è valida | uguale | con un comando sconosciuto l'app resta aperta e avvisa. Dal codice: uguale il 21/11, non rifatto |
| F22 | Tab nella formula | campo visivo | va al buco successivo, altrimenti chiude (4057) | dal numeratore va al denominatore | uguale | Il 28/11 dalla frazione vuota di F20 |
| F23 | Maiusc+Tab nella formula | campo visivo | va al buco precedente (4057) | dal denominatore non torna al numeratore: ciò che si scrive resta sotto | diverso | Il 28/11 dalla frazione vuota di F20 |
| F24 | frecce sinistra e destra nella formula | campo visivo | sposta fra i punti validi (4034) | sposta fra i punti validi, annunciati | uguale | Dal codice: uguale il 21/11, non rifatto |
| F25 | Home e End | campo visivo | inizio e fine della formula (4035) | inizio e fine, annunciati | uguale | Dal codice: uguale il 21/11, non rifatto |
| F26 | frecce su e giù nella formula | campo visivo | numeratore e denominatore (4036) | numeratore e denominatore, annunciati | uguale | Dal codice: uguale il 21/11, non rifatto |
| F27 | Invio in una formula a blocco | campo visivo | va a capo e allinea sul `=` (4059) | va a capo e allinea (`\begin{aligned}`), stesso avviso | uguale | Dal codice: uguale il 21/11, non rifatto |
| F28 | Ctrl+Invio o Esc in una formula a blocco | campo visivo | chiude (4058, 4060) | chiude | uguale | Dal codice: uguale il 21/11, non rifatto |
| F29 | clic fuori da una formula a blocco | blocco aperto | chiude e conferma (4100–4101) | chiude l'editor del blocco | uguale | Il 21/11 non chiudeva |
| F30 | errore LaTeX: `\alfa` | campo LaTeX → `.cm-fub-mx-error` | «Non conosco \alfa. Forse volevi \alpha?» e il pulsante «Usa \alpha» (3948, 4000) | stesso testo e stesso pulsante | uguale | testo identico. Dal codice: uguale il 21/11, non rifatto |
| F31 | clic sulla correzione | `.mx-err button` → `.cm-fub-mx-error-fix` | scrive `\alpha` (4000) | scrive `\alpha` | uguale | Dal codice: uguale il 21/11, non rifatto |
| F32 | Mostra il LaTeX: Sì | `[data-code=on]` → segmento «Sì» | mostra il campo LaTeX e un avviso (4073) | mostra il campo LaTeX | uguale | l'avviso c'è solo nel prototipo. Dal codice: uguale il 21/11, non rifatto |
| F33 | Mostra il LaTeX: No | `[data-code=off]` → segmento «No» | torna all'editor visivo (4073) | torna all'editor visivo | uguale | Dal codice: uguale il 21/11, non rifatto |
| F34 | Aiuti: Pieni, Discreti, Spenti | `[data-help]` → segmenti | cambia i suggerimenti, il menu resta aperto (4074) | cambia i suggerimenti, il menu ⋯ si chiude | diverso | Aiuti esiste solo con il LaTeX visibile, in entrambi |
| F35 | Posto: In riga, A blocco | `[data-disp]` → segmenti | passa da riga a blocco e viceversa (4075) | passa a blocco e torna in riga | uguale | Dal codice: uguale il 21/11, non rifatto |
| F36 | pulsante ⋯ della formula | `.mx-more` → `.cm-fub-mx-more` | apre le opzioni (4076) | apre le opzioni | uguale | Dal codice: uguale il 21/11, non rifatto |
| F37 | clic su «Tutti» | `.mx-all` → `.cm-fub-mx-all` | apre la tavolozza completa (4077) | apre la tavolozza (`aria-expanded`) | uguale | ricerca e categorie non provate. Dal codice: uguale il 21/11, non rifatto |
| F38 | clic su una tessera della tavolozza | `[data-sym]` → `.cm-fub-mx-tile` | inserisce il modello, `\frac{}{}` (4069–4070) | inserisce il modello («Integrale» → `\int_{}^{}`) | uguale | l'elenco delle tessere è diverso. Dal codice: uguale il 21/11, non rifatto |
| F39 | passaggio su una tessera | `.mx-tip` | nome, codice e scorciatoia («Frazione \frac{}{} veloce: a/b») (4067) | nome e scrittura veloce («Frazione · veloce: a/b»), senza il comando | diverso | Il 21/11 mancava |
| F40 | scrivere nel campo «Cerca» della tavolozza | `.mx-find input` | filtra per nome (4079) | «Tutti» apre il campo «Cerca un simbolo», che filtra per nome | uguale | Il 28/11 il campo c'è (sonda); il filtro è letto dal codice (`math/palette.ts`) |
| F41 | categorie della tavolozza completa | `[data-cat]` | filtra per gruppo (4072) | i gruppi filtrano la tavolozza completa | uguale | Dal codice (`math/palette.ts`, `pickGroup`) |
| F42 | clic sull'anteprima della formula | `[data-s]` | cursore nel punto più vicino (4081–4085) | il cursore va nel punto più vicino al clic | uguale |  |
| F43 | clic su un quadratino vuoto (LaTeX visibile) | `[data-hole]` | cursore nel buco (4071, 4082) | il clic sul buco porta il cursore nel buco, come per F42 | uguale | Dal codice e dalla riga F42: la sonda non ha raggiunto il buco |
| F44 | tasto destro su una formula | `.mth` → `.cm-fub-math` | menu: Modifica la formula, Copia il LaTeX, Porta su una riga sua (4287) | menu: Modifica, Copia come (LaTeX, immagine, equazione), Da riga a blocco | diverso | le voci sono diverse |
| F45 | «Modifica» dal menu della formula | voce del menu | apre l'editor (4287) | apre l'editor | uguale | Dal codice: uguale il 21/11, non rifatto |
| F46 | «Copia il LaTeX» dal menu | voce del menu | copia e avvisa «Copiato: …» (4287) | copia | non provabile sul banco | la copia è negata nel banco |
| F47 | «Porta su una riga sua» / «Da riga a blocco» | voce del menu | solo un avviso: la formula non cambia (4287) | la formula diventa un blocco | diverso | nel prototipo la voce non converte |
| F48 | frecce e Invio nel menu della formula | voci del menu | sposta e sceglie (2660–2675) | sposta e sceglie | uguale | Dal codice: uguale il 21/11, non rifatto |
| F49 | incollare una formula con i `$` | campo visivo | toglie i delimitatori e avvisa (4028) | non provato | non provabile sul banco | Ctrl+V vietato nelle prove |
| F50 | scrivere `$` nel testo | testo | apre la formula senza tavolozza (tour, 4759) | scrive «$» come testo | non provabile sul banco | Nel prototipo succede con «Mostra il LaTeX» accesa (riga 4759); il finto del banco non dichiara `editor.math.source` |
| L1 | clic sulla pillola «Cerca o esegui un comando» | `#pill` → `.pill` | apre lo spazio comandi con le note recenti (4343) | apre il lanciatore con le note recenti | uguale | Dal codice: uguale il 21/11, non rifatto |
| L2 | Ctrl+O | tastiera | apre lo spazio comandi (4401) | apre il lanciatore | uguale | Dal codice: uguale il 21/11, non rifatto |
| L3 | clic su «Aiuto e scorciatoie» nel binario | `[data-cmd="?"]` | apre lo spazio con l'ambito Aiuto (4344) | non provato | fuori dal lavoro | Fuori dal foglio della cornice (il binario); il 21/11 non provato |
| L4 | scrivere un nome (`gui`) | `#k-q` → `.launcher-input` | risultati in gruppi (Note, Titoli, Comandi) con anteprima (4179–4181) | 4 risultati, senza gruppi per tipo | uguale | l'anteprima dell'app c'è sopra i 960 px. Dal codice: uguale il 21/11, non rifatto |
| L5 | prefisso `>` | `#k-q` → `.launcher-mode` | solo i comandi (4183) | solo i comandi (107) | uguale | Dal codice: uguale il 21/11, non rifatto |
| L6 | prefisso `#` |  | etichette con conteggio (4184) | etichette con conteggio | uguale | Dal codice: uguale il 21/11, non rifatto |
| L7 | prefisso `@` |  | persone e giorni (4185) | «Nel vault non ci sono persone.»; nessun giorno | diverso | dati di prova; i giorni non provati |
| L8 | prefisso `/` (Blocchi) |  | elenco dei blocchi: Testo, Titolo 1… (4186) | elenco dei blocchi: Titolo 1, Titolo 2, Citazione…, senza Testo in testa | diverso | Il 21/11 l'elenco era vuoto |
| L9 | prefisso `?` (Aiuto) |  | 11 scorciatoie (4187) | 45 scorciatoie | diverso |  |
| L10 | prefisso `:` (Riga) |  | non c'è (4162–4187) | modo «Riga»: numero di riga da 1 al numero delle righe | diverso | solo nell'app |
| L11 | clic su una scheda di ambito | `[data-p]` → `.launcher-mode` | cambia ambito (4223) | cambia ambito | uguale | Dal codice: uguale il 21/11, non rifatto |
| L12 | Backspace a campo vuoto | `#k-q` | torna a Tutto (4215) | torna a Tutto | uguale | Dal codice: uguale il 21/11, non rifatto |
| L13 | frecce su e giù nella lista | `#k-q` | riga attiva, con giro (4216–4217) | riga attiva | uguale | Dal codice: uguale il 21/11, non rifatto |
| L14 | Invio su una nota | `#k-q` | apre la nota nel riquadro (4218, 4212) | apre la nota nel riquadro | uguale | Dal codice: uguale il 21/11, non rifatto |
| L15 | Alt+Invio su una nota | `#k-q` | apre la sbirciata (4218) | il lanciatore si chiude e apre la sbirciata | uguale |  |
| L16 | Ctrl+Invio su una nota | `#k-q` | solo un avviso: «Apre … in un riquadro a lato» (4218, 4212) | apre la nota in un secondo riquadro a lato | diverso |  |
| L17 | Ctrl+Maiusc+Invio | `#k-q` | non previsto | sposta il fuoco sulla ricerca nel vault | diverso | solo nell'app |
| L18 | Maiusc+Invio senza risultati | `#k-q` | nessuna azione: la riga d'aiuto dice «Maiusc ↵ crea la nota» (4218) | crea la nota col nome digitato | diverso |  |
| L19 | pulsante «Crea la nota» | `.launcher-create` | non c'è | crea la nota | diverso | solo nell'app, senza risultati |
| L20 | Tab su una nota: azioni | `#k-q` | Apri qui, Apri a lato, Sbircia, Rinomina (F2), Sposta in…, Copia il link, Appunta (4219) | Apri qui, Apri a lato, Sbircia, Rinomina o sposta…, Copia il link, Appunta | diverso | in Rinomina e Sposta l'app ha una voce sola |
| L21 | Esc dalle azioni | `#k-q` | torna ai risultati (4220) | torna ai risultati | uguale | Dal codice: uguale il 21/11, non rifatto |
| L22 | clic su una riga | `[data-ix]` → `[role=option]` | esegue (4223) | esegue | uguale | Dal codice: uguale il 21/11, non rifatto |
| L23 | passaggio su una riga | `[data-ix]` | evidenzia (4224) | evidenzia | uguale | Dal codice: uguale il 21/11, non rifatto |
| L24 | Esc | tastiera | chiude (4220, 4213) | chiude | uguale | Dal codice: uguale il 21/11, non rifatto |
| L25 | pulsante Esc del campo | `[data-kx]` → `.launcher-close` | chiude (4223) | chiude | uguale | Dal codice: uguale il 21/11, non rifatto |
| L26 | clic sullo sfondo | `#veil` | chiude (4223) | chiude | uguale |  |
| L27 | nessun risultato | `.k-none` → `.launcher-note` | «Niente con «x»» e un suggerimento (4209) | «Nessuna nota per «x». Puoi crearla col nome «x»» | diverso | è il testo |
| L28 | comando «Esporta in PDF…» | voce `CMDS` | apre lo spazio «Esporta in PDF» (4166) | apre lo spazio | uguale | Dal codice: uguale il 21/11, non rifatto |
| L29 | comando «Concentrazione» | voce `CMDS` | concentrazione, avviso (4163) | concentrazione, avviso | uguale | l'avviso è diverso. Dal codice: uguale il 21/11, non rifatto |
| L30 | comando «Blocchi: maniglie e selezione» | voce `CMDS` | accende o spegne i blocchi (4165) | la prima voce è «Passa a Scrittura (era Blocchi)» | diverso | nell'ordine dei risultati |
| L31 | comandi «Passa a Lettura», «Passa a Sorgente», «Passa a Scrittura» | voci `CMDS` | cambiano modo (4164) | cambiano modo | uguale | Dal codice: uguale il 21/11, non rifatto |
| L32 | comando «Nuova nota…» | voce `CMDS` | chiede il tipo (4163, 4302) | crea subito «Senza titolo» | diverso |  |
| L33 | comando «Cronologia delle versioni» | voce `CMDS` | apre la scheda Cronologia (4167) | non c'è (la ricerca trova Indietro e Avanti) | manca nell'app |  |
| L34 | comando «Commenta la selezione» | voce `CMDS` | commento sulla selezione (4165) | non c'è | manca nell'app |  |
| L35 | comando «Copia il link alla nota» | voce `CMDS` | copia e avvisa (4167) | «Copia il link a questo punto»: la copia è negata nel banco | non provabile sul banco |  |
| L36 | comando «Cerca nel vault» | voce `CMDS` | solo un avviso (4166) | apre la ricerca nel vault | diverso |  |
| L37 | anteprima della riga attiva | `#k-prev` | a destra; nascosta a 700 px (4206) | a destra dei risultati, larga 1280 px; sotto i 960 px nascosta | uguale | A 700 px dal codice del banco |
| L38 | riga dei tasti in fondo | `#hint` | cambia con il tipo di riga (4206) | i tasti li scrive la banda; il piede del lanciatore c'è solo al telefono | fuori dal lavoro | Fuori dal foglio della cornice (la banda); il 21/11 non provato |
| C1 | tasto destro su un paragrafo | blocco testo → `.cm-line` | menu Testo: Incolla (Ctrl V), Trasforma il blocco ›, Inserisci un blocco… (/), Copia il link a questo punto (4295) | le stesse quattro voci (scena del menu del testo) | uguale | il prototipo: la sonda ha colpito un link, il menu è letto dal codice |
| C2 | Maiusc+F10 con il cursore nel blocco | tastiera | apre il menu del blocco (4390) | apre il menu del blocco («Paragrafo») | uguale |  |
| C3 | tasto destro su una selezione di parole | selezione → menu | Taglia, Copia, Incolla; Commenta (Ctrl Alt M); Collega a una nota… (Ctrl K); Copia come; Estrai in una nota nuova (4279) | Taglia, Copia, Incolla; Collega a una nota… (Ctrl K); Copia come (Markdown, HTML, testo semplice) | diverso | mancano Commenta ed Estrai in una nota nuova |
| C4 | «Copia come» → un formato | voce `menu-choice` | copia nel formato e avvisa (4280) | copia; nel banco la scrittura negli appunti è negata | non provabile sul banco |  |
| C5 | tessera Copia | `.kit-tile` | «Copiato.» (4280) | «Non riesco a scrivere negli appunti» (banco) | non provabile sul banco |  |
| C6 | frecce sinistra e destra tra le tessere | tastiera | si sposta fra le tessere (2664) | il fuoco resta sul menu (osservato) | diverso |  |
| C7 | tasto destro su un link alla nota | `.lnk[data-note]` | Apri, Apri a lato, Sbircia (Alt clic), Copia il link, Togli il link (4282) | Sbircia (Alt ↵), Apri, Apri a lato, Anteprima, Copia il link, Modifica il link…, Togli il link (scena) | diverso | nell'app anche Anteprima e Modifica il link… |
| C8 | tasto destro su un commento | `mark.cmt` | Apri la discussione, Risolvi, Copia il testo commentato (4284) | menu del paragrafo: nessun menu del commento | manca nell'app | Il menu dell'editor non ha la testata «Commento» (`catalog-it-menu.ts`) |
| C9 | tasto destro su una persona | `.pill-in[data-person]` | Apri la nota, Sbircia, Togli la menzione (4285) | menu del paragrafo: il menu della persona non c'è | manca nell'app | Il vault del banco non ha persone; il menu dell'editor non ha la testata «Persona» (dal codice) |
| C10 | tasto destro su una scadenza | `.due` | Cambia la data…, Aggiungi un promemoria…, Togli la scadenza (4286) | nessun menu della scadenza | manca nell'app | Dal codice: il menu dell'editor non ha la testata della scadenza |
| C11 | tasto destro su un valore dal foglio | `.cellv` | Apri il foglio su questa cella, Copia il valore, Ferma il valore (4288) | nessun menu del valore dal foglio | manca nell'app | Dal codice: il menu dell'editor non ha la testata del valore dal foglio |
| C12 | tasto destro su un titolo | `.blk[data-t=h2]` | Copia il link al titolo, Piega la sezione, Livello ›, Incolla, Estrai la sezione in una nota (4289) | menu Titolo 1 (scena): Copia il link al titolo, Piega la sezione, Livello ›, Incolla | diverso | manca Estrai la sezione in una nota |
| C13 | tasto destro su un compito | `.blk[data-t=task]` | Segna come fatta, Scadenza…, rientri, Tipo di elenco ›, Incolla (4290–4291) | Segna come fatta, Incolla | diverso | Mancano Scadenza…, i rientri e Tipo di elenco › |
| C14 | tasto destro su un elenco | `.blk[data-t=li]` | rientri, Tipo di elenco ›, Incolla (4290–4291) | Aumenta il rientro, Tipo di elenco ›, Incolla, Inserisci un blocco… | diverso | Nell'app anche Inserisci un blocco…; un solo rientro alla volta |
| C15 | tasto destro su un'immagine | `.blk[data-t=image]` | Apri nel visore, Copia l'immagine, Larghezza ›, Sostituisci…, Mostra nell'esploratore (4292–4293) | Apri nel visore, Copia l'immagine, Larghezza ›, Sostituisci l'immagine…, Mostra nell'esploratore, Apri con un'altra app | uguale | Dal codice (`editor_menu.image.*`); nell'app anche Apri con un'altra app |
| C16 | tasto destro su un blocco di codice | `.blk[data-t=code]` | Copia il codice, Linguaggio ›, Incolla, Togli il blocco, tieni il testo (4294) | Copia il codice, Linguaggio ›, Incolla, Togli il blocco, tieni il testo | uguale |  |
| C17 | tasto destro su una cella del foglio | `#sh-grid td` | Taglia, Copia, Incolla, Inserisci ›, Formato del numero ›, Ordina ›, Filtra, Svuota la cella, Elimina riga, Elimina colonna (4248) | Taglia, Copia, Incolla, Inserisci celle…, Elimina celle…, Cancella contenuto, Cancella ›, Filtro ›, Ordina ›, Nuovo commento, Nuova nota, Formato celle…, Definisci nome, Collegamento | diverso | Le voci sono quelle del foglio di calcolo, non quelle del prototipo |
| C18 | tasto destro su una scheda della lavagna | `.cvn` | Modifica, Colore ›, Duplica (Ctrl D), Inquadra, Elimina la scheda (4249) | Taglia, Copia, Incolla, Modifica il testo, Estrai in una nota…, Collega…, Colore ›, Disponi ›, Duplica la selezione, Copia come codice, Incolla codice, Togli… | diverso | Manca Inquadra; ci sono più voci |
| C19 | tasto destro su una riga della Base | `#base tbody tr` | Apri la nota, Sbircia, Copia il link, Copia la riga, Copia il valore, Cerca questo valore, Svuota la cella (4252) | Copia il valore, Cerca questo valore, Apri la nota, Copia il link, Copia la riga, Svuota la cella | diverso | Manca Sbircia; l'ordine cambia |
| C20 | tasto destro sulla testata della Base | `#base th` | Raggruppa per la colonna, Copia la colonna, Nuova opera, Vista ›, Esporta in CSV, Apri Opere.base (4252) | Ordina crescente e decrescente, Raggruppa, Riepilogo ›, Rinomina la proprietà…, Tipo ›, Copia la colonna, Nascondi | diverso | Mancano Nuova opera, Vista ›, Esporta in CSV, Apri Opere.base |
| C21 | tasto destro su una scheda PDF | `.scard[data-kind=pdf]` | Estrai il passo nella nota, Annota, Copia il link alla pagina, Apri in una linguetta, Mostra come ›, Togli dalla nota (4254) | nessun menu della scheda PDF | manca nell'app | Dal codice: nessuna voce «Togli dalla nota», «Mostra come», «Apri in una linguetta» |
| C22 | tasto destro su una scheda Word | `.scard[data-kind=doc]` | Modifica qui, Apri in una linguetta, Mostra come ›, Copia il link, Togli dalla nota (4255) | nessun menu della scheda Word | manca nell'app | Dal codice, come C21 |
| C23 | tasto destro su un grafico | `.scard[data-kind=chart]` | Tipo di grafico ›, Apri in una linguetta, Mostra come ›, Copia il link, Togli dalla nota (4257) | menu della tabella di dati: Inserisci, Sposta, Ordina la colonna, Allinea, Rigenera il grafico, Trasforma in foglio (scena) | diverso |  |
| C24 | tasto destro in Lettura | paragrafo in Lettura | Modifica qui (Ctrl E), Copia il link a questo punto, Copia la nota come › (4278) | Modifica qui (Ctrl E), Copia il link a questo punto, Copia la nota come › | uguale |  |
| C25 | tasto destro in Sorgente | testo in Sorgente | nessun menu (4268) | il menu del paragrafo (Incolla, Trasforma il blocco ›, Inserisci un blocco…, Copia il link a questo punto) | diverso | Il prototipo in Sorgente non ha menu |
| C26 | tasto destro nel campo della formula | `.mx` | nessun menu (4269) | nessun menu | uguale | Dal codice: uguale il 21/11, non rifatto |
| C27 | frecce, Invio ed Esc nel menu | menu | sposta, sceglie, chiude (2660–2675) | sposta, sceglie, chiude | uguale | Dal codice: uguale il 21/11, non rifatto |
| C28 | sottomenu «Trasforma il blocco ›» | menu | apre il sottomenu (2639) | apre il sottomenu (scena) | uguale | il tasto Indietro non provato. Dal codice: uguale il 21/11, non rifatto |
| C29 | scrivere per cercare altro nel menu | menu | filtra e aggiunge comandi (2672, 4262) | filtra le voci («cop» lascia Copia il link a questo punto) | uguale |  |
| C30 | clic fuori dal menu | menu | chiude (2640) | chiude | uguale |  |
| P1 | apri il menu ⋯ della pagina | `#page-menu` → «Azioni del riquadro» | sezioni Scrittura e Questa pagina, 14 voci (4346, 4309) | 9 voci: Blocchi, Concentrazione, Dividi a destra, Dividi in basso, Esporta in PDF…, Presenta come slide, Registra audio, Chiudi la scheda, Chiudi il riquadro | diverso |  |
| P2 | Blocchi: maniglie e selezione (casella) | voce del menu | commuta, il menu resta aperto (4312) | commuta, il menu si chiude | diverso |  |
| P3 | Barra di formato: Compatta, Completa, Nascosta | voce con sottomenu | tre scelte (4313) | non c'è | manca nell'app |  |
| P4 | Riga dei suggerimenti (casella) | voce del menu | commuta (4314) | non c'è | manca nell'app |  |
| P5 | Clic su un link: Apre la nota, Sbircia a lato | voce con sottomenu | sottomenu (4315) | non c'è | manca nell'app |  |
| P6 | Larghezza piena (casella) | voce del menu | commuta (4317) | non c'è | manca nell'app |  |
| P7 | Carattere: Con grazie, Senza grazie, Monospaziato | voce con sottomenu | cambia il carattere della nota (4318) | non c'è (il carattere sta nell'esportazione) | manca nell'app |  |
| P8 | Concentrazione | voce del menu | entra nella concentrazione (4319) | entra nella concentrazione | uguale | l'avviso è diverso. Dal codice: uguale il 21/11, non rifatto |
| P9 | Macchina da scrivere (casella) | voce del menu | la riga del cursore resta a metà (4320) | non c'è (sta nelle impostazioni) | manca nell'app |  |
| P10 | Copia il link alla nota | voce del menu | copia e avvisa (4322) | non c'è (nel lanciatore c'è il comando) | manca nell'app |  |
| P11 | Cronologia delle versioni | voce del menu | apre la scheda Cronologia (4323) | non c'è | manca nell'app |  |
| P12 | Esporta in PDF… | voce del menu | apre lo spazio (4324) | apre lo spazio | uguale | Dal codice: uguale il 21/11, non rifatto |
| P13 | Esporta… (HTML, Markdown) | voce del menu | solo un avviso (4325) | non c'è | manca nell'app |  |
| P14 | Esc chiude il menu | tastiera | chiude (4388) | chiude | uguale | Dal codice: uguale il 21/11, non rifatto |
| M1 | clic sul pulsante del modo | `#modeb` → `.pane-mode-current` | menu Scrittura, Sorgente, Lettura (4345) | menu Scrittura, Sorgente, Lettura (dalla voce della banda) | uguale | Il 21/11 la lista era vuota nella scena |
| M2 | scegliere Lettura | voce del menu | modo Lettura, testo non modificabile (4345) | Ctrl+E e il comando «Passa a Lettura» portano in Lettura | uguale | con i gesti alternativi. Dal codice: uguale il 21/11, non rifatto |
| M3 | scegliere Sorgente | voce del menu | mostra il Markdown del file (4345, 4112) | comando «Passa a Sorgente»: modo Sorgente | uguale | con il comando. Dal codice: uguale il 21/11, non rifatto |
| M4 | scegliere Scrittura | voce del menu | torna in Scrittura (4345) | comando «Passa a Scrittura» | uguale | con il comando. Dal codice: uguale il 21/11, non rifatto |
| M5 | Ctrl+E | tastiera | alterna Scrittura e Lettura (4402) | alterna Scrittura e Lettura | uguale | Dal codice: uguale il 21/11, non rifatto |
| M6 | scrivere in Lettura | testo | il testo non cambia (4111–4113) | il testo non cambia | uguale |  |
| M7 | «Modifica qui» dal menu in Lettura | menu | torna in Scrittura col cursore (4278) | torna in Scrittura col cursore nel paragrafo | uguale |  |
| Z1 | Concentrazione dal menu della pagina | voce del menu | nasconde il contorno, avviso, uscita (4319, 4330) | nasconde il contorno, avviso | uguale | Dal codice: uguale il 21/11, non rifatto |
| Z2 | Esc esce dalla concentrazione | tastiera | esce (4396) | esce | uguale | Dal codice: uguale il 21/11, non rifatto |
| Z3 | pulsante «Esci dalla concentrazione» | `#focus-x` | esce (4353) | esce; il fuoco torna all'editor | uguale | Dal codice: uguale il 21/11, non rifatto |
| Z4 | Concentrazione dal lanciatore | voce `CMDS` | entra (4163) | entra | uguale | Dal codice: uguale il 21/11, non rifatto |
| Z5 | Macchina da scrivere | voce del menu | riga del cursore a metà (4320) | non c'è nel menu | manca nell'app |  |
| N1 | pulsante «Nuova nota» nel cassetto | `#new-note` → «Crea un file nuovo» | menu sotto il pulsante con i tipi: Nota, Progetto, Opera, Persona, Riunione (4349, 4302) | menu «Nuovo»: Nota e Cartella; dopo «Nota», i tipi del vault: Nota, Libro, Progetto, Riunione | diverso |  |
| N2 | scegliere il tipo «Progetto» | tessera del menu | avviso, nessuna nota creata (4302) | crea «Senza titolo» | diverso |  |
| N3 | frecce nel menu dei tipi | tastiera | sposta la scelta (2664) | sposta la scelta | uguale | Invio non provato. Dal codice: uguale il 21/11, non rifatto |
| N4 | Esc chiude il menu dei tipi | tastiera | chiude (4388) | chiude e riporta il fuoco al pulsante | uguale | Dal codice: uguale il 21/11, non rifatto |
| N5 | «Nuova nota…» dal lanciatore | voce `CMDS` | menu dei tipi (4163) | crea subito «Senza titolo» | diverso |  |
| N6 | Maiusc+Invio con un nome nuovo | `#k-q` | nessuna azione (4218) | crea la nota | diverso | vedi L18 |
| E1 | «Esporta in PDF» dal menu della pagina | voce del menu | apre lo spazio: pagine e regolazioni (4324, 4651) | apre lo spazio | uguale | Dal codice: uguale il 21/11, non rifatto |
| E2 | «Esporta in PDF…» dal lanciatore | voce `CMDS` | apre lo spazio (4166) | apre lo spazio | uguale | Dal codice: uguale il 21/11, non rifatto |
| E3 | Esc chiude lo spazio | tastiera | chiude (4388) | chiude | uguale | Dal codice: uguale il 21/11, non rifatto |
| E4 | «Torna alla nota» | `#px-back` → `.export-back` | chiude (4728) | chiude | uguale | Dal codice: uguale il 21/11, non rifatto |
| E5 | pulsante «Esporta» | `#px-go` → `.export-go` | avviso «Nell'app esce «titolo.pdf», N pagine…»; non scrive (4729) | esporta davvero il PDF (scrive il file) | diverso | Dal codice: il prototipo avvisa soltanto |
| E6 | zoom − e + | `[data-zoom]` → `.export-zoom-button` | 10% per volta (4726) | 10% per volta | uguale | Dal codice: uguale il 21/11, non rifatto |
| E7 | viste Una, Due, Tutte | `[data-view]` → `.export-segment` | cambia la vista (4726) | cambia la vista | uguale | le percentuali differiscono per la misura del foglio. Dal codice: uguale il 21/11, non rifatto |
| E8 | clic su una pagina in Tutte | `.px-slot` | passa a Una e va a quella pagina (4703) | passa a Una | uguale | Dal codice: uguale il 21/11, non rifatto |
| E9 | menu dei profili | `#px-prof` → `.export-profile` | Di serie, Relazione per il Comune, Bozza…; Salva come profilo nuovo…; Torna al profilo com'era (4730) | Salva come profilo nuovo…, Salva in «Relazione», Copia il profilo…, Rinomina il profilo…, Predefinito per il vault, Torna al profilo com'era | diverso | l'elenco dei profili non si legge nel banco |
| E10 | «Salva come profilo nuovo» | voce del menu | crea «Il mio profilo» e avvisa (4730) | chiede il nome del profilo, poi lo salva | diverso | Dal codice (`export/space.ts`) |
| E11 | aprire e chiudere una sezione | `.px-sh` → `#export-section-*` | apre o chiude (4664) | apre o chiude | uguale | Dal codice: uguale il 21/11, non rifatto |
| E12 | clic su un tema | `[data-theme]` → `.export-theme` | cambia tema e impaginazione; profilo «· modificato» (4665) | cambia tema e impaginazione; profilo «· cambiato» | diverso | è solo il testo del marcatore |
| E13 | passaggio su un tema | `[data-theme]` | anteprima del tema sulle pagine (4689) | il tema si vede sulle pagine al passaggio | uguale | dal codice |
| E14 | colore: apri la riga e scegli | `[data-col]`, `[data-colset]` → `.export-color-head`, `.export-swatch` | cambia il colore, «· tuo» (4666–4667) | cambia il colore | uguale | Dal codice: uguale il 21/11, non rifatto |
| E15 | colore: codice esadecimale | `[data-colhex]` | scrive il colore se valido (4681) | campo del codice esadecimale | uguale | Dal codice (`sections/colors.ts`) |
| E16 | colore: torna al colore del tema | `[data-colreset]` | ripristina (4668) | «Torna al colore del tema» | uguale | dal codice |
| E17 | colore: selettore libero | `[data-colin]` | colore libero (4680) | selettore del colore | uguale | dal codice |
| E18 | Bianco e nero | `[data-k=bw]` → `.export-toggle` | tutto in grigio (4675) | tutto in grigio, il contrasto cambia | uguale | Dal codice: uguale il 21/11, non rifatto |
| E19 | Risparmia inchiostro | `[data-k=eco]` → `.export-toggle` | carta bianca (4675) | interruttore, i colori cambiano | uguale | Dal codice: uguale il 21/11, non rifatto |
| E20 | carattere del testo e dei titoli | `[data-k=fb]`, `[data-k=fh]` | Newsreader, Hanken, Georgia, Palatino, Plex (solo titoli) (4462, 4637) | Newsreader, Literata, Hanken, Inter, IBM | diverso | l'elenco dei caratteri è diverso |
| E21 | Corpo, Interlinea, Scala dei titoli | `input[type=range]` | cambia la misura (4683) | Corpo, Interlinea, Scala dei titoli cambiano la misura | uguale | dal codice |
| E22 | Paragrafi, Titoli, Giustificato, Sillabazione, Titoli numerati | `[data-k=par]`, `[data-k=headAlign]`, … | cambiano (4626) | cambiano | uguale | Dal codice: uguale il 21/11, non rifatto |
| E23 | formato carta: A4, A5, A3, Lettera | `[data-k=paper]` | cambia la pagina (4628) | cambia la pagina (A5: 4 pagine) | uguale | Dal codice: uguale il 21/11, non rifatto |
| E24 | verso e colonne | `[data-k=land]`, `[data-k=cols]` | cambiano pagine e zoom (4628) | cambiano pagine e zoom | uguale | Dal codice: uguale il 21/11, non rifatto |
| E25 | margini: Stretti, Normali, Larghi | `[data-margin]` | cambiano i margini (4628) | cambiano i margini | uguale | Dal codice: uguale il 21/11, non rifatto |
| E26 | margini in millimetri | `input[data-k="m.t"]` | numeri da 5 a 70 (4628) | margini da 5 a 70 mm | uguale | Dal codice (`export/guides.ts`) |
| E27 | margini a specchio | `[data-k=mirror]` | fronte e retro (4628) | Margini a specchio | uguale | dal codice |
| E28 | filigrana | `input.px-in[data-k=wm]` | scritta su ogni pagina (4628) | Filigrana su ogni pagina | uguale | dal codice |
| E29 | trascinare la guida del margine | `.px-g` | cambia il margine (4717–4724) | le guide cambiano il margine | uguale | Dal codice (`export/guides.ts`) |
| E30 | Testata e piè: scelta del posto | `[data-slot]` | apre il menu delle scelte (4671) | un clic sul posto apre il menu delle voci | uguale | Dal codice (`sections/header-footer.ts`) |
| E31 | filo sotto la testata; prima pagina senza testata | `[data-k=hfRule]`, `[data-k=hfFirst]` | cambiano (4629) | cambiano | uguale | Dal codice: uguale il 21/11, non rifatto |
| E32 | Frontespizio, Indice, profondità, Segnalibri | `[data-k=cover]`, `[data-k=toc]`, `[data-k=tocDepth]`, `[data-k=outline]` | cambiano (4630) | Frontespizio: 4 pagine; Indice: 5 pagine | uguale | i segnalibri non letti. Dal codice: uguale il 21/11, non rifatto |
| E33 | Proprietà, Commenti, Link, Compiti, Ripiegabili, Schede, Tabelle | `[data-k=props]`, … | cambiano (4631) | le scelte del contenuto cambiano le pagine | uguale | dal codice |
| E34 | righe del codice numerate | `[data-k=codeNum]` | numerate (4631) | interruttore cambia | uguale | Dal codice: uguale il 21/11, non rifatto |
| E35 | diagrammi: stile e fondo | `[data-dg]`, `[data-k=dgBg]` | cambia lo stile (4632) | stile e fondo dei diagrammi | uguale | dal codice |
| E36 | interruzioni: ogni Titolo 2, separatore, intestazione ripetuta | `[data-k=brkH2]`, `[data-k=brkRule]`, `[data-k=repeatHead]` | cambiano le pagine (4633) | 10 e 9 pagine | uguale | Dal codice: uguale il 21/11, non rifatto |
| E37 | uscita: pagine, immagini, PDF accessibile, PDF/A | `[data-k=range]`, `[data-k=img]`, `[data-k=tagged]`, `[data-k=pdfa]` | cambiano l'uscita (4634) | la sezione Uscita ha solo il riassunto: nessun controllo per pagine, immagini, PDF accessibile, PDF/A | manca nell'app | Dal codice: la sezione `uscita` non ha corpo (`sections/index.ts`) |
| E38 | clic su un blocco della pagina | `.px-it` | Comincia qui una pagina nuova, Lascia fuori dal PDF, Regola: …, Vai al blocco nella nota (4702–4714) | le stesse quattro voci | uguale | Dal codice: uguale il 21/11, non rifatto |
| E39 | clic sulla testata della pagina | `.px-hd` | apre la sezione Testata (4704) | il clic sulla testata non apre la sezione | manca nell'app | Dal codice: il clic sulle pagine sceglie solo il foglio o un blocco (`export/pages.ts`, `block-actions.ts`) |
| E40 | Esc con un menu aperto | tastiera | chiude solo il menu (4388) | chiude solo il menu, il fuoco torna al pulsante | uguale |  |

## I riassunti

| esito | 21/11 | 28/11 |
|---|---|---|
| uguale | 82 | 117 |
| diverso | 41 | 45 |
| manca nell'app | 14 | 20 |
| non provabile sul banco | 5 | 6 |
| non provato | 48 | 0 |
| fuori dal lavoro | 0 | 2 |

Le righe sono 190.

## I cinque più visibili all'utente

Al ripasso del 2026-11-28:

1. **Menu ⋯ della pagina.** Il prototipo ha Barra di formato, Riga dei suggerimenti, Larghezza piena, Carattere, Macchina da scrivere, Copia il link alla nota, Cronologia delle versioni ed Esporta… (HTML, Markdown). L'app ne ha nove, diverse (Dividi, Presenta come slide, Registra audio, Chiudi). Righe P1–P13.
2. **Menu col tasto destro che mancano.** Sul commento, sulla persona, sulla scadenza, sul valore dal foglio e sulle schede PDF e Word l'app apre il menu del paragrafo o niente. Righe C8–C11, C21, C22.
3. **Nuova nota.** Il prototipo chiede il tipo in un solo menu; l'app crea una nota «Senza titolo» dal lanciatore e chiede il tipo solo dopo «+», «Nota». Righe N1, N2, N5, L32.
4. **Uscita del PDF.** La sezione Uscita dello spazio «Esporta in PDF» non ha controlli: niente pagine da esportare, immagini, PDF accessibile o PDF/A. Riga E37.
5. **Scrivere nelle formule.** `alpha` o `sqrt` seguiti dallo spazio si convertono nell'app, non nel prototipo; `α` non entra; Maiusc+Tab non torna al buco di prima. Righe F10, F13, F14, F23.
