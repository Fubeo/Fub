# I gesti dell'editor: formule, lanciatore, menu contestuali, modi ed esporta PDF

Per ogni gesto della mia area: che cosa fa il prototipo approvato e che cosa fa l'app, provati con lo stesso gesto. È un inventario, non una lista di correzioni: le correzioni le faranno altri task, partendo da queste righe.

- **Data:** 2026-11-21.
- **Prototipo:** `PLAN-ui/editor.html` sul ramo `piano/editor-completo`, commit `c8b643653`. Il comportamento è letto dal codice dello script (il numero tra parentesi è la riga del file) e confermato con una sonda sul file.
- **App:** base `80e7c92eb` del ramo `misure/gesti-5`. I gesti sono stati fatti sul banco (l'ambiente di prova dell'app, con una nota di prova e senza un vault reale): scene del banco e una sonda temporanea, poi cancellata.

## Come leggere la tabella

Esito: **uguale** (stesso risultato); **diverso** (il risultato cambia, la differenza è nella nota); **manca nell'app** (il prototipo lo ha, l'app no); **non provabile sul banco** (serve il sistema, per esempio gli appunti); **non provato** (il gesto non è stato fatto, con il motivo nella nota).

Limiti del banco. La scrittura negli appunti è negata: le copie non si verificano. Il banco finto non dichiara alcune impostazioni (`editor.math.source`, `editor.math.help`) e il comando dei profili (`pdf.profiles`): nel banco la scelta Sì/No del LaTeX dà un errore di pagina e l'elenco dei profili non si legge. La nota di prova non ha compiti, elenchi, codice, immagini, persone né commenti: quei menu li ho letti dal codice o dalla scena del banco che li apre.

## La tabella

| n | gesto | elemento (prototipo → app) | prototipo (riga dello script) | app | esito | note |
|---|---|---|---|---|---|---|
| F1 | clic su una formula in riga, chiusa | formula in riga `.mth` → `.cm-fub-math` | apre l'editor sotto la formula, cursore in fondo (4105, 4087) | apre l'editor, cursore dopo la prima lettera («v｜=») | diverso | il cursore all'apertura è in un punto diverso |
| F2 | clic su una formula a blocco, chiusa | blocco `.mblk` → `.math-block` | apre l'editor a blocco, «A blocco» premuto (4105, 4097) | apre l'editor a blocco | uguale | |
| F3 | clic su un'altra formula con una già aperta | `.mth` → `.cm-fub-math` | chiude la prima, apre la seconda (4087, 4089) | la prima resta aperta, nessun cambio (osservato) | diverso | |
| F4 | scrivere una lettera nella formula | campo visivo | la lettera entra nella formula (4027) | la lettera entra | uguale | |
| F5 | digitare `^` | campo visivo | esponente vuoto `x^{}` con cursore dentro (4039) | esponente vuoto, annuncia «esponente di x, spazio vuoto» | uguale | |
| F6 | digitare `_` | campo visivo | pedice vuoto, cursore dentro (4039) | pedice vuoto, annuncia «pedice di v, spazio vuoto» | uguale | |
| F7 | digitare `/` dopo una lettera (`a/`) | campo visivo | frazione `\frac{a}{}` (4022) | frazione `\frac{a}{}` | uguale | in entrambi la frazione prende ciò che precede la barra |
| F8 | digitare `*` | campo visivo | `\cdot` (4040) | `\cdot` | uguale | |
| F9 | digitare `"ab"` | campo visivo | `\text{ab}` (4023) | `\text{ab}` | uguale | |
| F10 | digitare `alpha` poi lo spazio | campo visivo | nessuna conversione: lo spazio esce dall'esponente e non si scrive (4027, 4039, 4042) | converte in `\alpha` e scrive lo spazio | diverso | nel prototipo, in modo visivo, lo spazio non entra |
| F11 | digitare `->` | campo visivo | `\to` (4021) | `\to` | uguale | |
| F12 | digitare `<=` | campo visivo | `\le` (4021) | `\le` | uguale | |
| F13 | digitare `sqrt` poi lo spazio | campo visivo | nessuna radice: lo spazio non entra (4024, 4042) | `\sqrt{}` | diverso | stessa causa di F10 |
| F14 | digitare `α` | campo visivo | `\alpha ` (4018) | il carattere non entra (osservato) | diverso | |
| F15 | digitare `(` | campo visivo | coppia `()` con cursore dentro (4060) | coppia `()` | uguale | |
| F16 | digitare `)` con `)` già dopo il cursore | campo visivo | salta la chiusura (4060) | salta la chiusura | uguale | |
| F17 | digitare la barra inversa | campo visivo | comando in corso, mostrato come testo (4036) | comando in corso `\text{\textbackslash }` | uguale | |
| F18 | digitare `\fr`: lista dei suggerimenti | campo visivo | elenco di simboli sotto la formula (4002–4006) | elenco: Frazione, Derivata, Derivata parziale, Freccia a destra e a sinistra | diverso | nel prototipo la lista non è comparsa nella sonda: da verificare a mano |
| F19 | Esc con `\fr` in sospeso | campo visivo | chiude la lista, il testo resta (4030, 4037) | il testo resta; il messaggio dice «Esc lo toglie» | diverso | il messaggio dell'app promette ciò che il gesto non fa |
| F20 | Tab con `\fr` in sospeso | campo visivo | inserisce la voce scelta (4030) | inserisce un modello (`\frac{d}{dx}`) | diverso | prova su un solo caso |
| F21 | Invio in una formula in riga | campo visivo | chiude e conferma (4057) | chiude e conferma se la formula è valida | uguale | con un comando sconosciuto l'app resta aperta e avvisa |
| F22 | Tab nella formula | campo visivo | va al buco successivo, altrimenti chiude (4056) | va al denominatore | non provato | il confronto non è pulito: il punto di partenza era diverso |
| F23 | Maiusc+Tab nella formula | campo visivo | va al buco precedente (4056) | nessun effetto visibile | diverso | |
| F24 | frecce sinistra e destra nella formula | campo visivo | sposta fra i punti validi (4033) | sposta fra i punti validi, annunciati | uguale | |
| F25 | Home e End | campo visivo | inizio e fine della formula (4034) | inizio e fine, annunciati | uguale | |
| F26 | frecce su e giù nella formula | campo visivo | numeratore e denominatore (4035) | numeratore e denominatore, annunciati | uguale | |
| F27 | Invio in una formula a blocco | campo visivo | va a capo e allinea sul `=` (4058) | va a capo e allinea (`\begin{aligned}`), stesso avviso | uguale | |
| F28 | Ctrl+Invio o Esc in una formula a blocco | campo visivo | chiude (4057, 4059) | chiude | uguale | |
| F29 | clic fuori da una formula a blocco | blocco aperto | chiude e conferma (4099–4100) | non chiude (osservato una volta) | diverso | da confermare |
| F30 | errore LaTeX: `\alfa` | campo LaTeX → `.cm-fub-mx-error` | «Non conosco \alfa. Forse volevi \alpha?» e il pulsante «Usa \alpha» (3947, 3999) | stesso testo e stesso pulsante | uguale | testo identico |
| F31 | clic sulla correzione | `.mx-err button` → `.cm-fub-mx-error-fix` | scrive `\alpha` (3999) | scrive `\alpha` | uguale | |
| F32 | Mostra il LaTeX: Sì | `[data-code=on]` → segmento «Sì» | mostra il campo LaTeX e un avviso (4072) | mostra il campo LaTeX | uguale | l'avviso c'è solo nel prototipo |
| F33 | Mostra il LaTeX: No | `[data-code=off]` → segmento «No» | torna all'editor visivo (4072) | torna all'editor visivo | uguale | |
| F34 | Aiuti: Pieni, Discreti, Spenti | `[data-help]` → segmenti | cambia i suggerimenti, il menu resta aperto (4073) | cambia i suggerimenti, il menu ⋯ si chiude | diverso | Aiuti esiste solo con il LaTeX visibile, in entrambi |
| F35 | Posto: In riga, A blocco | `[data-disp]` → segmenti | passa da riga a blocco e viceversa (4074) | passa a blocco e torna in riga | uguale | |
| F36 | pulsante ⋯ della formula | `.mx-more` → `.cm-fub-mx-more` | apre le opzioni (4075) | apre le opzioni | uguale | |
| F37 | clic su «Tutti» | `.mx-all` → `.cm-fub-mx-all` | apre la tavolozza completa (4076) | apre la tavolozza (`aria-expanded`) | uguale | ricerca e categorie non provate |
| F38 | clic su una tessera della tavolozza | `[data-sym]` → `.cm-fub-mx-tile` | inserisce il modello, `\frac{}{}` (4068–4069) | inserisce il modello («Integrale» → `\int_{}^{}`) | uguale | l'elenco delle tessere è diverso |
| F39 | passaggio su una tessera | `.mx-tip` | nome, codice e scorciatoia («Frazione \frac{}{} veloce: a/b») (4066) | nessuna descrizione, solo l'etichetta accessibile | manca nell'app | |
| F40 | scrivere nel campo «Cerca» della tavolozza | `.mx-find input` | filtra per nome (4078) | campo non trovato nel banco | manca nell'app | da confermare |
| F41 | categorie della tavolozza completa | `[data-cat]` | filtra per gruppo (4071) | non provato | non provato | non eseguito: le categorie non sono state cercate nella sonda |
| F42 | clic sull'anteprima della formula | `[data-s]` | cursore nel punto più vicino (4080–4084) | non provato | non provato | non eseguito: il clic sull'anteprima non è stato provato |
| F43 | clic su un quadratino vuoto (LaTeX visibile) | `[data-hole]` | cursore nel buco (4070, 4081) | non provato | non provato | non eseguito: il clic sui buchi non è stato provato |
| F44 | tasto destro su una formula | `.mth` → `.cm-fub-math` | menu: Modifica la formula, Copia il LaTeX, Porta su una riga sua (4286) | menu: Modifica, Copia come (LaTeX, immagine, equazione), Da riga a blocco | diverso | le voci sono diverse |
| F45 | «Modifica» dal menu della formula | voce del menu | apre l'editor (4286) | apre l'editor | uguale | |
| F46 | «Copia il LaTeX» dal menu | voce del menu | copia e avvisa «Copiato: …» (4286) | copia | non provabile sul banco | la copia è negata nel banco |
| F47 | «Porta su una riga sua» / «Da riga a blocco» | voce del menu | solo un avviso: la formula non cambia (4286) | la formula diventa un blocco | diverso | nel prototipo la voce non converte |
| F48 | frecce e Invio nel menu della formula | voci del menu | sposta e sceglie (2659–2674) | sposta e sceglie | uguale | |
| F49 | incollare una formula con i `$` | campo visivo | toglie i delimitatori e avvisa (4027) | non provato | non provabile sul banco | Ctrl+V vietato nelle prove |
| F50 | scrivere `$` nel testo | testo | apre la formula senza tavolozza (tour, 4758) | non provato | non provato | non verificato in questa passata |
| L1 | clic sulla pillola «Cerca o esegui un comando» | `#pill` → `.pill` | apre lo spazio comandi con le note recenti (4342) | apre il lanciatore con le note recenti | uguale | |
| L2 | Ctrl+O | tastiera | apre lo spazio comandi (4400) | apre il lanciatore | uguale | |
| L3 | clic su «Aiuto e scorciatoie» nel binario | `[data-cmd="?"]` | apre lo spazio con l'ambito Aiuto (4343) | non provato | non provato | nel banco il tasto Aiuto apre la guida |
| L4 | scrivere un nome (`gui`) | `#k-q` → `.launcher-input` | risultati in gruppi (Note, Titoli, Comandi) con anteprima (4178–4180) | 4 risultati, senza gruppi per tipo | uguale | l'anteprima dell'app c'è sopra i 960 px |
| L5 | prefisso `>` | `#k-q` → `.launcher-mode` | solo i comandi (4182) | solo i comandi (107) | uguale | |
| L6 | prefisso `#` | | etichette con conteggio (4183) | etichette con conteggio | uguale | |
| L7 | prefisso `@` | | persone e giorni (4184) | nessuna persona nel banco | diverso | dati di prova; i giorni non provati |
| L8 | prefisso `/` (Blocchi) | | elenco dei blocchi: Testo, Titolo 1… (4185) | «Nessun blocco per «»» senza testo | diverso | |
| L9 | prefisso `?` (Aiuto) | | 11 scorciatoie (4186) | 45 scorciatoie | diverso | |
| L10 | prefisso `:` (Riga) | | non c'è (4161–4186) | modo «Riga»: numero di riga da 1 a 9 | diverso | solo nell'app |
| L11 | clic su una scheda di ambito | `[data-p]` → `.launcher-mode` | cambia ambito (4222) | cambia ambito | uguale | |
| L12 | Backspace a campo vuoto | `#k-q` | torna a Tutto (4214) | torna a Tutto | uguale | |
| L13 | frecce su e giù nella lista | `#k-q` | riga attiva, con giro (4215–4216) | riga attiva | uguale | |
| L14 | Invio su una nota | `#k-q` | apre la nota nel riquadro (4217, 4211) | apre la nota nel riquadro | uguale | |
| L15 | Alt+Invio su una nota | `#k-q` | apre la sbirciata (4217) | il lanciatore si chiude; la sbirciata non si vede nel banco | non provato | da verificare a mano |
| L16 | Ctrl+Invio su una nota | `#k-q` | solo un avviso: «Apre … in un riquadro a lato» (4217, 4211) | apre un secondo riquadro a lato | diverso | |
| L17 | Ctrl+Maiusc+Invio | `#k-q` | non previsto | sposta il fuoco sulla ricerca nel vault | diverso | solo nell'app |
| L18 | Maiusc+Invio senza risultati | `#k-q` | nessuna azione: la riga d'aiuto dice «Maiusc ↵ crea la nota» (4217) | crea la nota col nome digitato | diverso | |
| L19 | pulsante «Crea la nota» | `.launcher-create` | non c'è | crea la nota | diverso | solo nell'app, senza risultati |
| L20 | Tab su una nota: azioni | `#k-q` | Apri qui, Apri a lato, Sbircia, Rinomina (F2), Sposta in…, Copia il link, Appunta (4218) | Apri qui, Apri a lato, Sbircia, Rinomina o sposta…, Copia il link, Appunta | diverso | in Rinomina e Sposta l'app ha una voce sola |
| L21 | Esc dalle azioni | `#k-q` | torna ai risultati (4219) | torna ai risultati | uguale | |
| L22 | clic su una riga | `[data-ix]` → `[role=option]` | esegue (4222) | esegue | uguale | |
| L23 | passaggio su una riga | `[data-ix]` | evidenzia (4223) | evidenzia | uguale | |
| L24 | Esc | tastiera | chiude (4219, 4212) | chiude | uguale | |
| L25 | pulsante Esc del campo | `[data-kx]` → `.launcher-close` | chiude (4222) | chiude | uguale | |
| L26 | clic sullo sfondo | `#veil` | chiude (4222) | non provato | non provato | non eseguito in questa passata |
| L27 | nessun risultato | `.k-none` → `.launcher-note` | «Niente con «x»» e un suggerimento (4208) | «Nessuna nota per «x». Puoi crearla col nome «x»» | diverso | è il testo |
| L28 | comando «Esporta in PDF…» | voce `CMDS` | apre lo spazio «Esporta in PDF» (4165) | apre lo spazio | uguale | |
| L29 | comando «Concentrazione» | voce `CMDS` | concentrazione, avviso (4162) | concentrazione, avviso | uguale | l'avviso è diverso |
| L30 | comando «Blocchi: maniglie e selezione» | voce `CMDS` | accende o spegne i blocchi (4164) | la prima voce è «Passa a Scrittura (era Blocchi)» | diverso | nell'ordine dei risultati |
| L31 | comandi «Passa a Lettura», «Passa a Sorgente», «Passa a Scrittura» | voci `CMDS` | cambiano modo (4163) | cambiano modo | uguale | |
| L32 | comando «Nuova nota…» | voce `CMDS` | chiede il tipo (4162, 4301) | crea subito «Senza titolo» | diverso | |
| L33 | comando «Cronologia delle versioni» | voce `CMDS` | apre la scheda Cronologia (4166) | non c'è (la ricerca trova Indietro e Avanti) | manca nell'app | |
| L34 | comando «Commenta la selezione» | voce `CMDS` | commento sulla selezione (4164) | non c'è | manca nell'app | |
| L35 | comando «Copia il link alla nota» | voce `CMDS` | copia e avvisa (4166) | «Copia il link a questo punto»: la copia è negata nel banco | non provabile sul banco | |
| L36 | comando «Cerca nel vault» | voce `CMDS` | solo un avviso (4165) | apre la ricerca nel vault | diverso | |
| L37 | anteprima della riga attiva | `#k-prev` | a destra; nascosta a 700 px (4205) | non letta; sotto i 960 px nascosta, dal codice del banco | non provato | non letto dalla sonda; a 700 px lo dice il codice del banco |
| L38 | riga dei tasti in fondo | `#hint` | cambia con il tipo di riga (4205) | non letta | non provato | non letto dalla sonda |
| C1 | tasto destro su un paragrafo | blocco testo → `.cm-line` | menu Testo: Incolla (Ctrl V), Trasforma il blocco ›, Inserisci un blocco… (/), Copia il link a questo punto (4294) | le stesse quattro voci (scena del menu del testo) | uguale | il prototipo: la sonda ha colpito un link, il menu è letto dal codice |
| C2 | Maiusc+F10 con il cursore nel blocco | tastiera | apre il menu del blocco (4389) | non provato | non provato | la prova non è stata pulita |
| C3 | tasto destro su una selezione di parole | selezione → menu | Taglia, Copia, Incolla; Commenta (Ctrl Alt M); Collega a una nota… (Ctrl K); Copia come; Estrai in una nota nuova (4278) | Taglia, Copia, Incolla; Collega a una nota… (Ctrl K); Copia come (Markdown, HTML, testo semplice) | diverso | mancano Commenta ed Estrai in una nota nuova |
| C4 | «Copia come» → un formato | voce `menu-choice` | copia nel formato e avvisa (4279) | copia; nel banco la scrittura negli appunti è negata | non provabile sul banco | |
| C5 | tessera Copia | `.kit-tile` | «Copiato.» (4279) | «Non riesco a scrivere negli appunti» (banco) | non provabile sul banco | |
| C6 | frecce sinistra e destra tra le tessere | tastiera | si sposta fra le tessere (2663) | il fuoco resta sul menu (osservato) | diverso | |
| C7 | tasto destro su un link alla nota | `.lnk[data-note]` | Apri, Apri a lato, Sbircia (Alt clic), Copia il link, Togli il link (4281) | Sbircia (Alt ↵), Apri, Apri a lato, Anteprima, Copia il link, Modifica il link…, Togli il link (scena) | diverso | nell'app anche Anteprima e Modifica il link… |
| C8 | tasto destro su un commento | `mark.cmt` | Apri la discussione, Risolvi, Copia il testo commentato (4283) | non provato | non provato | nella nota di prova non c'è un commento |
| C9 | tasto destro su una persona | `.pill-in[data-person]` | Apri la nota, Sbircia, Togli la menzione (4284) | non provato | non provato | nessuna persona nella nota di prova |
| C10 | tasto destro su una scadenza | `.due` | Cambia la data…, Aggiungi un promemoria…, Togli la scadenza (4285) | non provato | non provato | nella nota di prova non è stato trovato questo elemento |
| C11 | tasto destro su un valore dal foglio | `.cellv` | Apri il foglio su questa cella, Copia il valore, Ferma il valore (4287) | non provato | non provato | la scena del banco non è stata eseguita |
| C12 | tasto destro su un titolo | `.blk[data-t=h2]` | Copia il link al titolo, Piega la sezione, Livello ›, Incolla, Estrai la sezione in una nota (4288) | menu Titolo 1 (scena): Copia il link al titolo, Piega la sezione, Livello ›, Incolla | diverso | manca Estrai la sezione in una nota |
| C13 | tasto destro su un compito | `.blk[data-t=task]` | Segna come fatta, Scadenza…, rientri, Tipo di elenco ›, Incolla (4289–4290) | non provato | non provato | nella nota di prova non ci sono compiti |
| C14 | tasto destro su un elenco | `.blk[data-t=li]` | rientri, Tipo di elenco ›, Incolla (4289–4290) | non provato | non provato | nessun elenco nella nota di prova |
| C15 | tasto destro su un'immagine | `.blk[data-t=image]` | Apri nel visore, Copia l'immagine, Larghezza ›, Sostituisci…, Mostra nell'esploratore (4291–4292) | non provato | non provato | nessuna immagine nella nota di prova |
| C16 | tasto destro su un blocco di codice | `.blk[data-t=code]` | Copia il codice, Linguaggio ›, Incolla, Togli il blocco, tieni il testo (4293) | non provato | non provato | nessun codice nella nota di prova |
| C17 | tasto destro su una cella del foglio | `#sh-grid td` | Taglia, Copia, Incolla, Inserisci ›, Formato del numero ›, Ordina ›, Filtra, Svuota la cella, Elimina riga, Elimina colonna (4247) | non provato | non provato | scena non eseguita |
| C18 | tasto destro su una scheda della lavagna | `.cvn` | Modifica, Colore ›, Duplica (Ctrl D), Inquadra, Elimina la scheda (4248) | non provato | non provato | nel banco il menu «scheda» è quello della linguetta |
| C19 | tasto destro su una riga della Base | `#base tbody tr` | Apri la nota, Sbircia, Copia il link, Copia la riga, Copia il valore, Cerca questo valore, Svuota la cella (4251) | non provato | non provato | scena della Base non eseguita in questa passata |
| C20 | tasto destro sulla testata della Base | `#base th` | Raggruppa per la colonna, Copia la colonna, Nuova opera, Vista ›, Esporta in CSV, Apri Opere.base (4251) | non provato | non provato | scena della Base non eseguita in questa passata |
| C21 | tasto destro su una scheda PDF | `.scard[data-kind=pdf]` | Estrai il passo nella nota, Annota, Copia il link alla pagina, Apri in una linguetta, Mostra come ›, Togli dalla nota (4253) | non provato | non provato | scena delle schede PDF non eseguita in questa passata |
| C22 | tasto destro su una scheda Word | `.scard[data-kind=doc]` | Modifica qui, Apri in una linguetta, Mostra come ›, Copia il link, Togli dalla nota (4254) | non provato | non provato | scena delle schede Word non eseguita in questa passata |
| C23 | tasto destro su un grafico | `.scard[data-kind=chart]` | Tipo di grafico ›, Apri in una linguetta, Mostra come ›, Copia il link, Togli dalla nota (4256) | menu della tabella di dati: Inserisci, Sposta, Ordina la colonna, Allinea, Rigenera il grafico, Trasforma in foglio (scena) | diverso | |
| C24 | tasto destro in Lettura | paragrafo in Lettura | Modifica qui (Ctrl E), Copia il link a questo punto, Copia la nota come › (4277) | non provato | non provato | non eseguito in questa passata |
| C25 | tasto destro in Sorgente | testo in Sorgente | nessun menu (4267) | non provato | non provato | nel prototipo nessun menu (sonda) |
| C26 | tasto destro nel campo della formula | `.mx` | nessun menu (4268) | nessun menu | uguale | |
| C27 | frecce, Invio ed Esc nel menu | menu | sposta, sceglie, chiude (2659–2674) | sposta, sceglie, chiude | uguale | |
| C28 | sottomenu «Trasforma il blocco ›» | menu | apre il sottomenu (2638) | apre il sottomenu (scena) | uguale | il tasto Indietro non provato |
| C29 | scrivere per cercare altro nel menu | menu | filtra e aggiunge comandi (2671, 4261) | non provato | non provato | non eseguito in questa passata |
| C30 | clic fuori dal menu | menu | chiude (2639) | non provato | non provato | non eseguito in questa passata |
| P1 | apri il menu ⋯ della pagina | `#page-menu` → «Azioni del riquadro» | sezioni Scrittura e Questa pagina, 14 voci (4345, 4308) | 9 voci: Blocchi, Concentrazione, Dividi a destra, Dividi in basso, Esporta in PDF…, Presenta come slide, Registra audio, Chiudi la scheda, Chiudi il riquadro | diverso | |
| P2 | Blocchi: maniglie e selezione (casella) | voce del menu | commuta, il menu resta aperto (4311) | commuta, il menu si chiude | diverso | |
| P3 | Barra di formato: Compatta, Completa, Nascosta | voce con sottomenu | tre scelte (4312) | non c'è | manca nell'app | |
| P4 | Riga dei suggerimenti (casella) | voce del menu | commuta (4313) | non c'è | manca nell'app | |
| P5 | Clic su un link: Apre la nota, Sbircia a lato | voce con sottomenu | sottomenu (4314) | non c'è | manca nell'app | |
| P6 | Larghezza piena (casella) | voce del menu | commuta (4316) | non c'è | manca nell'app | |
| P7 | Carattere: Con grazie, Senza grazie, Monospaziato | voce con sottomenu | cambia il carattere della nota (4317) | non c'è (il carattere sta nell'esportazione) | manca nell'app | |
| P8 | Concentrazione | voce del menu | entra nella concentrazione (4318) | entra nella concentrazione | uguale | l'avviso è diverso |
| P9 | Macchina da scrivere (casella) | voce del menu | la riga del cursore resta a metà (4319) | non c'è (sta nelle impostazioni) | manca nell'app | |
| P10 | Copia il link alla nota | voce del menu | copia e avvisa (4321) | non c'è (nel lanciatore c'è il comando) | manca nell'app | |
| P11 | Cronologia delle versioni | voce del menu | apre la scheda Cronologia (4322) | non c'è | manca nell'app | |
| P12 | Esporta in PDF… | voce del menu | apre lo spazio (4323) | apre lo spazio | uguale | |
| P13 | Esporta… (HTML, Markdown) | voce del menu | solo un avviso (4324) | non c'è | manca nell'app | |
| P14 | Esc chiude il menu | tastiera | chiude (4387) | chiude | uguale | |
| M1 | clic sul pulsante del modo | `#modeb` → `.pane-mode-current` | menu Scrittura, Sorgente, Lettura (4344) | il menu non si apre: la lista dei modi è vuota nella scena | diverso | il codice esce se i modi sono meno di due |
| M2 | scegliere Lettura | voce del menu | modo Lettura, testo non modificabile (4344) | Ctrl+E e il comando «Passa a Lettura» portano in Lettura | uguale | con i gesti alternativi |
| M3 | scegliere Sorgente | voce del menu | mostra il Markdown del file (4344, 4111) | comando «Passa a Sorgente»: modo Sorgente | uguale | con il comando |
| M4 | scegliere Scrittura | voce del menu | torna in Scrittura (4344) | comando «Passa a Scrittura» | uguale | con il comando |
| M5 | Ctrl+E | tastiera | alterna Scrittura e Lettura (4401) | alterna Scrittura e Lettura | uguale | |
| M6 | scrivere in Lettura | testo | il testo non cambia (4110–4112) | non provato | non provato | la sonda non è riuscita a scrivere in Lettura |
| M7 | «Modifica qui» dal menu in Lettura | menu | torna in Scrittura col cursore (4277) | non provato | non provato | non eseguito in questa passata |
| Z1 | Concentrazione dal menu della pagina | voce del menu | nasconde il contorno, avviso, uscita (4318, 4329) | nasconde il contorno, avviso | uguale | |
| Z2 | Esc esce dalla concentrazione | tastiera | esce (4395) | esce | uguale | |
| Z3 | pulsante «Esci dalla concentrazione» | `#focus-x` | esce (4352) | esce; il fuoco torna all'editor | uguale | |
| Z4 | Concentrazione dal lanciatore | voce `CMDS` | entra (4162) | entra | uguale | |
| Z5 | Macchina da scrivere | voce del menu | riga del cursore a metà (4319) | non c'è nel menu | manca nell'app | |
| N1 | pulsante «Nuova nota» nel cassetto | `#new-note` → «Crea un file nuovo» | menu sotto il pulsante con i tipi: Nota, Progetto, Opera, Persona, Riunione (4348, 4301) | menu «Nuovo»: Nota e Cartella; dopo «Nota», i tipi del vault: Nota, Libro, Progetto, Riunione | diverso | |
| N2 | scegliere il tipo «Progetto» | tessera del menu | avviso, nessuna nota creata (4301) | crea «Senza titolo» | diverso | |
| N3 | frecce nel menu dei tipi | tastiera | sposta la scelta (2663) | sposta la scelta | uguale | Invio non provato |
| N4 | Esc chiude il menu dei tipi | tastiera | chiude (4387) | chiude e riporta il fuoco al pulsante | uguale | |
| N5 | «Nuova nota…» dal lanciatore | voce `CMDS` | menu dei tipi (4162) | crea subito «Senza titolo» | diverso | |
| N6 | Maiusc+Invio con un nome nuovo | `#k-q` | nessuna azione (4217) | crea la nota | diverso | vedi L18 |
| E1 | «Esporta in PDF» dal menu della pagina | voce del menu | apre lo spazio: pagine e regolazioni (4323, 4650) | apre lo spazio | uguale | |
| E2 | «Esporta in PDF…» dal lanciatore | voce `CMDS` | apre lo spazio (4165) | apre lo spazio | uguale | |
| E3 | Esc chiude lo spazio | tastiera | chiude (4387) | chiude | uguale | |
| E4 | «Torna alla nota» | `#px-back` → `.export-back` | chiude (4727) | chiude | uguale | |
| E5 | pulsante «Esporta» | `#px-go` → `.export-go` | avviso «Nell'app esce «titolo.pdf», N pagine…»; non scrive (4728) | nessun avviso né chiusura nel banco | non provato | l'esito reale non si verifica con il banco finto |
| E6 | zoom − e + | `[data-zoom]` → `.export-zoom-button` | 10% per volta (4725) | 10% per volta | uguale | |
| E7 | viste Una, Due, Tutte | `[data-view]` → `.export-segment` | cambia la vista (4725) | cambia la vista | uguale | le percentuali differiscono per la misura del foglio |
| E8 | clic su una pagina in Tutte | `.px-slot` | passa a Una e va a quella pagina (4702) | passa a Una | uguale | |
| E9 | menu dei profili | `#px-prof` → `.export-profile` | Di serie, Relazione per il Comune, Bozza…; Salva come profilo nuovo…; Torna al profilo com'era (4729) | Salva come profilo nuovo…, Salva in «Relazione», Copia il profilo…, Rinomina il profilo…, Predefinito per il vault, Torna al profilo com'era | diverso | l'elenco dei profili non si legge nel banco |
| E10 | «Salva come profilo nuovo» | voce del menu | crea «Il mio profilo» e avvisa (4729) | non provato | non provato | non eseguito in questa passata |
| E11 | aprire e chiudere una sezione | `.px-sh` → `#export-section-*` | apre o chiude (4663) | apre o chiude | uguale | |
| E12 | clic su un tema | `[data-theme]` → `.export-theme` | cambia tema e impaginazione; profilo «· modificato» (4664) | cambia tema e impaginazione; profilo «· cambiato» | diverso | è solo il testo del marcatore |
| E13 | passaggio su un tema | `[data-theme]` | anteprima del tema sulle pagine (4688) | non provato | non provato | l'anteprima del tema si vede al passaggio del mouse: non letta |
| E14 | colore: apri la riga e scegli | `[data-col]`, `[data-colset]` → `.export-color-head`, `.export-swatch` | cambia il colore, «· tuo» (4665–4666) | cambia il colore | uguale | |
| E15 | colore: codice esadecimale | `[data-colhex]` | scrive il colore se valido (4680) | non provato | non provato | campo non trovato dalla sonda |
| E16 | colore: torna al colore del tema | `[data-colreset]` | ripristina (4667) | non provato | non provato | non eseguito in questa passata (campo del colore) |
| E17 | colore: selettore libero | `[data-colin]` | colore libero (4679) | non provato | non provato | non eseguito in questa passata (selettore del colore) |
| E18 | Bianco e nero | `[data-k=bw]` → `.export-toggle` | tutto in grigio (4674) | tutto in grigio, il contrasto cambia | uguale | |
| E19 | Risparmia inchiostro | `[data-k=eco]` → `.export-toggle` | carta bianca (4674) | interruttore, i colori cambiano | uguale | |
| E20 | carattere del testo e dei titoli | `[data-k=fb]`, `[data-k=fh]` | Newsreader, Hanken, Georgia, Palatino, Plex (solo titoli) (4461, 4636) | Newsreader, Literata, Hanken, Inter, IBM | diverso | l'elenco dei caratteri è diverso |
| E21 | Corpo, Interlinea, Scala dei titoli | `input[type=range]` | cambia la misura (4682) | il controllo c'è; effetto non letto | non provato | il controllo c'è; l'effetto non è stato letto |
| E22 | Paragrafi, Titoli, Giustificato, Sillabazione, Titoli numerati | `[data-k=par]`, `[data-k=headAlign]`, … | cambiano (4625) | cambiano | uguale | |
| E23 | formato carta: A4, A5, A3, Lettera | `[data-k=paper]` | cambia la pagina (4627) | cambia la pagina (A5: 4 pagine) | uguale | |
| E24 | verso e colonne | `[data-k=land]`, `[data-k=cols]` | cambiano pagine e zoom (4627) | cambiano pagine e zoom | uguale | |
| E25 | margini: Stretti, Normali, Larghi | `[data-margin]` | cambiano i margini (4627) | cambiano i margini | uguale | |
| E26 | margini in millimetri | `input[data-k="m.t"]` | numeri da 5 a 70 (4627) | campi presenti; alcuni scritti | non provato | la sonda non li ha scritti tutti |
| E27 | margini a specchio | `[data-k=mirror]` | fronte e retro (4627) | pulsante presente | non provato | effetto non letto |
| E28 | filigrana | `input.px-in[data-k=wm]` | scritta su ogni pagina (4627) | campo presente | non provato | non eseguito in questa passata |
| E29 | trascinare la guida del margine | `.px-g` | cambia il margine (4716–4723) | non provato | non provato | non eseguito in questa passata |
| E30 | Testata e piè: scelta del posto | `[data-slot]` | apre il menu delle scelte (4670) | pulsanti presenti | non provato | non eseguito: il menu dei posti non è stato letto |
| E31 | filo sotto la testata; prima pagina senza testata | `[data-k=hfRule]`, `[data-k=hfFirst]` | cambiano (4628) | cambiano | uguale | |
| E32 | Frontespizio, Indice, profondità, Segnalibri | `[data-k=cover]`, `[data-k=toc]`, `[data-k=tocDepth]`, `[data-k=outline]` | cambiano (4629) | Frontespizio: 4 pagine; Indice: 5 pagine | uguale | i segnalibri non letti |
| E33 | Proprietà, Commenti, Link, Compiti, Ripiegabili, Schede, Tabelle | `[data-k=props]`, … | cambiano (4630) | pulsanti presenti | non provato | l'effetto non si legge nel riepilogo |
| E34 | righe del codice numerate | `[data-k=codeNum]` | numerate (4630) | interruttore cambia | uguale | |
| E35 | diagrammi: stile e fondo | `[data-dg]`, `[data-k=dgBg]` | cambia lo stile (4631) | pulsanti presenti | non provato | effetto non letto |
| E36 | interruzioni: ogni Titolo 2, separatore, intestazione ripetuta | `[data-k=brkH2]`, `[data-k=brkRule]`, `[data-k=repeatHead]` | cambiano le pagine (4632) | 10 e 9 pagine | uguale | |
| E37 | uscita: pagine, immagini, PDF accessibile, PDF/A | `[data-k=range]`, `[data-k=img]`, `[data-k=tagged]`, `[data-k=pdfa]` | cambiano l'uscita (4633) | la sezione non si apre nella sonda | non provato | la sezione Uscita non si apre nella sonda |
| E38 | clic su un blocco della pagina | `.px-it` | Comincia qui una pagina nuova, Lascia fuori dal PDF, Regola: …, Vai al blocco nella nota (4701–4713) | le stesse quattro voci | uguale | |
| E39 | clic sulla testata della pagina | `.px-hd` | apre la sezione Testata (4703) | il clic non apre la sezione (selettore incerto) | non provato | il clic sulla testata non apre la sezione (selettore incerto) |
| E40 | Esc con un menu aperto | tastiera | chiude solo il menu (4387) | non provato | non provato | non eseguito in questa passata |

## I riassunti

| esito | quanti |
|---|---|
| uguale | 82 |
| diverso | 41 |
| manca nell'app | 14 |
| non provabile sul banco | 5 |
| non provato | 48 |

Le righe sono 190; le «non provato» hanno il motivo nella nota.

## I cinque più visibili all'utente

1. **Menu ⋯ della pagina.** Il prototipo ha Barra di formato, Riga dei suggerimenti, Larghezza piena, Carattere, Macchina da scrivere, Copia il link alla nota, Cronologia delle versioni ed Esporta… (HTML, Markdown). L'app ne ha nove, diverse (Dividi, Presenta come slide, Registra audio, Chiudi). Righe P1–P13.
2. **Nuova nota.** Il prototipo chiede il tipo in un solo menu; l'app crea una nota «Senza titolo» dal lanciatore e chiede il tipo solo dopo «+», «Nota». Righe N1, N2, N5.
3. **Scrivere nelle formule.** `alpha` o `sqrt` seguiti dallo spazio: nel prototipo lo spazio esce dall'esponente e non si scrive; nell'app si converte. `α` non entra nell'app. Righe F10, F13, F14.
4. **Menu della formula.** «Porta su una riga sua» nel prototipo mostra solo un avviso; nell'app «Da riga a blocco» converte. L'app ha anche «Copia come» con tre formati. Righe F44, F47.
5. **Lanciatore.** Con Ctrl+Invio il prototipo avvisa soltanto; l'app apre a lato. Maiusc+Invio nel prototipo non fa niente, nell'app crea la nota. Il `/` da solo non elenca i blocchi nell'app. Righe L8, L16, L18.

Da verificare a mano, perché il banco non li mostra: la lista di completamento dopo `\fr` nel prototipo (F18), il clic fuori da una formula a blocco (F29), la sbirciata con Alt+Invio (L15).
