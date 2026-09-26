// Le stringhe **della shell**, e come si scelgono (§12.4).
//
// La [decisione 0040](../../../docs/decisions/0192-impostazioni-locale-e-temi.md) ha deciso
// chi localizza cosa: le stringhe di un componente le porta il componente, in un
// catalogo di manifest, e le risolve il kernel sulla via d'uscita dal contratto.
// Quella regola ha ristretto questa voce invece di allargarla — i pannelli dei
// provider si traducono da soli, e questa shell non conosce le chiavi di
// nessuno — e ha lasciato scoperto esattamente ciò che la shell **scrive di
// suo**: il cestino, l'esplora, la palette, i tre pannelli di sistema, e il
// testo fermo di `index.html`.
//
// Questo file è il loro catalogo, e la shell è quindi un componente come gli
// altri: un catalogo suo, la stessa scala di ripiego, e nessun accesso a quelli
// altrui.
//
// # La scala, che è quella del contratto
//
// `it-IT` → `it` → la lingua di ripiego (`it`) → **la chiave nuda**. È la stessa
// di `Strings::template`, e lo è di proposito: due scale diverse per la stessa
// app vorrebbero dire che una stringa della shell e una di un provider possono
// cadere in due lingue diverse sullo stesso schermo.
//
// L'ultimo gradino è brutto apposta, ed è la ragione scritto nella 0040: una
// chiave mancante deve essere *visibile e cercabile*, non plausibile.
//
// # Ciò che qui si può fare e in Rust no
//
// `Key` è l'unione delle chiavi del catalogo italiano, e i cataloghi delle
// altre lingue sono `Record<Key, string>`: **una chiave dimenticata in
// inglese non compila**. In Rust la stessa promessa costa un test che cammina
// sui cataloghi (`fub-features/tests/i_cataloghi.rs`), perché lì un catalogo è
// dato di manifest e le chiavi sono `&str`. Qui il compilatore la regala, e
// vale la pena prendersela: è il tipo di errore che altrimenti si scopre da una
// segnalazione.
//
// Ciò che il compilatore **non** copre è il testo fermo di `index.html`, che
// nomina le chiavi in un attributo: quello lo presidia `strings.test.ts`,
// leggendo il file vero.
import { settings } from "../host/query";
import { onEvent } from "../state/kernel";
import { on } from "../state/store";
import type { SettingEntry } from "../host/contract";
import type { Teardown } from "../ui/lifetime";
import { setTooltip } from "../ui/tooltip";

/// Il catalogo italiano. È anche la **forma** del catalogo: le altre lingue
/// devono avere le sue chiavi, tutte, o non compilano.
const IT = { // --- la scocca ---------------------------------------------------------
"app.skip_to_editor": "Vai all'editor",
"app.open_vault": "Apri vault…",
"app.settings": "Impostazioni",
"app.settings.hint": "Le impostazioni di questo vault",
"app.close": "Chiudi",
"app.cancel": "Annulla",
"app.undo": "Annulla",
"app.unexpected": "Qualcosa non è andato a buon fine: {reason}",
"commands.failed": "«{command}» non è riuscito: {reason}",
"app.ok": "OK",
"dialog.more": "…e altre {n} non elencate",
"dialog.empty": "Nessun risultato",
"app.retry": "Riprova",
"app.run": "Esegui",
"app.dialog": "Finestra di dialogo",
"app.start_failed": "Avvio fallito: {reason}",
"app.external_changes":
  "Le modifiche fatte da altre app non verranno rilevate: chiudi e riapri il vault per rileggerlo.",
// Nomina i comandi e non li conta soltanto, come l'avviso dei conflitti: «hai
// tre scorciatoie in sospeso» manda a cercare quali.
"app.vault_keys_pending":
  "Questo vault propone {count} scorciatoie che non sono ancora attive ({commands}). Guardale nelle impostazioni, sezione Scorciatoie.",
"app.vault_keys_pending.one":
  "Questo vault propone una scorciatoia che non è ancora attiva ({commands}). Guardala nelle impostazioni, sezione Scorciatoie.",
// --- la schermata senza vault (A01): titolo, spiegazione, recenti ------
"onboarding.title": "Apri il tuo spazio di lavoro",
"onboarding.detail": "Un vault è una cartella di file sul tuo dispositivo",
"onboarding.recent": "Vault recenti",
"onboarding.create": "Crea un vault nuovo…",
"onboarding.create.title": "Scegli una cartella vuota, o creane una: diventa il tuo vault",
"onboarding.recent.forget": "Togli {name} dai recenti",
"onboarding.recent.forget.hint": "Toglie il vault dall'elenco; la cartella e le note restano dove sono",
"onboarding.trouble": "Problemi all'avvio? Diagnostica e recupero",
"onboarding.opening": "Apertura di {path}…",
"demo.title": "Vault dimostrativo",
"demo.detail": "Prova Fub in una cartella separata nella configurazione della macchina. Le modifiche restano finché non scegli di azzerarle.",
"demo.open": "Apri la demo",
"demo.opening": "Apertura della demo…",
"demo.checking": "Controllo disponibilità della demo…",
"demo.reset": "Azzera la demo",
"demo.reset_confirm": "Eliminare le modifiche fatte nella demo e ricreare le note di esempio? Nessun altro vault verrà modificato.",
"demo.reset_done": "Demo ricreata.",
"demo.close": "Chiudi la demo",
"demo.unavailable": "Demo non disponibile senza una cartella di configurazione.",
"demo.switch_blocked": "Impossibile cambiare vault finché il salvataggio o una finestra documento non è conclusa.",
"demo.unsaved": "Le modifiche in {files} non sono state salvate: resta nel vault e riprova dopo averle sistemate.",
"support.title": "Diagnostica e supporto",
"support.detail": "Controlla l'anteprima completa prima di esportare. Il rapporto include conteggi e percorsi, mai contenuto delle note o righe di log.",
"support.preview": "Mostra l'anteprima",
"support.preview_first": "Mostra e leggi l'anteprima prima di esportare.",
"support.preview_done": "Anteprima pronta: {keys} chiavi, {vaults} vault.",
"support.export": "Esporta il rapporto",
"support.export_confirm": "Hai letto l'anteprima? Esportare esattamente questo rapporto in {dest}?",
"support.export_done": "Rapporto esportato in {dest}.",
"support.working": "Caricamento…",
"support.diagnostics": "Diagnostica di avvio",
"support.no_diagnostics": "Nessuna diagnosi di avvio per il vault corrente.",
"support.no_vault": "Apri un vault per vedere la sua diagnostica di avvio.",
"recovery.title": "Configurazione di macchina",
"recovery.detail": "Controlla i file; un recupero non parte mai da solo. Un file scritto da una versione futura richiede l'aggiornamento dell'app.",
"recovery.check": "Controlla la configurazione",
"recovery.healthy": "I file presenti sono leggibili; i file assenti sono normali al primo avvio.",
"recovery.found": "Sono presenti file che richiedono attenzione.",
"recovery.unavailable": "Configurazione di macchina non disponibile.",
"recovery.ok": "Leggibile",
"recovery.missing": "Assente (normale al primo avvio)",
"recovery.unreadable": "Illeggibile: {reason}",
"recovery.future": "Versione {found}, supportata fino alla {supported}: aggiorna Fub, non azzerare questo file.",
"recovery.backup": "Crea un backup",
"recovery.reset": "Backup e ricrea vuoto",
"recovery.backup_confirm": "Creare una copia di {path} senza modificarlo?",
"recovery.reset_confirm": "Creare una copia di {path} e ricreare il file vuoto? Le impostazioni presenti non saranno più attive; potrebbe servire riavviare.",
"recovery.done": "Backup: {backup}. {restart}",
"recovery.no_backup": "nessun file precedente",
"recovery.restart": "Riavvia Fub per applicare il recupero.",
"help.not_found": "Scegli un'altra cartella o controlla che esista ancora.",
"help.already_exists": "Scegli un'altra destinazione.",
"help.conflict": "Riprova dopo aver verificato le modifiche concorrenti.",
"help.io": "Controlla lo spazio e riprova.",
"help.permission_denied": "Controlla i permessi del file o della cartella.",
"help.bad_args": "Controlla la scelta e riprova.",
"help.unknown": "Segnala l'operazione non riconosciuta.",
"help.unserved": "Questa funzione non è disponibile in questa installazione.",
"help.cancelled": "L'operazione è stata annullata; puoi riprovare.",
"help.internal": "Segnala il problema senza includere dati riservati.",
"app.menu": "Menu",
"layout.divider.sidebar": "Ridimensiona la barra laterale",
"layout.divider.inspector": "Ridimensiona l'ispettore",

// --- le regioni, che si leggono solo navigando -------------------------
"region.menu": "Menu applicazione",
"region.window_controls": "Controlli finestra",
"region.notes": "Note e ricerca",
"region.document": "Documento",
"region.bottom": "Pannelli in basso",
"region.status": "Stato dei componenti",
"region.statusbar": "Barra di stato",

// --- la titlebar custom: controlli finestra e menubar ------------------
"window.min": "Minimizza",
"window.max": "Ingrandisci",
"window.restore": "Ripristina",
"window.close": "Chiudi",
"menu.file": "File",
"menu.edit": "Modifica",
"menu.view": "Vista",
"menu.go": "Vai",
"menu.tools": "Strumenti",
"menu.file.open_vault": "Apri vault…",
"menu.edit.palette": "Palette dei comandi",
"menu.edit.doc_search": "Cerca nella nota",
"menu.view.files": "Mostra i file",
"menu.view.search": "Mostra la ricerca",
"menu.view.mode_reading": "Modalità Lettura",
"menu.view.mode_live": "Modalità Live",
"menu.view.mode_source": "Modalità Sorgente",
"menu.view.sidebar": "Mostra o nascondi la barra laterale",
"menu.view.inspector": "Mostra o nascondi l'ispettore",
"menu.view.focus": "Modalità concentrazione",
"menu.view.zoom_in": "Ingrandisci",
"menu.view.zoom_out": "Riduci",
"menu.view.zoom_reset": "Dimensione reale",
"menu.file.new_note": "Nuova nota",
"menu.file.save": "Salva",
"menu.file.reopen_tab": "Riapri la scheda chiusa",
"menu.file.close_tab": "Chiudi la scheda",
"menu.go.back": "Indietro",
"menu.go.forward": "Avanti",
"menu.go.next_tab": "Scheda successiva",
"menu.go.previous_tab": "Scheda precedente",
"menu.go.switcher": "Vai alla nota",
"menu.tools.settings": "Impostazioni",

// --- la rail: le icone a sinistra, sempre visibili ---------------------
"rail.notes": "Note",
"rail.notes.hint": "L'albero del vault",
"rail.search": "Cerca",
"rail.search.hint": "La ricerca nel vault",
"rail.manage": "Configura i pannelli laterali",
"rail.show": "Mostra {name}",
"rail.hide": "Nascondi {name}",
"rail.move_up": "Sposta {name} prima",
"rail.move_down": "Sposta {name} dopo",

// --- l'inspector: i linguetta a destra --------------------------------------
"inspector.region": "Ispettore",
"inspector.empty": "Nessuna vista da mostrare.",

"command-search.placeholder": "Cerca nel vault…",
"command-search.hint": "Cerca nel vault. Palette: Mod-Shift-P",
"region.rail": "Navigazione",

// --- le tre modalità del pannello --------------------------------------
"mode.group": "Modalità del pannello",
"mode.source": "Sorgente",
"mode.sheet": "Foglio",
"mode.live": "Live",
"mode.reading": "Lettura",
"editor.document": "Editor del documento",
"editor.task.completed": "Attività completata",
"editor.task.pending": "Attività da completare",
"grid.surface": "Foglio di calcolo",
"grid.a11y.superficie": "Foglio di calcolo",
"preview.code_block": "Blocco di codice",
"preview.copy_code": "Copia codice",
"preview.code_copied": "Codice copiato.",
"preview.copy_failed": "Non riesco a copiare il codice: {reason}",
"preview.embed_failed": "Non riesco a completare l'anteprima: {reason}",
"math.formula": "Formula matematica",
"math.loading": "Composizione della formula…",
"math.error": "Formula non disponibile: {reason}",
"math.too_large": "La formula supera il limite di {limit} caratteri.",
"viewer.unavailable": "Anteprima binaria non disponibile",
"viewer.bytes_unavailable": "Anteprima binaria non disponibile",
"surface.unavailable": "Nessuna superficie disponibile",

// --- la ricerca --------------------------------------------------------
"search.placeholder": "Cerca nel vault…",
"search.hint": "Cerca nel vault",
"search.results": "Risultati",
"search.empty": "Nessun risultato",
// Sotto il nome proposto, dove per un risultato c'è lo snippet: la riga dice
// cosa succede premendola, perché il nome da solo sembrerebbe un risultato.
"search.create": "Crea questa nota",
// Zero risultati mentre il vault sta ancora indicizzando (§15.7): la
// risposta vera è «non lo so ancora», e dirla «nessun risultato» manderebbe
// a cercare altrove chi aveva cercato bene.
"search.indexing": "Indicizzazione in corso…",
"search.count": "Risultati: {count}",
"search.unavailable": "Ricerca non disponibile",
"search.loading": "Ricerca in corso…",
"search.count_limited": "Risultati: {shown} di {total}",
"search.more": "Mostra altri ({shown} di {total})",
"search.occurrence": "Occorrenza {n}",
"search.copy_visible": "Copia risultati visualizzati",
"search.clipboard_unavailable": "Appunti non disponibili",
"search.explain": "Spiega query",
"search.exclude": "Escludi",
"search.exclude_doc": "Escludi {doc}",
"search.exclude_folder": "Escludi cartella {folder}",
"search.syntax_incomplete": "Sintassi da completare: {reason}",
"search.syntax_help": "Sintassi",
"search.exclusion_remove": "Togli l'esclusione di {name}",
"search.syntax.tag": "note con il tag (e i suoi sotto-tag)",
"search.syntax.folder": "note dentro la cartella",
"search.syntax.path": "note il cui percorso contiene il testo",
"search.syntax.file": "note il cui nome contiene il testo",
"search.syntax.heading": "testo dentro un titolo",
"search.syntax.task": "attività da fare (task:done per quelle fatte)",
"search.syntax.phrase": "le parole in quell'ordine",
"search.syntax.regex": "un'espressione regolare",
"search.syntax.property": "una proprietà del frontmatter; anche [chiave:>5]",
"search.syntax.or": "l'una o l'altra (OR maiuscolo)",
"search.syntax.not": "esclude le note con la parola",
"search.syntax.group": "raggruppa le alternative",

// --- la ricerca dentro la nota aperta (§21.4) --------------------------
// Non è il trova/sostituisci: quello è editing e cammina sulle occorrenze in
// ordine di posizione. Questa cerca dentro la nota con lo stesso motore di
// fuori, ordinata per rilevanza e con gli estratti — quindi il testo dice
// «cerca», non «trova».
"docsearch.title": "Cerca nella nota",
"docsearch.placeholder": "Cerca in questa nota…",
"docsearch.no_doc": "Nessuna nota aperta",
"commands.doc.search": "Cerca nella nota",
"commands.doc.search.desc": "Cerca dentro la nota aperta, con lo stesso motore del vault.",

// --- il quick switcher (§21.5) -----------------------------------------
//
// «Vai alla nota» e non «apri nota»: il gesto non è aprire qualcosa di nuovo,
// è **spostarsi** su una nota che di solito si sa già di avere — ed è la
// ragione per cui questa superficie si usa più della ricerca.
"switcher.title": "Vai alla nota",
"switcher.placeholder": "Vai alla nota…",
"switcher.actions_hint": "Invio: apri qui · Ctrl/⌘+Invio: dividi · Ctrl/⌘+Maiusc+Invio: nuova finestra · Alt+Invio: anteprima · Maiusc+Invio: crea con questo nome",
"switcher.actions_hint_single_window": "Invio: apri qui · Ctrl/⌘+Invio: dividi · Alt+Invio: anteprima · Maiusc+Invio: crea con questo nome",
// A mani vuote si mostrano le recenti, quindi questa riga compare solo
// quando non se ne è ancora aperta nessuna: dice cosa fare, non che non c'è
// niente.
"switcher.hint": "Scrivi il nome di una nota",
"switcher.empty": "Nessuna nota con questo nome",
// Le due righe sotto stanno nella colonna della descrizione, cioè dove per
// una nota c'è il path: dicono di che specie è la voce, perché in un elenco
// misto il nome da solo non lo direbbe.
"switcher.recent_search": "Ricerca recente",
"switcher.create": "Crea questa nota",
"commands.switcher": "Vai alla nota",
"commands.switcher.desc": "Apri una nota cercandola per nome, con lo stesso motore del vault.",
"commands.history_clear": "Cancella ricerche e note recenti",
"commands.history_clear.desc":
  "Dimentica cosa hai cercato e quali note hai aperto. Non si può annullare.",
"history.cleared": "Ricerche e note recenti cancellate",

// --- l'esplora ---------------------------------------------------------
"explorer.notes": "Note",
"explorer.notes.hint": "Note del vault",
"explorer.new": "+ Nuova",
"explorer.new.hint": "Crea una nota nuova",
"explorer.pinned": "Appuntate",
"explorer.rename": "Rinomina",
"explorer.icon": "Icona…",
"explorer.unpin": "Togli dalle appuntate",
"explorer.pin": "Appunta",
"explorer.to_folder": "Converti in cartella",
"explorer.delete": "Elimina",
"explorer.as_space": "Usa come spazio",
"explorer.move": "Sposta in…",
"explorer.move_title": "Sposta «{name}» in…",
"explorer.move_filter": "Filtra le cartelle",
"explorer.new_note_here": "Nuova nota qui",
"explorer.destination_open": "la destinazione è già aperta",
"explorer.empty": "Qui non ci sono ancora note.",
"explorer.move.hint": "Scegli la cartella di destinazione",
"explorer.not_a_space": "Togli dagli spazi",
"explorer.whole_vault": "Tutto il vault",
"explorer.new_space": "Nuovo spazio da una cartella",
"explorer.no_folders": "Nessuna cartella disponibile",
"explorer.altre_voci": "…e altre {n} qui dentro",
"explorer.altre_voci.one": "…e un'altra qui dentro",
"explorer.altre_cartelle": "…e altre {n} cartelle",
"explorer.altre_cartelle.one": "…e un'altra cartella",
"explorer.to_folder_failed": "Non riesco a convertire {doc} in cartella: {reason}",
"explorer.rename_failed": "Rinomina di {doc} in {to} rifiutata: {reason}",
"explorer.new_folder": "Nuova cartella",
"explorer.no_viewer": "Fub non ha un visualizzatore per {name}: il file resta sul disco com'è.",
"explorer.new_folder_failed": "Non riesco a creare la cartella {folder}: {reason}",
"explorer.move_failed": "Non riesco a spostare {doc} in {folder}: {reason}",
"explorer.root": "radice",

// --- i nomi che non si possono usare (§15.5) ----------------------------
// Il kernel risponde con un'**etichetta** (`NameFault::tag()`), non con una
// frase: la frase è di qui, come ogni altra frase della shell. Otto chiavi e
// non una generica, perché «nome non valido» lascia indovinare quale
// carattere, e su un titolo lungo non si indovina.
//
// La regola sta in `rules/mirrored.ts` e la applica la rinomina in posto
// *prima* del giro IPC: dire no dopo aver perso il campo di testo vuol dire
// far ridigitare il nome.
"explorer.bad_name": "«{name}» non si può usare: {reason}",
"name_fault.empty": "manca il nome",
"name_fault.traversal": "«.» e «..» non sono nomi",
"name_fault.machine": "«.fub» e «.trash» sono come il vault è fatto, non ciò che contiene",
"name_fault.control": "contiene un carattere di controllo",
"name_fault.reserved": "contiene un carattere che un filesystem si riserva (< > : \" | ? * \\)",
"name_fault.device": "è un nome che Windows si riserva (CON, NUL, COM1…)",
"name_fault.trailing_dot": "non può finire con un punto o uno spazio",
"name_fault.hidden": "non può cominciare con un punto: sarebbe una nota che il vault non elenca",
"name_fault.too_long": "è troppo lungo (il massimo è 255 byte)",

// --- ciò che è andato storto (§20.2) -----------------------------------
// Due chiavi e non una: un guasto che nomina un documento e uno che riguarda
// il vault intero si leggono diversamente, e comporre la seconda dalla prima
// con un soggetto vuoto darebbe una frase che non finisce.
"trouble.about": "{doc}: {reason}",
"trouble.vault": "{reason}",
// La porta del panico (§17.3, decisione 0161): quando il kernel sa da dove è
// entrato il guasto, l'avviso lo dice in coda. Le frasi riadattano quelle di
// `Gate::what` in crates/fub-abi/src/gate.rs, senza il dettaglio del sito.
"trouble.gate": " · da {gate}",
"gate.command": "eseguendo un comando",
"gate.view_render": "disegnando una view",
"gate.view_action": "reagendo a un'azione di una view",
"gate.service": "servendo un servizio",
"gate.event": "ricevendo un evento",
"gate.index_feed": "indicizzando un lotto di documenti",
"gate.index_forget": "togliendo un lotto di documenti",
"gate.index_up_to_date": "dicendo cosa ha già",
"gate.index_reconcile": "riconciliando",
"gate.format_parse": "parsando un documento",
"gate.syntax_rule": "innestandosi sul documento",
"gate.custom_render": "disegnando con un renderer personalizzato",
"gate.job": "eseguendo un job",
"gate.index_query": "rispondendo a una query di indice",

// --- il cestino --------------------------------------------------------
"trash.confirm_delete": "Spostare «{doc}» nel cestino?",
"trash.moved": "«{doc}» è nel cestino.",
"trash.undo_failed": "Il ripristino non è riuscito: {reason}",
"trash.delete_title": "Elimina nota",
// --- il grafo e la cronologia ------------------------------------------
"graph.count": "Grafo — Note: {note} · Collegamenti: {edges}",
"graph.a11y.superficie": "Grafo del vault: {note} note, {edges} collegamenti",
"graph.conf.titolo": "Fisica del grafo",
"graph.conf.fisica": "Simulazione",
"graph.conf.vista": "Vista",
"graph.empty": "Nessuna nota da collegare.",
"graph.list.label": "Note del grafo",
"graph.list.open": "Apri {doc}",
"graph.list.more": "…e altre {n} note",
"graph.list.empty": "Nessun nodo in questa pagina.",
"graph.status.selected": "Selezionato: {doc}",
"graph.status.none": "Nessun nodo selezionato.",
"graph.time.label": "Ultima modifica indicizzata (non cronologia dei collegamenti)",
"graph.time.all": "Tutte le date di modifica",
"graph.time.by": "Modificate entro {date}",
"graph.time.play": "Riproduci filtro per data",
"graph.toolbar": "Controlli del grafo",
"graph.local.enter": "Solo attorno a «{doc}»",
"graph.local.none": "Grafo locale: apri prima una nota",
"graph.local.leave": "Tutto il vault",
"graph.local.depth": "Profondità",
"graph.local.direction": "Collegamenti",
"graph.local.outbound": "in uscita",
"graph.local.inbound": "in entrata",
"graph.local.both": "entrambi",
"graph.group.label": "Colori per",
"graph.group.folder": "cartella",
"graph.group.tag": "tag",
"graph.group.legend": "Legenda dei colori",
"graph.filter.orphans": "Note isolate",
"graph.filter.attachments": "Allegati",
"graph.refresh": "Il vault è cambiato · Aggiorna",
"graph.list.previous": "Pagina precedente",
"graph.list.next": "Pagina successiva",
"graph.list.page": "Pagina {page} di {pages}",
"graph.time.pause": "Ferma filtro per data",
"graph.conf.preset": "Personalità",
"graph.conf.repulsione": "Repulsione",
"graph.conf.lunghezzaBase": "Lunghezza molle",
"graph.conf.rigiditaMolla": "Rigidità molle",
"graph.conf.smorzamentoMolla": "Smorzamento",
"graph.conf.gravita": "Gravità",
"graph.conf.attrito": "Attrito",
"graph.conf.maxVelocita": "Velocità massima",
"graph.conf.pesoGrado": "Peso del grado",
"graph.conf.collisioni": "Collisioni",
"graph.conf.theta": "Apertura Barnes-Hut",
"graph.conf.jitter": "Jitter iniziale",
"graph.conf.raffreddamento": "Raffreddamento",
"graph.conf.glow": "Bagliore",
"graph.conf.pulse": "Pulsazione",
"graph.conf.trail": "Scie",
"graph.conf.griglia": "Griglia",
"graph.conf.curvaturaArchi": "Curvatura archi",
"graph.conf.densitaEtichette": "Densità etichette",
"graph.conf.riscalda": "Riscalda",
"graph.conf.sblocca": "Sblocca nodi",
"graph.conf.reimposta": "Reimposta",
"graph.conf.apri": "Apri le impostazioni del grafo",
"graph.conf.chiudi": "Chiudi le impostazioni del grafo",
"graph.preset.organica": "Organica",
"graph.preset.costellazione": "Costellazione",
"graph.preset.alveare": "Alveare",
"graph.preset.nebulosa": "Nebulosa",
"graph.preset.rigido": "Rigido",
"graph.preset.custom": "Personalizzata",
"activity.title": "Attività",
"activity.hint": "I lavori in corso",
"activity.count": "Attività {count}",
"activity.none": "Nessun lavoro in corso.",
"activity.stale": "Elenco non aggiornato: {reason}",
"activity.retry": "Riprova",
"activity.status": "In corso",
"activity.progress": "{done} di {total}",
"activity.stop": "Ferma questo lavoro",
"activity.stop_failed": "Non sono riuscito a fermare «{job}»: {reason}",
"activity.finished": "«{job}» è finito.",
"activity.failed": "«{job}» non è riuscito: {reason}",
"activity.unknown_error": "Errore sconosciuto",
"notices.title": "Avvisi",
"notices.hint": "Gli avvisi recenti",
"notices.clear": "Pulisci",
"notices.clear.hint": "Dimentica gli avvisi",
"notices.count": "Avvisi {count}",
"notices.none": "Nessun avviso.",
"notices.more": "+{count} altri",
"notices.dismiss": "Chiudi l'avviso",
"notices.problem": "Problema",
"theme.rejected": "Tema «{theme}» rifiutato:",
"notices.open_problems": "Avvisi aperti: {count}",
"notices.watcher_off": "Rilevamento modifiche esterne assente: chiudi e riapri il vault per rileggere",
"notices.toast": "Avviso",

// --- le impostazioni ---------------------------------------------------
"settings.title": "Impostazioni",
"settings.tabs": "Sezioni delle impostazioni",
"settings.tab.config": "Configurazione",
"settings.tab.components": "Componenti",
"settings.tab.vaults": "Vault",
"settings.tab.shortcuts": "Scorciatoie",
"settings.group.other": "Altro",
"settings.shortcuts_hint":
  "Una riga per comando: la combinazione che lo esegue. `Mod` è Ctrl (Cmd sul Mac); si scrive come `Mod-Shift-f`. I modificatori sono tre — `Mod`, `Shift`, `Alt` — e nessun altro: un `Ctrl-k` scritto a mano non viene onorato. Una combinazione senza modificatori non viene onorata, perché ruberebbe una lettera a chi sta scrivendo. Uno spazio separa due tasti premuti uno dopo l'altro: `Mod-k d` è una scorciatoia sola.",
"settings.shortcuts.none": "Nessun comando dichiarato.",
"settings.themes.title": "Temi installati",
"settings.themes.option": "{name} · {light}",
"settings.themes.light.dark": "scuro",
"settings.themes.light.light": "chiaro",
"settings.themes.source": "Temi installati: {ids}",
"settings.themes.preview_hint":
  "Scegli un tema per provarlo senza salvare. Applica rende la scelta autorevole; Annulla ripristina il tema precedente.",
"settings.themes.apply": "Applica tema",
"settings.themes.cancel_preview": "Annulla anteprima",
"settings.themes.preview_none": "Nessuna anteprima attiva.",
"settings.themes.preview_active": "Anteprima attiva: {theme}. La scelta salvata non è cambiata.",
"settings.themes.preview_failed": "Anteprima tema non disponibile: {reason}",
// --- i tasti che il vault propone (§23.13) -----------------------------
//
// Il testo dice che **non sono attive**, e lo dice per primo: chi legge deve
// capire che non sta scegliendo se disfare qualcosa, ma se lasciarlo fare.
"settings.vault_keys.title": "Questo vault propone {count} scorciatoie",
"settings.vault_keys.hint":
  "Un vault porta con sé le proprie scorciatoie, e queste arrivano da fuori: finché non le guardi non premono niente, e valgono le combinazioni dichiarate dai comandi.",
"settings.vault_keys.adopt": "Usa quelle del vault",
"settings.vault_keys.discard": "Tieni le mie",
"settings.vault_keys.discard.hint":
  "Le toglie dal file di configurazione del vault: non restano in sospeso, e la prossima volta non te le richiede.",
"settings.shortcuts.shell":
  "I comandi di questa finestra hanno una combinazione fissa: cambiarla vuol dire dichiararli al kernel, e la shell non è ancora un componente.",
"settings.none": "Nessun componente dichiara impostazioni.",
"settings.read_failed": "Non riesco a leggere: {reason}",
"settings.components_hint":
  "Un componente spento si smonta subito e non viene più montato all'apertura del vault: non registra niente, e le sue impostazioni non compaiono.",
"settings.components.bundled": "Inclusi in Fub",
"settings.components.installed": "Installati su questa macchina",
"settings.components.installed.none": "Nessun componente installato.",
"settings.components.install": "Installa un componente",
"settings.components.install.hint":
  "Scegli un file .wasm. L'installazione non lo abilita, non concede permessi e non lo esegue.",
"settings.components.install.pick": "Scegli file…",
"settings.components.install_failed": "Componente non installato: {reason}",
"settings.components.identity": "{id} · versione {version} · {trust}",
"settings.components.runtime.mounted": "Stato runtime: in esecuzione in questo vault",
"settings.components.runtime.off": "Stato runtime: non in esecuzione",
"settings.components.enabled": "Abilitato",
"settings.components.enabled.hint":
  "Scelta persistita su questa macchina. Il componente può avviarsi soltanto se anche il consenso è concesso.",
"settings.components.enabled_failed": "Scelta di abilitazione non cambiata: {reason}",
"settings.components.consent": "Consenso all'esecuzione",
"settings.components.consent.hint":
  "È distinto dall'abilitazione: negato o da decidere impediscono sempre l'esecuzione.",
"settings.components.consent.undecided": "Da decidere",
"settings.components.consent.denied": "Negato",
"settings.components.consent.granted": "Concesso",
"settings.components.consent_failed": "Consenso non cambiato: {reason}",
"settings.components.permissions.hint":
  "Capacità dichiarate dal file. Concedere il consenso le approva insieme; un consenso negato non esegue il componente.",
"settings.components.remove": "Rimuovi",
"settings.components.remove.hint":
  "Rimuove l'installazione ma conserva i suoi dati nel vault.",
"settings.components.remove.disabled": "Disabilita il componente prima di rimuoverlo.",
"settings.components.remove.title": "Rimuovi componente",
"settings.components.remove.confirm":
  "Rimuovere «{name}»? I dati che il componente ha salvato nei vault verranno conservati.",
"settings.components.remove_failed": "Componente non rimosso: {reason}",
"settings.components.reload_failed": "Stato dei componenti non aggiornato: {reason}",

// --- i permessi, come li legge chi deve accettarli (§23.17) ------------
//
// Queste frasi le scrive la SHELL e non chi chiede il permesso, ed è la riga
// di sicurezza della voce: se venissero dal manifest — o dal catalogo di
// stringhe del componente, che è dove finirebbe un `Text` di una
// `SettingSpec` — un componente potrebbe presentare `fub:read-drafts` come
// «migliora i suggerimenti». Sono l'unico posto dell'app in cui il testo che
// protegge l'utente non deve poterlo scrivere la parte da cui lo protegge.
//
// Dicono ciò che il permesso CONSENTE, al presente e alla seconda persona:
// non «accesso al vault» ma «può leggere le tue note». Un permesso descritto
// col nome della sua capacità è un permesso che si concede senza sapere cosa
// si è concesso.
"settings.permissions": "Permessi",
"settings.permissions.hint":
  "Cosa questo componente ha dichiarato di voler fare. Toglierne uno ha effetto subito e resta anche se lo spegni e lo riaccendi; il componente potrebbe smettere di funzionare, ed è la sua parte del patto: chiedere solo ciò che gli serve.",
"settings.permissions.none": "Non chiede nessun permesso.",
"settings.permissions.off_hint": "Accendi il componente per vedere i suoi permessi in dettaglio.",
"settings.permission.grant": "Concedi «{cosa}»",
"settings.permission.denied": "Negato da te",
"settings.permission_not_changed": "Permesso non cambiato: {reason}",
"permission.read-vault": "Può leggere tutte le tue note e i file che tieni nel vault.",
"permission.write-vault":
  "Può cambiare le tue note: scriverle, crearne di nuove, rinominarle e cestinarle.",
"permission.network": "Può connettersi a internet e mandare fuori ciò che legge.",
"permission.read-clipboard":
  "Può leggere gli appunti di sistema: ciò che hai copiato da qualunque applicazione.",
"permission.write-clipboard": "Può copiare del testo negli appunti di sistema.",
"permission.camera": "Può usare la fotocamera.",
"permission.microphone": "Può usare il microfono.",
"permission.external-fs": "Può leggere e scrivere file fuori dal vault.",
"permission.run-command":
  "Può eseguire i comandi di Fub, compresi quelli che cambiano le tue note.",
"permission.call-service": "Può chiamare i servizi che gli altri componenti offrono.",
"permission.write-settings":
  "Può cambiare le impostazioni che si sono dichiarate scrivibili da un programma.",
"permission.read-session": "Può sapere quale nota stai guardando, e in che modalità.",
"permission.read-selection": "Può leggere il testo che selezioni, mentre lo selezioni.",
"permission.read-drafts": "Può leggere ciò che stai scrivendo e non hai ancora salvato.",
"permission.unknown":
  "Questa versione di Fub non conosce questo permesso: non concede niente, e non c'è niente da negare.",
// La differenza fra le due è la differenza fra un componente che parla con un
// servizio e uno che può mandare le tue note ovunque. La 0097 ha lasciato
// quella differenza fuori dal cancello apposta, delegandola «alla frase che
// l'utente legge accettando»: è questa.
"permission.network.anywhere": "verso qualunque indirizzo",
"permission.network.only": "solo verso: {hosts}",
// Di chi ci si sta fidando, che è l'altra metà della domanda: «può leggere le
// tue note» non vuol dire la stessa cosa detto di una feature di Fub e di un
// componente arrivato da fuori.
"trust.core": "Parte di Fub",
"trust.verified": "Verificato",
"trust.community": "Della comunità",
"trust.development": "In sviluppo",
"trust.revoked": "Revocato: non gira",
// Dove vive il valore di una riga, che è l'unica cosa che l'utente non può
// dedurre guardandola. Tre chiavi e non una frase composta a pezzi: «vale
// per questa macchina» e «vale per questo vault» sono la stessa frase solo
// in italiano, e comporla per concatenazione è il modo classico di renderla
// intraducibile.
"settings.scope.machine": "questa macchina",
"settings.scope.vault": "questo vault",
"settings.source.default": "valore predefinito · vale per {dove}",
"settings.source.machine": "scelto per questa macchina",
"settings.source.vault": "scelto per questo vault",
"settings.reset": "Azzera",
"settings.reset.hint": "Dimentica questa scelta: torna a valere il valore predefinito",
"settings.as_system": "Come il sistema",
"settings.components.consent.confirm_title": "Concedere i permessi",
"settings.components.consent.confirm": "{name} potrà:\n{permissions}\n\nI permessi si possono togliere uno per uno anche dopo.",
"settings.components.consent.grant": "Concedi",
"settings.components.limited_on": "Modalità limitata dei componenti: {reason}",
"settings.components.limited_default": "esecuzione sospesa",
"settings.components.limited_off": "Modalità limitata dei componenti: spenta",
"settings.components.limited_unavailable": "Stato della modalità limitata non disponibile: {reason}",
"settings.components.budget": "Risorse WASM · {live} in esecuzione · {calls} chiamate · {timeouts} scadute · {oom} senza memoria",
"settings.components.budget_unavailable": "Risorse WASM non disponibili: {reason}",
"settings.components.signed": "Firmato da {key} · generazione {generation} · editore {publisher} · licenza {license} · compatibile {compatible} · fonte {url}",
"settings.components.revoked": "Revocato: questo componente non può essere montato.",
"settings.components.revoked_signed": "Revocato: questo componente non può essere montato · firmato da {key} alla generazione {generation}.",
"settings.shortcut.empty_alternative": "un'alternativa è vuota",
"settings.shortcut.too_many": "troppe alternative",
"settings.shortcut.invalid_chord": "combinazione non riconosciuta",
"settings.shortcut.duplicate": "alternativa ripetuta",
"settings.shortcut.invalid_unsaved": "Scorciatoia non valida: {reason}. Non è stato salvato niente.",
"settings.shortcut.invalid": "Scorciatoia non valida: {binding}",
"settings.shortcut.collision": "{chord} è assegnata anche a {commands}",
"settings.shortcut.shadowed": "{command} copre {commands}",
"settings.group.reset": "Ripristina gruppo",
"settings.group.reset.hint": "Riporta ai valori predefiniti le impostazioni cambiate in «{group}»",
"settings.group.reset.confirm": "Riportare ai valori predefiniti le impostazioni cambiate in «{group}» ({count})?",
"settings.group.reset.ok": "Ripristina",
"settings.frame.unavailable": "Le cornici della finestra non sono disponibili: {reason}",
"settings.frame.reopen": "La nuova cornice vale dalla prossima apertura della finestra.",
"settings.list.none": "Nessuna cartella esclusa.",
"settings.list.placeholder": "Nome della cartella",
"settings.list.add": "Aggiungi",
"settings.list.remove": "Rimuovi",
"settings.list.remove.hint": "Rimuovi {folder} dalle cartelle escluse",
"settings.list.empty": "Scrivi il nome di una cartella.",
"settings.list.path": "Scrivi un nome di cartella, non un percorso.",
"settings.list.structural": "{folder} è una cartella strutturale e resta sempre esclusa.",
"settings.list.duplicate": "{folder} è già nell’elenco.",
"settings.off_choices": "{value} (fuori dalle scelte dichiarate)",
"settings.not_changed": "Impostazione non cambiata: {reason}",
"settings.component_not_changed": "Componente non cambiato: {reason}",
"settings.no_vaults": "Nessun vault ancora aperto da questa macchina.",
"settings.open": "Apri",
"settings.open_failed": "Vault non aperto: {reason}",
"settings.unfavourite": "Togli dai preferiti",
"settings.favourite": "Metti fra i preferiti",
"settings.forget": "Dimentica",
"settings.forget.hint": "Toglie dall'elenco: non tocca il vault sul disco",
"settings.registry_failed": "Registro dei vault: {reason}",
"settings.on": "acceso",
"settings.off": "spento",
"settings.nothing": "niente",
"settings.exported_clipboard": "Impostazioni copiate negli appunti.",
"clipboard.copied": "Testo copiato negli appunti.",
"base.lane.rename": "Rinomina la colonna",
"base.lane.taken": "Serve un nome di colonna nuovo, non vuoto e più corto di 256 caratteri",
"base.card.add": "+ Scheda",
"base.csv.copy": "Copia CSV",
"base.csv.export": "Esporta CSV",
"base.csv.copied": "CSV copiato negli appunti",
"base.map.zoom_in": "Ingrandisci la mappa",
"base.map.zoom_out": "Riduci la mappa",
"base.lane.rename_named": "Rinomina {name}",
"base.lane.add_placeholder": "+ Colonna",
"base.lane.add": "Crea una colonna",
"base.map.label": "Mappa del mondo con i segnaposto",
"base.map.tiles_failed": "Mappe online non disponibili: {reason}",
"base.map.offline": "Offline. Mappe online: {provider}",
"base.map.enable": "Attiva le mappe online",
"base.map.tiles_denied": "Mappe online non disponibili: servono il permesso di rete esplicito e un host HTTPS fidato",
"activity.artifact_invalid": "Export concluso, ma il rapporto degli artifact non è valido; nessun file salvato.",
"activity.artifact_saved": "Salvato: {path}",
"activity.artifact_delivered": "Già consegnato ({size} byte)",
"activity.artifact_saving": "Apro il dialogo di salvataggio…",
"activity.artifact_failed": "Non salvato: {reason}",
"activity.artifact_ready": "Pronto da salvare",
"activity.artifact_save": "Salva…",
"activity.artifact_cancelled": "Salvataggio annullato; i byte sono ancora disponibili.",
"slides.close": "Chiudi",
"markdown.image_missing": "Immagine non disponibile: {name}",
"markdown.embed_cycle": "embed ricorsivo",
"markdown.embed_too_deep": "embed troppo annidato",
"slides.title": "Presentazione",
"slides.previous": "Slide precedente",
"slides.next": "Slide successiva",
"slides.position": "Slide {index} di {count}",
"mobile.opened.sheet": "Azione da un'altra app",
"mobile.opened.title": "Titolo della cattura",
"mobile.opened.body": "Testo da acquisire",
"mobile.opened.approve": "Conferma",
"mobile.opened.dismiss": "Rifiuta",
"mobile.opened.action": "Azione esterna: {action}",
"mobile.opened.action_vault": "Azione esterna: {action} · vault {vault}",
"mobile.opened.folder_registered": "Cartella registrata; verifica l'accesso prima del mount",
"mobile.storage.heading": "Spazio mobile",
"mobile.storage.private": "Usa spazio privato (rimosso alla disinstallazione)",
"mobile.storage.shared": "Usa cartella condivisa",
"mobile.storage.copy": "Copia nel privato (solo su conferma)",
"mobile.storage.not_connected": "Montaggio mobile non connesso all'Host",
"mobile.storage.choose": "Scegli esplicitamente spazio privato o cartella condivisa",
"mobile.storage.shared_unavailable": "Una cartella condivisa chiede la verifica nativa del permesso, che qui non c'è ancora: usa lo spazio privato",
"mobile.wasm.backend": "WASM configurato: {requested}; attivo: {active}",
"mobile.wasm.not_started": "non avviato",
"rail.order_failed": "Non riesco a salvare l'ordine della barra laterale: {reason}",
"rail.hidden_failed": "Non riesco a ricordare le icone nascoste della barra laterale: {reason}",
"shell.chrome_failed": "Cornice della macchina: {reason}",
"shell.zoom_now": "Zoom: {percent}%",
"shell.zoom_failed": "Lo zoom non è cambiato: {reason}",
"shell.focus_on": "Modalità concentrazione: lo stesso comando riporta i pannelli.",
"explorer.create_failed": "La nota non è stata creata: {reason}",
"tabmenu.pin": "Appunta la scheda",
"tabmenu.unpin": "Stacca la scheda",
"tabmenu.left": "Sposta a sinistra",
"tabmenu.right": "Sposta a destra",
"tabmenu.to_pane": "Sposta nel riquadro {pane}",
"tabmenu.to_stack": "Aggiungi alla pila {stack}",
"tabmenu.new_stack": "Nuova pila…",
"tabmenu.stack_name": "Nome della pila",
"tabmenu.leave_stack": "Togli dalla pila",
"tabmenu.close_others": "Chiudi le altre (tiene le appuntate)",
"tabmenu.close": "Chiudi",
"tabmenu.close_right": "Chiudi quelle a destra",
"tabmenu.split_right": "Apri in un riquadro a destra",
"tabmenu.new_window": "Apri in una nuova finestra",
"tabmenu.copy_path": "Copia il percorso",
"tabmenu.path_copied": "Percorso copiato: {path}",
"tabmenu.copy_failed": "Non è stato possibile copiare negli appunti.",
"tabmenu.close_unpinned": "Chiudi le non appuntate",
"tabmenu.pinned": "Appuntata",
"tabmenu.stack": "Pila {stack}",
"document.attachment_failed": "Deposito dell'allegato non riuscito: {reason}",
"document.viewer_unavailable": "Visualizzatore isolato non disponibile: {reason}",
"document.properties_unavailable": "Proprietà della nota non disponibili: {reason}",
"document.recorder_unavailable": "Registratore non disponibile: {reason}",
"document.slides_unavailable": "Presentazione non disponibile: {reason}",
"document.print_unavailable": "Stampa non disponibile: {reason}",
"document.reveal_unavailable": "Questa vista di {doc} non sa portare a quel punto.",
"media.open_external": "Apri con l'applicazione esterna",
"media.open_external_failed": "Non riesco ad aprire con l'applicazione esterna: {reason}",
"media.loading": "Carico {id}…",
"media.pdf.unavailable": "Anteprima PDF non disponibile (serve il caricatore locale pdfjs-dist {version}). Il file {id} ({mime}) è intatto.",
"media.pdf.page_failed": "Pagina PDF non disponibile: {reason}",
"media.pdf.search": "Cerca nel PDF…",
"media.pdf.no_matches": "Nessun risultato per «{needle}»",
"media.pdf.matches": "Risultati: {count}, il primo a pagina {page}",
"media.pdf.search_failed": "Ricerca nel PDF non riuscita: {reason}",
"media.pdf.copy_link": "Copia il link alla pagina",
"media.pdf.no_engine": "Motore PDF non caricato.",
"media.pdf.empty": "Il PDF {id} è vuoto.",
"media.pdf.page": "Pagina {page} di {count}",
"media.pdf.failed": "Il PDF non ha risposto: {reason}",
"media.player.empty": "File vuoto: niente da riprodurre.",
"media.player.undecodable": "Questo browser non sa decodificare {mime}. Il file è intatto; prova con l'applicazione esterna.",
"media.image.undecodable": "Non riesco a decodificare l'immagine {name} ({mime}, {size} byte). Il file resta intatto.",
"media.recorder.stop": "Ferma e salva",
"media.recorder.saving": "Salvo l'audio registrato…",
"media.recorder.saved": "Audio salvato in {id}",
"media.recorder.saved_no_embed": "Audio salvato in {id}, ma non sono riuscito a inserirlo nella nota: {reason}",
"media.recorder.saved_no_recovery": "Audio salvato in {id}; l'elenco dei recuperi non è disponibile: {reason}",
"media.recorder.staged": "La registrazione resta in attesa (o va ripulita): {reason}",
"media.recorder.recover": "Recupera la registrazione ({size} byte)",
"media.recorder.recoverable": "La registrazione resta recuperabile: {reason}",
"media.recorder.recovery_unavailable": "Recupero non disponibile: {reason}",
"settings.css.hint": "Solo CSS dell'utente locale. L'anteprima è temporanea; selettori e risorse passano dal sanitizzatore CSS.",
"settings.css.trust": "Fiducia: utente locale. L'anteprima non viene mai salvata da sola.",
"settings.css.preview": "Anteprima del CSS sanitizzato",
"settings.css.preview_active": "Anteprima attiva. Salva o annulla prima di lasciare le impostazioni.",
"settings.css.rejected": "CSS rifiutato: {reason}",
"settings.css.cancel_preview": "Annulla l'anteprima",
"settings.css.preview_cancelled": "Anteprima annullata; ripristinato il CSS salvato.",
"settings.css.save": "Salva il CSS sanitizzato",
"settings.css.not_saved": "CSS non salvato: {reason}",
"settings.css.snippet_on": "{id} · attivo · fiducia: utente locale",
"settings.css.snippet_off": "{id} · spento · fiducia: utente locale",
"settings.css.disable": "Spegni {id}",
"settings.css.needs_repair": "Il CSS salvato va riparato: {reason}",
"settings.profiles.machine": "Profili delle impostazioni della macchina",
"settings.profiles.vault": "Profili delle impostazioni del vault",
"settings.profiles.unavailable": "Profili non disponibili: {reason}",
"settings.profiles.choice": "Profilo",
"settings.profiles.new_name": "Nome del nuovo profilo",
"settings.profiles.json_placeholder": "Incolla un documento JSON completo di profilo da importare",
"settings.profiles.json": "JSON del profilo",
"settings.profiles.hint": "I profili conservano chiavi e valori JSON sconosciuti. Esporta prima di azzerare.",
"settings.profiles.saved": "Modifica del profilo salvata.",
"settings.profiles.not_changed": "Profilo non modificato: {reason}",
"settings.profiles.frame_hint": "Cambiare profilo può modificare la cornice nativa; riapri la finestra per applicarla.",
"settings.profiles.switch": "Cambia profilo",
"settings.profiles.duplicate": "Duplica il profilo scelto",
"settings.profiles.name_required": "Scrivi il nome del nuovo profilo.",
"settings.profiles.export": "Esporta il profilo scelto come JSON",
"settings.profiles.exported": "Il JSON esportato è pronto da copiare; nessun file è stato scritto.",
"settings.profiles.import": "Importa il JSON incollato",
"settings.profiles.json_required": "Incolla un documento JSON di profilo.",
"settings.profiles.reset": "Azzera il profilo scelto",
"settings.profiles.reset_confirm": "Azzerare i valori dichiarati in {profile}? Esporta prima per poter tornare indietro; i valori sconosciuti restano.",
"settings.profiles.reset_title": "Azzera il profilo delle impostazioni",
"settings.profiles.reset_ok": "Azzera il profilo",
"settings.profiles.reset_cancelled": "Azzeramento annullato: {reason}",
"settings.shortcuts.filter_placeholder": "Filtra le scorciatoie per comando, ID o tasto",
"settings.shortcuts.filter": "Filtra le scorciatoie",
"settings.catalog.title": "Catalogo verificato",
"settings.catalog.hint": "La ricerca richiede un feed nativo firmato e una radice di fiducia configurata. Niente viene scaricato o installato senza una tua scelta esplicita.",
"settings.catalog.search_placeholder": "Cerca nel catalogo per nome, editore o licenza",
"settings.catalog.search": "Ricerca nel catalogo",
"settings.catalog.run": "Cerca nel catalogo firmato",
"settings.catalog.checking": "Verifica del catalogo firmato…",
"settings.catalog.count": "Voci verificate nel catalogo: {count}.",
"settings.catalog.unavailable": "Catalogo non disponibile: {reason}",
"settings.catalog.provenance": "Editore: {publisher} · Licenza: {license} · Compatibilità: {compatible}",
"settings.catalog.digest": "Impronta: {digest} · Dimensione: {size} byte · ABI: {abi}",
"settings.catalog.revoked": "Revoca firmata: questa release non si può montare.",
"settings.catalog.permissions": "Permessi: {permissions}",
"settings.catalog.no_permissions": "nessuno",
"settings.catalog.confirm": "{action} {name} ({version})? Editore firmato: {publisher}. Licenza: {license}. Impronta: {digest}.",
"settings.catalog.confirm_revoked": "{action} {name} ({version})? Editore firmato: {publisher}. Licenza: {license}. Impronta: {digest}. Questa release è revocata.",
"settings.catalog.failed": "Azione sul catalogo non riuscita: {reason}",
"settings.catalog.install": "Installa la release",
"settings.catalog.update": "Aggiorna la release",
"settings.catalog.rollback": "Torna a questa release",
"settings.catalog.install_theme": "Installa la release del tema",
"settings.catalog.update_theme": "Aggiorna la release del tema",
"settings.catalog.rollback_theme": "Torna a questa release del tema",
"settings.catalog.revoke": "Revoca la release installata",
"settings.catalog.revoke_theme": "Revoca il tema installato",
"pane.recorder.open": "Registra audio",
"pane.recorder.close": "Chiudi il registratore",
"pane.slides": "Presenta come slide",
"pane.print": "Stampa il documento",
"search.fault": "{reason} (colonna {column}).",
"search.fault.unclosed_quote": "Una virgoletta aperta non è chiusa",
"search.fault.unclosed_regex": "Un'espressione regolare /…/ non è chiusa",
"search.fault.unclosed_property": "Un filtro di proprietà […] non è chiuso",
"search.fault.unclosed_group": "Una parentesi aperta non è chiusa",
"search.fault.unexpected_close": "Una parentesi chiusa non ha la sua aperta",
"search.fault.dangling_or": "OR vuole una ricerca da entrambi i lati",
"search.fault.empty_value": "Un operatore o una proprietà non ha un valore",
"search.fault.bad_value": "Il valore non è valido per questo operatore",
"search.fault.negated_group": "Un gruppo fra parentesi non si può negare: nega i singoli termini",
"search.fault.too_complex": "La ricerca ha troppe alternative dopo aver sciolto i gruppi",
"vault.restored": "Vault ripristinato dallo snapshot. Lo stato precedente è nel backup scelto.",
"clipboard.failed": "Non riesco a scrivere negli appunti: il sistema non lo consente.",
"settings.exported_console": "Impostazioni esportate: sono nella console (appunti non disponibili).",

// --- il selettore di icone e la palette ---------------------------------
"icons.choose": "Scegli un'icona",
"icons.any": "Un'emoji qualsiasi…",
"icons.none": "Senza icona",
"palette.title": "Comandi",
"palette.placeholder": "Comando…",
// I comandi **della finestra**: gli stessi campi di quelli del kernel, perché
// sono comandi come loro — quello che cambia è chi li esegue.
"commands.conflict": "«{chord}» è la scorciatoia di più comandi: {commands}.",
// I due modi, oltre alla contesa, in cui una scorciatoia scritto non si preme
// (§18.2). Si dicono all'avvio insieme ai conflitti veri, perché chiedono la
// stessa cosa a chi legge: aprire le impostazioni e cambiare una riga.
"commands.shadowed":
  "«{chord}» è già un comando da solo ({command}): le scorciatoie che cominciano di lì non si possono premere ({commands}).",
"commands.rejected":
  "«{chord}» non è una scorciatoia che si possa premere ({command}): il primo tasto deve portare Mod, Shift o Alt.",
// L'attesa del tasto successivo, nella barra di stato.
"keys.pending": "{chord}…",
"commands.mode.reading": "Alterna Lettura e scrittura",
"commands.mode.reading.desc": "Mostra la nota resa, senza l'editor; di nuovo, torna alla modalità di scrittura di prima.",
"commands.mode.live": "Passa a Live",
"commands.mode.live.desc": "Mostra la nota come testo, con l'anteprima viva.",
"commands.mode.source": "Passa a Sorgente",
"commands.mode.source.desc": "Mostra il Markdown com'è scritto, senza resa.",
"commands.doc.save": "Salva adesso",
"commands.doc.save.desc": "Scrive subito le modifiche in coda; dopo un salvataggio fallito riprova.",
"document.save_now_failed": "Non è stato possibile salvare {doc}: il testo resta nel buffer e nella bozza. Riprova con Salva adesso.",
"commands.tab.reopen": "Riapri la scheda chiusa",
"commands.tab.reopen.desc": "Riapre l'ultima scheda chiusa, al suo posto.",
"commands.tab.next": "Scheda successiva",
"commands.tab.next.desc": "Passa alla scheda a destra, ricominciando dalla prima.",
"commands.tab.previous": "Scheda precedente",
"commands.tab.previous.desc": "Passa alla scheda a sinistra, ricominciando dall'ultima.",
"commands.sidebar.toggle": "Mostra o nascondi la barra laterale",
"commands.sidebar.toggle.desc": "Apre o chiude file e ricerca; a finestra stretta come cassetto.",
"commands.inspector.toggle": "Mostra o nascondi l'ispettore",
"commands.inspector.toggle.desc": "Apre o chiude struttura, collegamenti e proprietà.",
"commands.settings": "Apri le impostazioni",
"commands.settings.desc": "Apre il pannello delle impostazioni.",
"commands.note.new": "Nuova nota",
"commands.note.new.desc": "Crea una nota nello spazio attivo e la apre.",
"commands.zoom.in": "Ingrandisci",
"commands.zoom.in.desc": "Ingrandisce l'interfaccia di un passo.",
"commands.zoom.out": "Riduci",
"commands.zoom.out.desc": "Riduce l'interfaccia di un passo.",
"commands.zoom.reset": "Dimensione reale",
"commands.zoom.reset.desc": "Riporta lo zoom al 100%.",
"commands.focus.toggle": "Modalità concentrazione",
"commands.focus.toggle.desc": "Nasconde barra laterale, rail e ispettore per scrivere senza cornice.",
// I comandi dei riquadri (§1.2). Dividere e chiudere sono comandi e non solo
// gesti del mouse per la ragione della 0077: un gesto che vive solo in un
// listener non compare in nessun elenco e nessuno lo può riconfigurare.
"commands.pane.split.right": "Dividi il riquadro a destra",
"commands.pane.split.right.desc":
  "Apre la stessa nota in un riquadro accanto, per guardarne due insieme.",
"commands.pane.split.down": "Dividi il riquadro in basso",
"commands.pane.split.down.desc": "Apre la stessa nota in un riquadro sotto questo.",
"commands.pane.close": "Chiudi il riquadro",
"commands.pane.close.desc": "Toglie questo riquadro; l'ultimo non si chiude.",
"commands.tab.close": "Chiudi la scheda",
"commands.tab.close.desc": "Toglie la nota da questo riquadro, salvandola se serve.",
"document.tab.close": "Chiudi {doc}",
"document.tab.list": "Elenco delle schede",
"document.toolbar.modes": "Modalità del riquadro",
"document.pane.menu": "Azioni del riquadro",
"document.conflict.title": "Conflitto su {doc}",
"document.conflict.body": "Il file è cambiato su disco. Scegli quale testo tenere: nessuna scelta è automatica.",
"document.conflict.keep_mine": "Mantieni il mio testo",
"document.conflict.use_disk": "Usa la versione su disco",
"document.conflict.cancel": "Decidi dopo",
"document.conflict.compare": "Confronta",
"document.conflict.compare_title": "{doc}: il tuo testo e quello su disco",
"document.conflict.pending": "Conflitto su {doc}: la scelta aspetta, niente è stato scritto.",
"document.conflict.resume": "Scegli ora",
"compare.legend": "Le righe con − ci sono solo su disco, quelle con + solo nel tuo testo.",
"compare.mine": "Solo nel tuo testo",
"compare.theirs": "Solo su disco",
"pane.named": "Riquadro: {name}",
"pane.resize": "Ridimensiona i riquadri (frecce; doppio clic per parti uguali)",
// Le due vie d'uscita da un conflitto (§18.1). I titoli nominano **cosa si
// perde** e non «risolvi»: chi legge una riga in una palette sta scegliendo
// fra due testi, e «risolvi il conflitto» non dice quale dei due resta.
"commands.doc.conflict.mine": "Conflitto: tieni il mio testo",
"commands.doc.conflict.mine.desc":
  "Riscrive il file col testo del buffer, coprendo la modifica arrivata da fuori.",
"commands.doc.conflict.theirs": "Conflitto: tieni il testo sul disco",
"commands.doc.conflict.theirs.desc":
  "Butta le modifiche non salvate e ricarica il file come sta sul disco.",
"panes.redraw_failed": "I riquadri non si sono ridisegnati: {reason}",
"pane.empty": "Riquadro vuoto",
"pane.empty.title": "Nessuna nota aperta in questo riquadro.",
"pane.empty.open": "Apri una nota",
"commands.panel.files": "Mostra i file",
"commands.panel.files.desc": "Porta l'albero del vault nella barra laterale.",
"commands.explorer.reveal": "Mostra la nota attiva nell'albero",
"commands.explorer.reveal.desc": "Apre le cartelle che la contengono e la porta in vista nell'albero dei file.",
"commands.explorer.rename": "Rinomina nell'albero",
"commands.explorer.rename.desc": "Apre il campo del nome sulla voce dell'albero col fuoco, o sulla nota attiva. I collegamenti che la nominano seguono il nuovo nome.",
"commands.explorer.trash": "Sposta nel cestino dall'albero",
"commands.explorer.trash.desc": "Cestina la voce dell'albero col fuoco, o la nota attiva. Si ripristina dal cestino.",
"commands.panel.search": "Mostra la ricerca",
"commands.panel.search.desc": "Porta i risultati della ricerca nella barra laterale.",
"commands.vault.open": "Apri un vault…",
"commands.vault.open.desc": "Sceglie una cartella e la apre come vault.",
"commands.palette": "Apri la palette dei comandi",
"commands.palette.desc": "Cerca fra tutti i comandi e lanciane uno.",
"palette.empty": "Nessun comando",
"palette.unavailable": "I comandi del vault non rispondono ({reason}): la palette mostra quelli già noti.",
"palette.open_view": "Apri la vista {title}",
"palette.open_view.desc": "Apre la vista nel riquadro attivo",
"palette.preview": "Anteprima…",
"palette.apply": "Applica",
"palette.required": "{title} *",
"palette.docs_placeholder": "un id per riga (vuoto = tutto il vault)",
"palette.numbers_placeholder": "un numero per riga",
"palette.reach.session": "questa sessione",
"palette.reach.document": "una nota",
"palette.reach.documents": "più note",
"palette.reach.vault": "il vault",
"palette.reach.settings": "le impostazioni",
// Il raggio di un comando in una riga. Tre chiavi invece della
// concatenazione che c'era: una lingua che mette il verbo dopo l'oggetto —
// o che non separa con un punto medio — riscrive il **template**, e non ha
// modo di riscrivere un `${a} · ${b}` scritto in TypeScript.
"palette.reads": "legge · {dove}",
"palette.writes": "scrive · {dove}",
"palette.irreversible": "{cosa} · non reversibile",
"palette.plan_edits": "{doc} — Modifiche: {count}",
"palette.docs_limited": "Suggerimenti limitati ai primi {count}: scrivi il nome per intero o usa Vai alla nota",
// --- ciò che si dice quando un pezzo non risponde ----------------------
"panel.render_failed": "Il pannello «{panel}» non si è ridisegnato: {reason}",
"document.overwritten":
  "{doc} è stato cambiato da un'altra applicazione mentre avevi modifiche non salvate: niente è stato sovrascritto, e al prossimo salvataggio sceglierai quale testo tenere.",
"document.changed_on_disk":
  "{doc} è cambiato su disco mentre avevi modifiche non salvate: le tue restano, e al salvataggio sceglierai quale testo tenere.",
"document.deleted_dirty":
  "{doc} è stato cancellato da fuori mentre avevi modifiche non salvate: il testo è conservato in bozza. Puoi ricrearlo adesso o recuperarlo al prossimo avvio.",
"document.recreate": "Ricrea la nota",
"document.save_failed": "{doc} non è stato salvato: {reason}",
// Dice **perché il gesto non è partito**, e nomina il documento appeso: chi
// legge ha appena chiesto di spostare una nota e deve capire che il rifiuto
// riguarda un salvataggio, non la rinomina.
// L'iscrizione alla chiusura non è andata: da qui in poi la finestra si chiude
// senza che nessuno metta in salvo il ritardo. È una frase e non una riga di
// log perché chi scrive deve sapere che la rete sotto non c'è.
"document.close_unhooked":
  "Fub non riesce ad ascoltare la chiusura della finestra: usa «Salva adesso» prima di chiudere, perché l'ultima battuta potrebbe non essere ancora sul disco.",
"document.close_failed": "Chiusura annullata: {reason}. I documenti restano aperti.",
"document.unsaved_blocks":
  "{doc} non è sul disco: l'operazione si ferma qui, perché spostare il file lascerebbe indietro il testo non salvato.",
// Dice **che non è stato scritto niente**, e non è un dettaglio tecnico: è la
// sola frase che distingue questo caso da «non ci sono riuscito», e senza di
// essa chi legge crede di aver perso il proprio testo.
"document.save_conflict":
  "{doc} è cambiato su disco da quando l'hai aperto: non è stato scritto niente, e le tue modifiche sono ancora qui. Scegli quale testo tenere nella barra sopra la nota.",
"document.conflict_none": "Nessun conflitto da risolvere su questo documento.",
"document.reload_failed": "{doc} non è stato riletto dal disco: il testo e il suo stato restano quelli di prima.",
"document.close_unsaved.title": "Modifiche non salvate",
"document.close_unsaved": "«{doc}» non si è potuta salvare. Scartare le modifiche, o tenerla aperta per riprovare?",
"document.close_unsaved.discard": "Scarta le modifiche",
"document.close_unsaved.keep": "Tienila aperta",
"preview.open_failed": "Non riesco ad aprire «{page}»: {reason}",
"preview.target_missing": "Il documento di destinazione non esiste.",
"mermaid.diagram": "Diagramma Mermaid",
"mermaid.links": "Link del diagramma",
"mermaid.source": "Sorgente del diagramma",
"mermaid.edit": "Apri sorgente",
"mermaid.loading": "Rendering del diagramma…",
"mermaid.error": "Diagramma non disponibile: {reason}",
"mermaid.too_large": "Il diagramma supera il limite di {limit} caratteri.",
"mermaid.image_failed": "Impossibile visualizzare l’immagine del diagramma.",
"kernel.listener_failed": "Un ascoltatore di eventi del kernel ha lanciato: {reason}",
"store.listener_failed": "Un ascoltatore di «{signal}» ha lanciato: {reason}",
// Senza la chiave, e non per pigrizia: il nome dello stato cambierebbe la
// riga a ogni click, e quattordici righe diverse dicono peggio di una riga
// con «×14» ciò che è successo — che è la regola di `raccogli`.
"state.not_remembered": "Non ho potuto ricordare come hai lasciato i pannelli.",
"organization.unreadable":
  "L'organizzazione del vault non si legge ({reason}): icone, appuntate e ordine di questa sessione non verranno salvati.",
"organization.not_saved": "Organizzazione non salvata: {reason}",
"views.surface_missing":
  "La view «{view}» chiede la superficie «{surface}», che questa shell non ospita: {reason}.",
"views.open_unavailable": "La view «{view}» non si apre in un riquadro",
"views.action_failed":
  "L'azione «{action}» non è andata a buon fine ({reason}): quello che vedi è di prima.",
"commands.list_failed":
  "L'elenco dei comandi non è arrivato ({reason}): la palette è vuota e le scorciatoie dichiarate non rispondono.",
"vault.partial":
  "{count} note non si sono lette all'apertura: la ricerca non le trova e il grafo non le collega.",
"vault.partial.one":
  "Una nota non si è letta all'apertura: la ricerca non la trova e il grafo non la collega.",

// --- il buffer di crash (§15.2) ----------------------------------------
//
// Una frase per CASO e non una sola con dentro dei se: la domanda da fare è
// diversa in ognuno, e una frase generica («c'è del testo non salvato»)
// costringerebbe chi la legge ad aprire per capire cosa gli sta succedendo.
"draft.found":
  "{count} note avevano del testo non salvato: è stato rimesso al suo posto. Dove il file è cambiato nel frattempo, o la nota non c'è più, sceglierai tu quale testo tenere.",
"draft.found.one":
  "Una nota aveva del testo non salvato: è stato rimesso al suo posto. Se il file è cambiato nel frattempo, o la nota non c'è più, sceglierai tu quale testo tenere.",
"draft.case.superata": "Il file contiene già questo testo.",
"draft.case.nuova": "Questa nota non è mai stata salvata: la bozza è tutto ciò che c'è.",
"draft.case.orfana":
  "La nota è stata cancellata mentre questo testo era ancora nell'editor: recuperarlo la farebbe tornare.",
"draft.case.intatta":
  "Il file non è cambiato da quando hai iniziato questo testo: è la copia non salvata da recuperare.",
"draft.case.divergente":
  "Il file è cambiato da quando questo testo se n'è discostato: tenendone uno si perde l'altro.",
"draft.case.incerta":
  "Non si sa da quale versione del file questo testo sia partito: guardali prima di scegliere.",
// Non «una bozza non è stata scritto» ma **la rete non c'è più**: la prima è
// una notizia su un file, la seconda è ciò che cambia cosa si può fare adesso.
"draft.blind":
  "Il testo non salvato non arriva più sul disco: da adesso un crash lo perderebbe. Usa «Salva adesso» per ciò che non vuoi rischiare.",

// --- lo stato del salvataggio (§20.4) ----------------------------------
// Quattro parole nella barra di stato, e non un'icona: «salvato» e «non
// salvato» sono la differenza fra un'ora di lavoro che c'è e un'ora che non
// c'è, e un pallino la fa indovinare. Il pallino sulla linguetta resta dov'era: dice
// *quale* nota, questa dice *cosa le è successo*.
"save.saved": "Salvato",
"save.saving": "Salvataggio…",
"save.unsaved": "Non salvato",
"save.failed": "Salvataggio fallito",
"save.conflitto": "Cambiato su disco",
  "bookmarks.title": "Segnalibri",
  "bookmarks.save_tabs": "Salva le schede",
  "bookmarks.save_tabs_hint": "Salva tutte le schede di questo riquadro in un segnalibro.",
  "bookmarks.add": "Aggiungi segnalibro",
  "bookmarks.add_hint": "Aggiungi file, intestazione, blocco, ricerca, vista, workspace o cartella",
  "bookmarks.type.file": "File",
  "bookmarks.type.heading": "Intestazione",
  "bookmarks.type.block": "Blocco",
  "bookmarks.type.search": "Ricerca",
  "bookmarks.type.view": "Vista",
  "bookmarks.type.workspace": "Workspace",
  "bookmarks.type.folder": "Cartella",
  "bookmarks.name_title": "Nome del segnalibro",
  "bookmarks.default_tabs": "Schede aperte",
  "bookmarks.save_failed": "Impossibile salvare il segnalibro.",
  "bookmarks.new_group": "Nuovo gruppo",
  "bookmarks.future": "I segnalibri usano la versione {version}, non supportata.",
  "bookmarks.corrupt": "I segnalibri non sono leggibili. Il contenuto originale non viene sostituito.",
  "bookmarks.rename": "Rinomina",
  "bookmarks.rename_title": "Nuovo nome",
  "bookmarks.delete": "Rimuovi",
  "bookmarks.delete_group_confirm": "Rimuovere il gruppo «{title}»?",
  "bookmarks.delete_confirm": "Rimuovere il segnalibro «{title}»?",
  "bookmarks.empty": "Non ci sono segnalibri.",
  "bookmarks.open": "Apri",
  "bookmarks.move_up": "Sposta prima",
  "bookmarks.move_down": "Sposta dopo",
  "bookmarks.assign_group": "Assegna a un gruppo",
  "bookmarks.assign_title": "Scegli il numero del gruppo:\n{groups}",
  "bookmarks.group_title": "Nome del gruppo",
"bookmarks.group_filter": "Filtra i gruppi",
"bookmarks.tabs_count": "{count} schede",
  "bookmarks.group_failed": "Impossibile creare il gruppo.",
  "bookmarks.saved": "Segnalibro salvato.",
  "workspaces.title": "Workspace salvati",
  "workspaces.save": "Salva workspace",
  "workspaces.future": "L’elenco dei workspace usa la versione {version}, non supportata.",
  "workspaces.corrupt": "L’elenco dei workspace non è leggibile. Il contenuto originale non viene sostituito.",
  "workspaces.empty": "Non ci sono workspace salvati.",
  "workspaces.load": "Carica",
  "workspaces.update": "Aggiorna dalla disposizione attuale",
  "workspaces.rename": "Rinomina",
  "workspaces.rename_title": "Nuovo nome del workspace",
  "workspaces.rename_failed": "Impossibile rinominare il workspace.",
  "workspaces.delete": "Elimina workspace",
  "workspaces.delete_confirm": "Eliminare il workspace «{name}»? I documenti restano nel vault.",
  "workspaces.delete_failed": "Impossibile eliminare il workspace.",
  "workspaces.save_title": "Nome del workspace",
"workspaces.summary": "{panes} riquadri · {tabs} schede",
  "workspaces.save_failed": "Impossibile salvare il workspace.",
  "workspaces.saved": "Workspace salvato.",
  "workspaces.update_failed": "Impossibile aggiornare il workspace.",
  "workspaces.updated": "Workspace aggiornato.",
  "workspaces.missing": "Il workspace non è più disponibile.",
  "workspaces.report_missing": "Documenti mancanti: {docs}",
  "workspaces.report_views": "Viste non disponibili: {views}",
  "workspaces.applied": "Workspace caricato.",
  "workspaces.applied_partial": "Workspace caricato con elementi non disponibili. Documenti: {missing}. Viste: {views}.",
  "windows.unavailable": "Le finestre separate non sono disponibili in questo client.",
  "windows.open_failed": "Impossibile aprire la finestra: {reason}",
  "windows.drain_failed": "La finestra di {doc} non può essere chiusa: {reason}",
  "windows.drain_dirty": "{doc} ha ancora modifiche non salvate. La finestra resta aperta.",
  "windows.drain_conflict": "{doc} è in conflitto con il file sul disco. Risolvi il conflitto prima di chiudere.",
  "windows.invalid_request": "Questa finestra non ha un documento valido.",
  "windows.local_error": "Modifiche locali conservate nella finestra: {reason}",
  "windows.saving": "Salvataggio delle modifiche in corso…",
  "windows.keep_local": "Conserva le mie modifiche",
  "windows.discard_local": "Scarta le modifiche locali",
  "windows.not_text": "{doc} non si apre in una finestra a parte: la finestra mostra soltanto note e file di testo.",
  "windows.error.session_gone": "Sessione documento non più disponibile",
  "windows.error.bad_identity": "Identità finestra non valida",
  "windows.error.closed_while_opening": "Finestra disconnessa durante l'apertura; sessione conservata",
  "windows.error.owner_changed": "Autorità documento cambiata: sessione mantenuta",
  "windows.error.owner_changed_saving": "Autorità documento cambiata durante il salvataggio",
  "windows.error.changed_closing": "Documento modificato durante la chiusura: sessione conservata",
  "windows.error.disconnected": "Disconnessione senza drain confermato; sessione conservata",
  "windows.error.session_changed": "Sessione o vault cambiati: finestra mantenuta",
  "windows.error.changed_draining": "Sessione cambiata durante il drain",
  "windows.error.still_opening": "Finestra ancora in apertura",
  "windows.error.destroy_unconfirmed": "La distruzione della finestra non è stata confermata",
  "windows.error.close_event_missing": "Evento di chiusura nativo mancante",
  "windows.error.close_incomplete": "Chiusura nativa non completata",
  "windows.error.save_unconfirmed": "Salvataggio non confermato",
  "windows.error.save_unconfirmed_doc": "Salvataggio non confermato: {doc}",
  "windows.error.changed_draining_doc": "Documento modificato durante il drain: {doc}",
  "mode.canvas": "Lavagna",
  "canvas.surface": "Lavagna",
  "canvas.add_text": "Aggiungi testo",
  "canvas.add_file": "Aggiungi file",
  "canvas.pick_file": "Scegli il file della card",
  "canvas.pick_file_filter": "Filtra per nome o percorso",
  "canvas.add_link": "Aggiungi pagina web",
  "canvas.add_group": "Aggiungi gruppo",
  "canvas.duplicate": "Duplica la selezione",
  "canvas.delete": "Elimina la selezione",
  "canvas.bring_front": "Porta davanti",
  "canvas.send_back": "Porta dietro",
  "canvas.fit": "Mostra tutta la lavagna",
  "canvas.zoom_in": "Ingrandisci",
  "canvas.zoom_out": "Riduci",
  "canvas.connect": "Collega la scheda {id}",
  "canvas.empty_text": "Scheda vuota",
  "canvas.open_url": "Apri la pagina web",
  "canvas.ungrouped": "Gruppo senza nome",
  "canvas.edit_text": "Modifica il testo della scheda {id}",
  "canvas.fit_selection": "Inquadra la selezione",
  "canvas.align_left": "Allinea a sinistra",
  "canvas.align_center": "Allinea al centro",
  "canvas.align_right": "Allinea a destra",
  "canvas.align_top": "Allinea in alto",
  "canvas.align_middle": "Allinea al centro verticale",
  "canvas.align_bottom": "Allinea in basso",
  "canvas.distribute_x": "Distribuisci orizzontalmente",
  "canvas.distribute_y": "Distribuisci verticalmente",
  "canvas.select_edge": "Seleziona collegamento",
  "canvas.default": "Predefinito",
  "canvas.node_color": "Colore scheda",
  "canvas.node_color_hex": "Colore scheda esadecimale",
  "canvas.edge_color": "Colore collegamento",
  "canvas.edge_color_hex": "Colore collegamento esadecimale",
  "canvas.edge_label": "Etichetta collegamento",
  "canvas.edge_from_node": "Scheda iniziale",
  "canvas.edge_to_node": "Scheda finale",
  "canvas.edge_from_side": "Lato iniziale",
  "canvas.edge_to_side": "Lato finale",
  "canvas.edge_from_end": "Terminazione iniziale",
  "canvas.edge_to_end": "Terminazione finale",
  "canvas.convert_note": "Converti in nota",
  "canvas.too_large": "La lavagna supera il limite interattivo; usa la modalità Sorgente.",
  "publish.title": "Pubblicazione",
  "publish.dry_run": "Anteprima della pubblicazione",
  "publish.commit": "Pubblica",
  "publish.unpublish": "Ritira la pubblicazione",
  "publish.rollback": "Ripristina una pubblicazione",
  "publish.no_preview": "Prepara un’anteprima prima di pubblicare.",
  "publish.command_ok": "Operazione richiesta: {command}",
  "publish.command_failed": "Operazione {command} non riuscita: {reason}",
  "commands.tab.pin": "Fissa la scheda",
  "commands.tab.pin.desc": "Mantiene aperta la scheda durante le chiusure collettive.",
  "commands.tab.unpin": "Sblocca la scheda",
  "commands.tab.unpin.desc": "Toglie la protezione della scheda dalle chiusure collettive.",
  "commands.tab.move.left": "Sposta la scheda a sinistra",
  "commands.tab.move.left.desc": "Sposta la scheda prima della precedente.",
  "commands.tab.move.right": "Sposta la scheda a destra",
  "commands.tab.move.right.desc": "Sposta la scheda dopo la successiva.",
  "commands.tab.move.pane.previous": "Sposta la scheda nel riquadro precedente",
  "commands.tab.move.pane.previous.desc": "Porta la scheda nel riquadro prima di questo; dal primo passa all'ultimo.",
  "commands.tab.move.pane.next": "Sposta la scheda nel riquadro successivo",
  "commands.tab.move.pane.next.desc": "Porta la scheda nel riquadro dopo questo; dall'ultimo passa al primo.",
  "commands.tab.close.others": "Chiudi le altre schede",
  "commands.tab.close.others.desc": "Chiude le altre schede del riquadro, salvando prima le modifiche.",
  "commands.tab.close.unpinned": "Chiudi le schede non fissate",
  "commands.tab.close.unpinned.desc": "Chiude le schede non fissate, salvando prima le modifiche.",
  "commands.pane.back": "Indietro nel riquadro",
  "commands.pane.back.desc": "Torna alla precedente destinazione della cronologia del riquadro.",
  "commands.pane.forward": "Avanti nel riquadro",
  "commands.pane.forward.desc": "Passa alla successiva destinazione della cronologia del riquadro.",
  "commands.pane.link": "Collega il riquadro",
  "commands.pane.link.desc": "Collega la navigazione di questo riquadro agli altri riquadri collegati.",
  "commands.pane.unlink": "Scollega il riquadro",
  "commands.pane.unlink.desc": "Rende indipendente la navigazione di questo riquadro.",
  "commands.bookmarks.toggle": "Mostra o nascondi i segnalibri",
  "commands.bookmarks.toggle.desc": "Apre o chiude il pannello dei segnalibri.",
  "commands.bookmarks.save": "Salva la nota nei segnalibri",
  "commands.bookmarks.save.desc": "Aggiunge un segnalibro per la nota corrente.",
  "commands.bookmarks.group": "Crea un gruppo di segnalibri",
  "commands.bookmarks.group.desc": "Raccoglie segnalibri sotto un nome scelto.",
  "commands.bookmarks.open": "Apri i segnalibri",
  "commands.bookmarks.open.desc": "Mostra i segnalibri salvati.",
  "commands.workspace.toggle": "Mostra o nascondi i workspace",
  "commands.workspace.toggle.desc": "Apre o chiude il pannello dei workspace salvati.",
  "commands.workspace.save": "Salva il workspace",
  "commands.workspace.save.desc": "Salva la disposizione attuale con un nome.",
  "commands.workspace.load": "Carica un workspace",
  "commands.workspace.load.desc": "Sceglie una disposizione salvata da ripristinare.",
  "commands.workspace.update": "Aggiorna il workspace",
  "commands.workspace.update.desc": "Sostituisce la disposizione salvata del workspace corrente.",
  "commands.workspace.rename": "Rinomina il workspace",
  "commands.workspace.rename.desc": "Cambia il nome del workspace corrente.",
  "commands.workspace.delete": "Elimina il workspace",
  "commands.workspace.delete.desc": "Rimuove la disposizione salvata, non i documenti.",
  "commands.preview.show": "Mostra l’anteprima",
  "commands.preview.show.desc": "Apre un’anteprima della nota corrente senza modificarla.",
  "commands.preview.hide": "Chiudi l’anteprima",
  "commands.preview.hide.desc": "Chiude l’anteprima aperta."
} as const;

/// Una chiave del catalogo della shell.
export type Key = keyof typeof IT;

/// L'inglese. Il tipo è ciò che lo tiene completo: togliere una riga qui è un
/// errore di compilazione, non una chiave nuda scoperta da qualcuno.
const EN: Record<Key, string> = { "app.skip_to_editor": "Skip to the editor",
"app.open_vault": "Open vault…",
"app.settings": "Settings",
"app.settings.hint": "The settings of this vault",
"app.close": "Close",
"app.cancel": "Cancel",
"app.undo": "Undo",
"app.unexpected": "Something went wrong: {reason}",
"commands.failed": "«{command}» failed: {reason}",
"app.ok": "OK",
"dialog.more": "…and {n} more not listed",
"dialog.empty": "No results",
"app.retry": "Retry",
"app.run": "Run",
"app.dialog": "Dialog",
"app.start_failed": "Startup failed: {reason}",
"app.external_changes":
  "Changes made by other apps will not be detected: close and reopen the vault to read it again.",
"app.vault_keys_pending":
  "This vault proposes {count} shortcuts that are not active yet ({commands}). Look at them in the settings, Shortcuts section.",
"app.vault_keys_pending.one":
  "This vault proposes a shortcut that is not active yet ({commands}). Look at it in the settings, Shortcuts section.",
"onboarding.title": "Open your workspace",
"onboarding.detail": "A vault is a folder of files on your device",
"onboarding.recent": "Recent vaults",
"onboarding.create": "Create a new vault…",
"onboarding.create.title": "Choose an empty folder, or create one: it becomes your vault",
"onboarding.recent.forget": "Remove {name} from recents",
"onboarding.recent.forget.hint": "Removes the vault from the list; the folder and its notes stay where they are",
"onboarding.trouble": "Trouble starting? Diagnostics and recovery",
"onboarding.opening": "Opening {path}…",
"demo.title": "Demo vault",
"demo.detail": "Try Fub in an isolated folder in the machine configuration. Your changes stay until you explicitly reset the demo.",
"demo.open": "Open demo",
"demo.opening": "Opening demo…",
"demo.checking": "Checking demo availability…",
"demo.reset": "Reset demo",
"demo.reset_confirm": "Discard your demo changes and restore the example notes? No other vault will be changed.",
"demo.reset_done": "Demo restored.",
"demo.close": "Close demo",
"demo.unavailable": "Demo unavailable without a machine configuration folder.",
"demo.switch_blocked": "Cannot switch vaults until saving or an open document window has finished.",
"demo.unsaved": "Changes in {files} were not saved: stay in this vault and retry after resolving them.",
"support.title": "Diagnostics and support",
"support.detail": "Review the complete preview before exporting. The report includes counts and paths, never note contents or log lines.",
"support.preview": "Show preview",
"support.preview_first": "Show and read the preview before exporting.",
"support.preview_done": "Preview ready: {keys} keys, {vaults} vaults.",
"support.export": "Export report",
"support.export_confirm": "Have you read the preview? Export exactly this report to {dest}?",
"support.export_done": "Report exported to {dest}.",
"support.working": "Loading…",
"support.diagnostics": "Startup diagnostics",
"support.no_diagnostics": "No startup diagnostics for the current vault.",
"support.no_vault": "Open a vault to view its startup diagnostics.",
"recovery.title": "Machine configuration",
"recovery.detail": "Check the files; recovery never starts on its own. A file written by a future version requires updating the app.",
"recovery.check": "Check configuration",
"recovery.healthy": "Present files are readable; absent files are normal on first launch.",
"recovery.found": "Some files require attention.",
"recovery.unavailable": "Machine configuration unavailable.",
"recovery.ok": "Readable",
"recovery.missing": "Absent (normal on first launch)",
"recovery.unreadable": "Unreadable: {reason}",
"recovery.future": "Version {found}, supported up to {supported}: update Fub; do not reset this file.",
"recovery.backup": "Create backup",
"recovery.reset": "Back up and recreate empty",
"recovery.backup_confirm": "Copy {path} without changing it?",
"recovery.reset_confirm": "Copy {path} and recreate it empty? Existing settings will no longer be active; a restart may be required.",
"recovery.done": "Backup: {backup}. {restart}",
"recovery.no_backup": "no previous file",
"recovery.restart": "Restart Fub to apply recovery.",
"help.not_found": "Choose another folder or check that it still exists.",
"help.already_exists": "Choose another destination.",
"help.conflict": "Check concurrent changes before retrying.",
"help.io": "Check available disk space and retry.",
"help.permission_denied": "Check the permissions of the file or folder.",
"help.bad_args": "Check your selection and retry.",
"help.unknown": "Report this unrecognized operation.",
"help.unserved": "This feature is unavailable in this installation.",
"help.cancelled": "The operation was cancelled; you can retry.",
"help.internal": "Report the problem without sharing private data.",
"app.menu": "Menu",
"layout.divider.sidebar": "Resize the sidebar",
"layout.divider.inspector": "Resize the inspector",

"region.menu": "Application menu",
"region.window_controls": "Window controls",
"region.notes": "Notes and search",
"region.document": "Document",
"region.bottom": "Bottom panels",
"region.status": "Component status",
"region.statusbar": "Status bar",

// --- the custom titlebar: window controls and menubar ------------------
"window.min": "Minimize",
"window.max": "Maximize",
"window.restore": "Restore",
"window.close": "Close",
"menu.file": "File",
"menu.edit": "Edit",
"menu.view": "View",
"menu.go": "Go",
"menu.tools": "Tools",
"menu.file.open_vault": "Open vault…",
"menu.edit.palette": "Command palette",
"menu.edit.doc_search": "Search in note",
"menu.view.files": "Show files",
"menu.view.search": "Show search",
"menu.view.mode_reading": "Reading mode",
"menu.view.mode_live": "Live mode",
"menu.view.mode_source": "Source mode",
"menu.view.sidebar": "Show or hide the sidebar",
"menu.view.inspector": "Show or hide the inspector",
"menu.view.focus": "Focus mode",
"menu.view.zoom_in": "Zoom in",
"menu.view.zoom_out": "Zoom out",
"menu.view.zoom_reset": "Actual size",
"menu.file.new_note": "New note",
"menu.file.save": "Save",
"menu.file.reopen_tab": "Reopen closed tab",
"menu.file.close_tab": "Close tab",
"menu.go.back": "Back",
"menu.go.forward": "Forward",
"menu.go.next_tab": "Next tab",
"menu.go.previous_tab": "Previous tab",
"menu.go.switcher": "Go to note",
"menu.tools.settings": "Settings",

// --- the rail: the left icon strip, always visibile --------------------
"rail.notes": "Notes",
"rail.notes.hint": "The vault tree",
"rail.search": "Search",
"rail.search.hint": "Search the vault",
"rail.manage": "Arrange side panels",
"rail.show": "Show {name}",
"rail.hide": "Hide {name}",
"rail.move_up": "Move {name} up",
"rail.move_down": "Move {name} down",

// --- the inspector: the right tabs ------------------------------------
"inspector.region": "Inspector",
"inspector.empty": "No views to show.",

// --- the search trigger in the titlebar -------------------------------
"command-search.placeholder": "Search the vault…",
"command-search.hint": "Search the vault. Palette: Mod-Shift-P",
"region.rail": "Navigation",

"mode.group": "Pane mode",
"mode.source": "Source",
"mode.sheet": "Sheet",
"mode.live": "Live",
"mode.reading": "Reading",
"editor.document": "Document editor",
"editor.task.completed": "Completed task",
"editor.task.pending": "Incomplete task",
"grid.surface": "Spreadsheet",
"grid.a11y.superficie": "Spreadsheet",
"preview.code_block": "Code block",
"preview.copy_code": "Copy code",
"preview.code_copied": "Code copied.",
"preview.copy_failed": "Cannot copy code: {reason}",
"preview.embed_failed": "Cannot finish the preview: {reason}",
"math.formula": "Mathematical formula",
"math.loading": "Rendering formula…",
"math.error": "Formula unavailable: {reason}",
"math.too_large": "The formula exceeds the limit of {limit} characters.",
"viewer.unavailable": "Binary preview unavailable",
"viewer.bytes_unavailable": "Binary preview unavailable",
"surface.unavailable": "No surface available",

"search.placeholder": "Search the vault…",
"search.hint": "Search the vault",
"search.results": "Results",
"search.indexing": "Indexing…",
"search.count": "Results: {count}",
"search.unavailable": "Search unavailable",
"search.loading": "Searching…",
"search.count_limited": "Results: {shown} of {total}",
"search.more": "Show more ({shown} of {total})",
"search.empty": "No results",
"search.create": "Create this note",
"search.occurrence": "Occurrence {n}",
"search.copy_visible": "Copy visible results",
"search.clipboard_unavailable": "Clipboard unavailable",
"search.explain": "Explain query",
"search.exclude": "Exclude",
"search.exclude_doc": "Exclude {doc}",
"search.exclude_folder": "Exclude folder {folder}",
"search.syntax_incomplete": "Syntax to complete: {reason}",
"search.syntax_help": "Syntax",
"search.exclusion_remove": "Remove the exclusion of {name}",
"search.syntax.tag": "notes with the tag (and its sub-tags)",
"search.syntax.folder": "notes inside the folder",
"search.syntax.path": "notes whose path contains the text",
"search.syntax.file": "notes whose name contains the text",
"search.syntax.heading": "text inside a heading",
"search.syntax.task": "tasks to do (task:done for completed ones)",
"search.syntax.phrase": "the words in that order",
"search.syntax.regex": "a regular expression",
"search.syntax.property": "a frontmatter property; also [key:>5]",
"search.syntax.or": "one or the other (uppercase OR)",
"search.syntax.not": "excludes notes with the word",
"search.syntax.group": "groups alternatives",

"docsearch.title": "Search in note",
"docsearch.placeholder": "Search in this note…",
"docsearch.no_doc": "No note open",
"commands.doc.search": "Search in note",
"commands.doc.search.desc": "Search inside the open note, with the same engine as the vault.",

"switcher.title": "Go to note",
"switcher.placeholder": "Go to note…",
"switcher.actions_hint": "Enter: open here · Ctrl/⌘+Enter: split · Ctrl/⌘+Shift+Enter: new window · Alt+Enter: preview · Shift+Enter: create with this name",
"switcher.actions_hint_single_window": "Enter: open here · Ctrl/⌘+Enter: split · Alt+Enter: preview · Shift+Enter: create with this name",
"switcher.hint": "Type the name of a note",
"switcher.empty": "No note with this name",
"switcher.recent_search": "Recent search",
"switcher.create": "Create this note",
"commands.switcher": "Go to note",
"commands.switcher.desc": "Open a note by searching its name, with the same engine as the vault.",
"commands.history_clear": "Clear recent searches and notes",
"commands.history_clear.desc":
  "Forget what you searched for and which notes you opened. This cannot be undone.",
"history.cleared": "Recent searches and notes cleared",

"explorer.notes": "Notes",
"explorer.notes.hint": "Notes of the vault",
"explorer.new": "+ New",
"explorer.new.hint": "Create a new note",
"explorer.pinned": "Pinned",
"explorer.rename": "Rename",
"explorer.icon": "Icon…",
"explorer.unpin": "Unpin",
"explorer.pin": "Pin",
"explorer.to_folder": "Turn into a folder",
"explorer.delete": "Delete",
"explorer.as_space": "Use as a space",
"explorer.move": "Move to…",
"explorer.move_title": "Move «{name}» to…",
"explorer.move_filter": "Filter folders",
"explorer.new_note_here": "New note here",
"explorer.destination_open": "the destination is already open",
"explorer.empty": "There are no notes here yet.",
"explorer.move.hint": "Choose the destination folder",
"explorer.not_a_space": "Remove from the spaces",
"explorer.whole_vault": "The whole vault",
"explorer.new_space": "New space from a folder",
"explorer.no_folders": "No folder available",
"explorer.altre_voci": "…and {n} more in here",
"explorer.altre_voci.one": "…and one more in here",
"explorer.altre_cartelle": "…and {n} more folders",
"explorer.altre_cartelle.one": "…and one more folder",
"explorer.to_folder_failed": "Cannot turn {doc} into a folder: {reason}",
"explorer.rename_failed": "Renaming {doc} to {to} was refused: {reason}",
"explorer.new_folder": "New folder",
"explorer.no_viewer": "Fub has no viewer for {name}: the file stays on disk as it is.",
"explorer.new_folder_failed": "Cannot create the folder {folder}: {reason}",
"explorer.move_failed": "Cannot move {doc} into {folder}: {reason}",
"explorer.root": "the root",

"explorer.bad_name": "“{name}” cannot be used: {reason}",
"name_fault.empty": "the name is missing",
"name_fault.traversal": "“.” and “..” are not names",
"graph.count": "Graph — Notes: {note} · Links: {edges}",
"graph.a11y.superficie": "Vault graph: {note} notes, {edges} links",
"graph.conf.titolo": "Graph physics",
"graph.conf.fisica": "Simulation",
"graph.conf.vista": "View",
"graph.empty": "No notes to link.",
"graph.list.label": "Graph notes",
"graph.list.open": "Open {doc}",
"graph.list.more": "…and {n} more notes",
"graph.list.empty": "No nodes on this page.",
"graph.status.selected": "Selected: {doc}",
"graph.status.none": "No node selected.",
"graph.time.label": "Indexed last modification (not link history)",
"graph.time.all": "All modification dates",
"graph.time.by": "Modified by {date}",
"graph.time.play": "Play date filter",
"graph.toolbar": "Graph controls",
"graph.local.enter": "Only around «{doc}»",
"graph.local.none": "Local graph: open a note first",
"graph.local.leave": "Whole vault",
"graph.local.depth": "Depth",
"graph.local.direction": "Links",
"graph.local.outbound": "outgoing",
"graph.local.inbound": "incoming",
"graph.local.both": "both",
"graph.group.label": "Colour by",
"graph.group.folder": "folder",
"graph.group.tag": "tag",
"graph.group.legend": "Colour legend",
"graph.filter.orphans": "Isolated notes",
"graph.filter.attachments": "Attachments",
"graph.refresh": "The vault changed · Refresh",
"graph.list.previous": "Previous page",
"graph.list.next": "Next page",
"graph.list.page": "Page {page} of {pages}",
"graph.time.pause": "Pause date filter",
"graph.conf.preset": "Personality",
"graph.conf.repulsione": "Repulsion",
"graph.conf.lunghezzaBase": "Spring length",
"graph.conf.rigiditaMolla": "Spring stiffness",
"graph.conf.smorzamentoMolla": "Damping",
"graph.conf.gravita": "Gravity",
"graph.conf.attrito": "Friction",
"graph.conf.maxVelocita": "Max speed",
"graph.conf.pesoGrado": "Degree weight",
"graph.conf.collisioni": "Collisions",
"graph.conf.theta": "Barnes-Hut opening",
"graph.conf.jitter": "Initial jitter",
"graph.conf.raffreddamento": "Cooling",
"graph.conf.glow": "Glow",
"graph.conf.pulse": "Pulse",
"graph.conf.trail": "Trails",
"graph.conf.griglia": "Grid",
"graph.conf.curvaturaArchi": "Edge curvature",
"graph.conf.densitaEtichette": "Label density",
"graph.conf.riscalda": "Reheat",
"graph.conf.sblocca": "Unpin nodes",
"graph.conf.reimposta": "Reset",
"graph.conf.apri": "Open graph settings",
"graph.conf.chiudi": "Close graph settings",
"graph.preset.organica": "Organic",
"graph.preset.costellazione": "Constellation",
"graph.preset.alveare": "Hive",
"graph.preset.nebulosa": "Nebula",
"graph.preset.rigido": "Rigid",
"graph.preset.custom": "Custom",
"name_fault.machine": "“.fub” and “.trash” are how the vault is made, not what it holds",
"name_fault.control": "it contains a control character",
"name_fault.reserved": "it contains a character a filesystem reserves (< > : \" | ? * \\)",
"name_fault.device": "it is a name Windows reserves (CON, NUL, COM1…)",
"name_fault.trailing_dot": "it cannot end with a dot or a space",
"name_fault.hidden": "it cannot start with a dot: the vault would not list the note",
"name_fault.too_long": "it is too long (255 bytes at most)",

"trouble.about": "{doc}: {reason}",
"trouble.vault": "{reason}",
// La porta del panico (§17.3, decisione 0161): quando il kernel sa dove è
// entrato il difetto, la notifica lo dice alla fine. Le frasi adattano
// quelle di `Gate::what` in crates/fub-abi/src/gate.rs, senza il dettaglio
// del punto.
"trouble.gate": " · via {gate}",
"gate.command": "running a command",
"gate.view_render": "drawing a view",
"gate.view_action": "reacting to a view action",
"gate.service": "serving a service",
"gate.event": "receiving an event",
"gate.index_feed": "indexing a batch of documents",
"gate.index_forget": "removing a batch of documents",
"gate.index_up_to_date": "saying what it already has",
"gate.index_reconcile": "reconciling",
"gate.format_parse": "parsing a document",
"gate.syntax_rule": "grafting onto the document",
"gate.custom_render": "drawing with a custom renderer",
"gate.job": "running a job",
"gate.index_query": "answering an index query",

"trash.confirm_delete": "Move «{doc}» to the trash?",
"trash.moved": "«{doc}» is in the trash.",
"trash.undo_failed": "The restore failed: {reason}",
"trash.delete_title": "Delete note",
"activity.title": "Activity",
"activity.hint": "The jobs in progress",
"activity.count": "Activity {count}",
"activity.none": "No job in progress.",
"activity.stale": "List not updated: {reason}",
"activity.retry": "Retry",
"activity.status": "In progress",
"activity.progress": "{done} of {total}",
"activity.stop": "Stop this job",
"activity.stop_failed": "I could not stop «{job}»: {reason}",
"activity.finished": "«{job}» is done.",
"activity.failed": "«{job}» failed: {reason}",
"activity.unknown_error": "Unknown error",
"notices.title": "Notices",
"notices.hint": "The recent notices",
"notices.clear": "Clear",
"notices.clear.hint": "Forget the notices",
"notices.count": "Notices {count}",
"notices.none": "No notice.",
"notices.more": "+{count} more",
"notices.dismiss": "Dismiss notice",
"notices.problem": "Problem",
"theme.rejected": "Theme «{theme}» rejected:",
"notices.open_problems": "Open problems: {count}",
"notices.watcher_off": "External change detection off: close and reopen the vault to reread",
"notices.toast": "Notice",

"settings.title": "Settings",
"settings.tabs": "Settings sections",
"settings.tab.config": "Configuration",
"settings.tab.components": "Components",
"settings.tab.vaults": "Vaults",
"settings.tab.shortcuts": "Shortcuts",
"settings.shortcuts_hint":
  "One row per command: the combination that runs it. `Mod` is Ctrl (Cmd on the Mac); you write it as `Mod-Shift-f`. There are three modifiers — `Mod`, `Shift`, `Alt` — and no others: a hand-written `Ctrl-k` is not honoured. A combination without modifiers is not honoured, because it would steal a letter from whoever is typing. A space separates two keys pressed one after the other: `Mod-k d` is a single shortcut.",
"settings.shortcuts.none": "No command declared.",
"settings.themes.title": "Installed themes",
"settings.themes.option": "{name} · {light}",
"settings.themes.light.dark": "dark",
"settings.themes.light.light": "light",
"settings.themes.source": "Installed themes: {ids}",
"settings.themes.preview_hint":
  "Choose a theme to preview it without saving. Apply makes it authoritative; Cancel restores the previous theme.",
"settings.themes.apply": "Apply theme",
"settings.themes.cancel_preview": "Cancel preview",
"settings.themes.preview_none": "No active preview.",
"settings.themes.preview_active": "Preview active: {theme}. The saved choice has not changed.",
"settings.themes.preview_failed": "Theme preview unavailable: {reason}",
"settings.vault_keys.title": "This vault proposes {count} shortcuts",
"settings.vault_keys.hint":
  "A vault carries its own shortcuts with it, and these come from outside: until you look at them they press nothing, and the combinations declared by the commands are what counts.",
"settings.vault_keys.adopt": "Use the vault's",
"settings.vault_keys.discard": "Keep mine",
"settings.vault_keys.discard.hint":
  "Takes them out of the vault's configuration file: nothing is left pending, and you will not be asked again next time.",
"settings.shortcuts.shell":
  "The commands of this window have a fixed combination: changing it means declaring them to the kernel, and the shell is not a component yet.",
"settings.group.other": "Other",
"settings.none": "No component declares settings.",
"settings.read_failed": "I cannot read: {reason}",
"settings.components_hint":
  "A component that is off unmounts at once and is not mounted again when the vault opens: it registers nothing, and its settings do not show up.",
"settings.components.bundled": "Included with Fub",
"settings.components.installed": "Installed on this machine",
"settings.components.installed.none": "No installed component.",
"settings.components.install": "Install a component",
"settings.components.install.hint":
  "Choose a .wasm file. Installing it does not enable it, grant consent, or run it.",
"settings.components.install.pick": "Choose file…",
"settings.components.install_failed": "Component not installed: {reason}",
"settings.components.identity": "{id} · version {version} · {trust}",
"settings.components.runtime.mounted": "Runtime status: running in this vault",
"settings.components.runtime.off": "Runtime status: not running",
"settings.components.enabled": "Enabled",
"settings.components.enabled.hint":
  "Persistent choice on this machine. The component can start only when consent is granted too.",
"settings.components.enabled_failed": "Enabled choice not changed: {reason}",
"settings.components.consent": "Consent to run",
"settings.components.consent.hint":
  "This is separate from enabling it: denied or undecided always prevent execution.",
"settings.components.consent.undecided": "Undecided",
"settings.components.consent.denied": "Denied",
"settings.components.consent.granted": "Granted",
"settings.components.consent_failed": "Consent not changed: {reason}",
"settings.components.permissions.hint":
  "Capabilities declared by the file. Granting consent approves them together; denied consent does not run the component.",
"settings.components.remove": "Remove",
"settings.components.remove.hint":
  "Removes the installation but preserves its data in the vault.",
"settings.components.remove.disabled": "Disable the component before removing it.",
"settings.components.remove.title": "Remove component",
"settings.components.remove.confirm":
  "Remove “{name}”? Data saved by the component in your vaults will be preserved.",
"settings.components.remove_failed": "Component not removed: {reason}",
"settings.components.reload_failed": "Component state not refreshed: {reason}",
"settings.permissions": "Permissions",
"settings.permissions.hint":
  "What this component has declared it wants to do. Taking one away has effect at once and survives switching the component off and on again; the component may stop working, and that is its side of the deal: to ask only for what it needs.",
"settings.permissions.none": "It asks for no permission.",
"settings.permissions.off_hint": "Switch the component on to see its permissions in detail.",
"settings.permission.grant": "Grant “{cosa}”",
"settings.permission.denied": "Denied by you",
"settings.permission_not_changed": "Permission not changed: {reason}",
"permission.read-vault": "It can read all your notes and the files you keep in the vault.",
"permission.write-vault":
  "It can change your notes: write them, create new ones, rename them and move them to the trash.",
"permission.network": "It can connect to the internet and send out what it reads.",
"permission.read-clipboard":
  "It can read the system clipboard: whatever you copied, from any application.",
"permission.write-clipboard": "It can copy text to the system clipboard.",
"permission.camera": "It can use the camera.",
"permission.microphone": "It can use the microphone.",
"permission.external-fs": "It can read and write files outside the vault.",
"permission.run-command": "It can run Fub's commands, including the ones that change your notes.",
"permission.call-service": "It can call the services the other components offer.",
"permission.write-settings":
  "It can change the settings that have declared themselves writable by a program.",
"permission.read-session": "It can know which note you are looking at, and in which mode.",
"permission.read-selection": "It can read the text you select, while you select it.",
"permission.read-drafts": "It can read what you are writing and have not saved yet.",
"permission.unknown":
  "This version of Fub does not know this permission: it grants nothing, and there is nothing to deny.",
"permission.network.anywhere": "to any address",
"permission.network.only": "only to: {hosts}",
"trust.core": "Part of Fub",
"trust.verified": "Verified",
"trust.community": "From the community",
"trust.development": "In development",
"trust.revoked": "Revoked: it does not run",
"settings.scope.machine": "this machine",
"settings.scope.vault": "this vault",
"settings.source.default": "default value · applies to {dove}",
"settings.source.machine": "chosen for this machine",
"settings.source.vault": "chosen for this vault",
"settings.reset": "Reset",
"settings.reset.hint": "Forget this choice: the default value applies again",
"settings.as_system": "Same as the system",
"settings.components.consent.confirm_title": "Grant permissions",
"settings.components.consent.confirm": "{name} will be able to:\n{permissions}\n\nPermissions can still be removed one by one afterwards.",
"settings.components.consent.grant": "Grant",
"settings.components.limited_on": "Plugin limited mode: {reason}",
"settings.components.limited_default": "execution disabled",
"settings.components.limited_off": "Plugin limited mode: off",
"settings.components.limited_unavailable": "Limited-mode status unavailable: {reason}",
"settings.components.budget": "WASM budget · {live} live · {calls} calls · {timeouts} timed out · {oom} out of memory",
"settings.components.budget_unavailable": "WASM budget unavailable: {reason}",
"settings.components.signed": "Signed by {key} · generation {generation} · publisher {publisher} · license {license} · compatible {compatible} · source {url}",
"settings.components.revoked": "Revoked: this component cannot mount.",
"settings.components.revoked_signed": "Revoked: this component cannot mount · signed by {key} at generation {generation}.",
"settings.shortcut.empty_alternative": "an alternative is empty",
"settings.shortcut.too_many": "too many alternatives",
"settings.shortcut.invalid_chord": "unrecognized chord",
"settings.shortcut.duplicate": "duplicate alternative",
"settings.shortcut.invalid_unsaved": "Invalid shortcut: {reason}. Nothing was saved.",
"settings.shortcut.invalid": "Invalid shortcut: {binding}",
"settings.shortcut.collision": "{chord} is also assigned to {commands}",
"settings.shortcut.shadowed": "{command} shadows {commands}",
"settings.group.reset": "Reset group",
"settings.group.reset.hint": "Reset the changed settings in “{group}” to their defaults",
"settings.group.reset.confirm": "Reset the changed settings in “{group}” ({count}) to their defaults?",
"settings.group.reset.ok": "Reset",
"settings.frame.unavailable": "Window frame options are unavailable: {reason}",
"settings.frame.reopen": "The new frame applies the next time this window opens.",
"settings.list.none": "No excluded folders.",
"settings.list.placeholder": "Folder name",
"settings.list.add": "Add",
"settings.list.remove": "Remove",
"settings.list.remove.hint": "Remove {folder} from excluded folders",
"settings.list.empty": "Enter a folder name.",
"settings.list.path": "Enter a folder name, not a path.",
"settings.list.structural": "{folder} is a structural folder and always remains excluded.",
"settings.list.duplicate": "{folder} is already in the list.",
"settings.off_choices": "{value} (outside the declared choices)",
"settings.not_changed": "Setting not changed: {reason}",
"settings.component_not_changed": "Component not changed: {reason}",
"settings.no_vaults": "No vault opened from this machine yet.",
"settings.open": "Open",
"settings.open_failed": "Vault not opened: {reason}",
"settings.unfavourite": "Remove from the favourites",
"settings.favourite": "Add to the favourites",
"settings.forget": "Forget",
"settings.forget.hint": "Removes it from the list: it does not touch the vault on disk",
"settings.registry_failed": "Vault registry: {reason}",
"settings.on": "on",
"settings.off": "off",
"settings.nothing": "nothing",
"settings.exported_clipboard": "Settings copied to the clipboard.",
"clipboard.copied": "Text copied to the clipboard.",
"base.lane.rename": "Rename lane",
"base.lane.taken": "A lane needs a new, non-empty name shorter than 256 characters",
"base.card.add": "+ Card",
"base.csv.copy": "Copy CSV",
"base.csv.export": "Export CSV",
"base.csv.copied": "CSV copied to the clipboard",
"base.map.zoom_in": "Zoom in on the map",
"base.map.zoom_out": "Zoom out of the map",
"base.lane.rename_named": "Rename {name}",
"base.lane.add_placeholder": "+ Lane",
"base.lane.add": "Create lane",
"base.map.label": "World map with markers",
"base.map.tiles_failed": "Online tiles unavailable: {reason}",
"base.map.offline": "Offline. Online tiles: {provider}",
"base.map.enable": "Enable online tiles",
"base.map.tiles_denied": "Online tiles unavailable: explicit network permission and trusted HTTPS host allowlist required",
"activity.artifact_invalid": "Export finished but its artifact report is invalid; no file was saved.",
"activity.artifact_saved": "Saved: {path}",
"activity.artifact_delivered": "Already delivered ({size} bytes)",
"activity.artifact_saving": "Opening native save dialog…",
"activity.artifact_failed": "Not saved: {reason}",
"activity.artifact_ready": "Ready to save",
"activity.artifact_save": "Save…",
"activity.artifact_cancelled": "Save cancelled; bytes are still available.",
"slides.close": "Close",
"markdown.image_missing": "Image not available: {name}",
"markdown.embed_cycle": "recursive embed",
"markdown.embed_too_deep": "embed nested too deeply",
"slides.title": "Presentation",
"slides.previous": "Previous slide",
"slides.next": "Next slide",
"slides.position": "Slide {index} of {count}",
"mobile.opened.sheet": "Action from another app",
"mobile.opened.title": "Capture title",
"mobile.opened.body": "Text to capture",
"mobile.opened.approve": "Confirm",
"mobile.opened.dismiss": "Reject",
"mobile.opened.action": "External action: {action}",
"mobile.opened.action_vault": "External action: {action} · vault {vault}",
"mobile.opened.folder_registered": "Folder registered; check access before mounting",
"mobile.storage.heading": "Mobile storage",
"mobile.storage.private": "Use private space (removed on uninstall)",
"mobile.storage.shared": "Use shared folder",
"mobile.storage.copy": "Copy into private space (only on confirmation)",
"mobile.storage.not_connected": "Mobile mount not connected to the Host",
"mobile.storage.choose": "Explicitly choose private space or a shared folder",
"mobile.storage.shared_unavailable": "A shared folder needs native permission verification, which is not available here yet: use the private space",
"mobile.wasm.backend": "WASM configured: {requested}; active: {active}",
"mobile.wasm.not_started": "not started",
"rail.order_failed": "Could not save side rail order: {reason}",
"rail.hidden_failed": "Could not remember the hidden side rail icons: {reason}",
"shell.chrome_failed": "Machine chrome: {reason}",
"shell.zoom_now": "Zoom: {percent}%",
"shell.zoom_failed": "The zoom did not change: {reason}",
"shell.focus_on": "Focus mode: the same command brings the panels back.",
"explorer.create_failed": "The note was not created: {reason}",
"tabmenu.pin": "Pin tab",
"tabmenu.unpin": "Unpin tab",
"tabmenu.left": "Move left",
"tabmenu.right": "Move right",
"tabmenu.to_pane": "Move to pane {pane}",
"tabmenu.to_stack": "Add to stack {stack}",
"tabmenu.new_stack": "New stack…",
"tabmenu.stack_name": "Stack name",
"tabmenu.leave_stack": "Remove from stack",
"tabmenu.close_others": "Close others (keeps pinned)",
"tabmenu.close": "Close",
"tabmenu.close_right": "Close tabs to the right",
"tabmenu.split_right": "Open in a pane to the right",
"tabmenu.new_window": "Open in a new window",
"tabmenu.copy_path": "Copy path",
"tabmenu.path_copied": "Path copied: {path}",
"tabmenu.copy_failed": "Could not copy to the clipboard.",
"tabmenu.close_unpinned": "Close unpinned",
"tabmenu.pinned": "Pinned",
"tabmenu.stack": "Stack {stack}",
"document.attachment_failed": "Attachment deposit failed: {reason}",
"document.viewer_unavailable": "Isolated viewer unavailable: {reason}",
"document.properties_unavailable": "Note properties unavailable: {reason}",
"document.recorder_unavailable": "Recorder unavailable: {reason}",
"document.slides_unavailable": "Slides unavailable: {reason}",
"document.print_unavailable": "Print unavailable: {reason}",
"document.reveal_unavailable": "This view of {doc} cannot go to that point.",
"media.open_external": "Open externally",
"media.open_external_failed": "Could not open externally: {reason}",
"media.loading": "Loading {id}…",
"media.pdf.unavailable": "PDF preview unavailable (requires a local pdfjs-dist {version} loader). The file {id} ({mime}) is intact.",
"media.pdf.page_failed": "PDF page failed: {reason}",
"media.pdf.search": "Search in PDF…",
"media.pdf.no_matches": "No matches for “{needle}”",
"media.pdf.matches": "Matches: {count}, the first on page {page}",
"media.pdf.search_failed": "PDF search failed: {reason}",
"media.pdf.copy_link": "Copy page link",
"media.pdf.no_engine": "PDF engine not loaded.",
"media.pdf.empty": "PDF {id} is empty.",
"media.pdf.page": "Page {page} of {count}",
"media.pdf.failed": "The PDF did not respond: {reason}",
"media.player.empty": "Empty file: no bytes to play.",
"media.player.undecodable": "This browser cannot decode {mime}. The file is intact; try the external application.",
"media.image.undecodable": "Cannot decode image {name} ({mime}, {size} bytes). The file remains intact.",
"media.recorder.stop": "Stop and save",
"media.recorder.saving": "Saving recorded audio…",
"media.recorder.saved": "Audio saved at {id}",
"media.recorder.saved_no_embed": "Audio saved at {id}, but the embed could not be inserted: {reason}",
"media.recorder.saved_no_recovery": "Audio saved at {id}; recovery list unavailable: {reason}",
"media.recorder.staged": "Recording remains staged (or needs cleanup): {reason}",
"media.recorder.recover": "Recover recording ({size} bytes)",
"media.recorder.recoverable": "Recording remains recoverable: {reason}",
"media.recorder.recovery_unavailable": "Recovery unavailable: {reason}",
"settings.css.hint": "Local-user CSS only. Preview is temporary; selectors and assets pass the CSS sanitizer.",
"settings.css.trust": "Trust: local user. Preview is never saved automatically.",
"settings.css.preview": "Preview sanitized CSS",
"settings.css.preview_active": "Preview active. Save or cancel before leaving settings.",
"settings.css.rejected": "CSS rejected: {reason}",
"settings.css.cancel_preview": "Cancel preview",
"settings.css.preview_cancelled": "Preview cancelled; saved CSS restored.",
"settings.css.save": "Save sanitized CSS",
"settings.css.not_saved": "CSS not saved: {reason}",
"settings.css.snippet_on": "{id} · enabled · trust: local user",
"settings.css.snippet_off": "{id} · disabled · trust: local user",
"settings.css.disable": "Disable {id}",
"settings.css.needs_repair": "Stored CSS needs repair: {reason}",
"settings.profiles.machine": "Machine settings profiles",
"settings.profiles.vault": "Vault settings profiles",
"settings.profiles.unavailable": "Profiles unavailable: {reason}",
"settings.profiles.choice": "Profile",
"settings.profiles.new_name": "New profile name",
"settings.profiles.json_placeholder": "Paste a complete profile JSON document to import",
"settings.profiles.json": "Profile JSON",
"settings.profiles.hint": "Profiles preserve unknown JSON keys and values. Export before resetting.",
"settings.profiles.saved": "Profile change saved.",
"settings.profiles.not_changed": "Profile not changed: {reason}",
"settings.profiles.frame_hint": "Switching profiles may alter the native frame; reopen this window to apply frame changes.",
"settings.profiles.switch": "Switch profile",
"settings.profiles.duplicate": "Duplicate selected profile",
"settings.profiles.name_required": "Enter a new profile name.",
"settings.profiles.export": "Export selected profile as JSON",
"settings.profiles.exported": "Exported JSON is ready to copy; no file was written.",
"settings.profiles.import": "Import pasted profile JSON",
"settings.profiles.json_required": "Paste a profile JSON document.",
"settings.profiles.reset": "Reset selected profile",
"settings.profiles.reset_confirm": "Reset declared values in {profile}? Export first to undo this change; unknown values survive.",
"settings.profiles.reset_title": "Reset settings profile",
"settings.profiles.reset_ok": "Reset profile",
"settings.profiles.reset_cancelled": "Reset cancelled: {reason}",
"settings.shortcuts.filter_placeholder": "Filter shortcuts by command, ID or key",
"settings.shortcuts.filter": "Filter shortcuts",
"settings.catalog.title": "Verified catalog",
"settings.catalog.hint": "Search requires a native signed feed and configured trust root. No downloads or installations happen without your explicit choice.",
"settings.catalog.search_placeholder": "Search catalog by name, publisher or license",
"settings.catalog.search": "Catalog search",
"settings.catalog.run": "Search signed catalog",
"settings.catalog.checking": "Checking signed catalog…",
"settings.catalog.count": "Verified catalog entries: {count}.",
"settings.catalog.unavailable": "Catalog unavailable: {reason}",
"settings.catalog.provenance": "Publisher: {publisher} · License: {license} · Compatibility: {compatible}",
"settings.catalog.digest": "Digest: {digest} · Size: {size} bytes · ABI: {abi}",
"settings.catalog.revoked": "Signed revocation: this release cannot be mounted.",
"settings.catalog.permissions": "Permissions: {permissions}",
"settings.catalog.no_permissions": "none",
"settings.catalog.confirm": "{action} {name} ({version})? Signed publisher: {publisher}. License: {license}. Digest: {digest}.",
"settings.catalog.confirm_revoked": "{action} {name} ({version})? Signed publisher: {publisher}. License: {license}. Digest: {digest}. This release is revoked.",
"settings.catalog.failed": "Catalog action failed: {reason}",
"settings.catalog.install": "Install release",
"settings.catalog.update": "Update release",
"settings.catalog.rollback": "Rollback to release",
"settings.catalog.install_theme": "Install theme release",
"settings.catalog.update_theme": "Update theme release",
"settings.catalog.rollback_theme": "Rollback theme release",
"settings.catalog.revoke": "Revoke installed release",
"settings.catalog.revoke_theme": "Revoke installed theme",
"pane.recorder.open": "Record audio",
"pane.recorder.close": "Close recorder",
"pane.slides": "Present slides",
"pane.print": "Print document",
"search.fault": "{reason} (column {column}).",
"search.fault.unclosed_quote": "An opening quote is not closed",
"search.fault.unclosed_regex": "A /…/ regular expression is not closed",
"search.fault.unclosed_property": "A […] property filter is not closed",
"search.fault.unclosed_group": "An opening parenthesis is not closed",
"search.fault.unexpected_close": "A closing parenthesis has no opening one",
"search.fault.dangling_or": "OR needs a search on both sides",
"search.fault.empty_value": "An operator or property has no value",
"search.fault.bad_value": "The value is not valid for this operator",
"search.fault.negated_group": "A parenthesized group cannot be negated: negate the single terms",
"search.fault.too_complex": "The search has too many alternatives once groups are expanded",
"vault.restored": "Vault restored from the snapshot. The previous state is in the chosen backup.",
"clipboard.failed": "Cannot write to the clipboard: the system does not allow it.",
"settings.exported_console": "Settings exported: they are in the console (clipboard unavailable).",

"icons.choose": "Choose an icon",
"icons.any": "Any emoji…",
"icons.none": "No icon",
"palette.title": "Commands",
"commands.conflict": "«{chord}» is the shortcut of more than one command: {commands}.",
"commands.shadowed":
  "«{chord}» is already a command on its own ({command}): shortcuts starting there cannot be pressed ({commands}).",
"commands.rejected":
  "«{chord}» is not a shortcut that can be pressed ({command}): the first key must carry Mod, Shift or Alt.",
"keys.pending": "{chord}…",
"commands.mode.reading": "Toggle Reading and writing",
"commands.mode.reading.desc": "Show the rendered note, without the editor; again, go back to the previous writing mode.",
"commands.mode.live": "Switch to Live",
"commands.mode.live.desc": "Show the note as text, with the live preview.",
"commands.mode.source": "Switch to Source",
"commands.mode.source.desc": "Show the Markdown as written, with nothing rendered.",
"commands.doc.save": "Save now",
"commands.doc.save.desc": "Writes the queued changes right away; after a failed save it retries.",
"document.save_now_failed": "{doc} could not be saved: the text stays in the buffer and in the draft. Retry with Save now.",
"commands.tab.reopen": "Reopen closed tab",
"commands.tab.reopen.desc": "Reopens the last closed tab, where it was.",
"commands.tab.next": "Next tab",
"commands.tab.next.desc": "Moves to the tab on the right, wrapping around.",
"commands.tab.previous": "Previous tab",
"commands.tab.previous.desc": "Moves to the tab on the left, wrapping around.",
"commands.sidebar.toggle": "Toggle sidebar",
"commands.sidebar.toggle.desc": "Opens or closes files and search; in a narrow window as a drawer.",
"commands.inspector.toggle": "Toggle inspector",
"commands.inspector.toggle.desc": "Opens or closes outline, links and properties.",
"commands.settings": "Open settings",
"commands.settings.desc": "Opens the settings panel.",
"commands.note.new": "New note",
"commands.note.new.desc": "Creates a note in the active space and opens it.",
"commands.zoom.in": "Zoom in",
"commands.zoom.in.desc": "Enlarges the interface by one step.",
"commands.zoom.out": "Zoom out",
"commands.zoom.out.desc": "Shrinks the interface by one step.",
"commands.zoom.reset": "Actual size",
"commands.zoom.reset.desc": "Resets the zoom to 100%.",
"commands.focus.toggle": "Focus mode",
"commands.focus.toggle.desc": "Hides sidebar, rail and inspector to write without chrome.",
"commands.pane.split.right": "Split the pane to the right",
"commands.pane.split.right.desc":
  "Opens the same note in a pane alongside, to look at two of them together.",
"commands.pane.split.down": "Split the pane downwards",
"commands.pane.split.down.desc": "Opens the same note in a pane below this one.",
"commands.pane.close": "Close the pane",
"commands.pane.close.desc": "Removes this pane; the last one does not close.",
"commands.tab.close": "Close the tab",
"commands.tab.close.desc": "Removes the note from this pane, saving it if needed.",
"document.tab.close": "Close {doc}",
"document.tab.list": "Tab list",
"document.toolbar.modes": "Pane modes",
"document.pane.menu": "Pane actions",
"document.conflict.title": "Conflict on {doc}",
"document.conflict.body": "The file changed on disk. Choose which text to keep: nothing is automatic.",
"document.conflict.keep_mine": "Keep my text",
"document.conflict.use_disk": "Use the version on disk",
"document.conflict.cancel": "Decide later",
"document.conflict.compare": "Compare",
"document.conflict.compare_title": "{doc}: your text and the one on disk",
"document.conflict.pending": "Conflict on {doc}: the choice is waiting, nothing was written.",
"document.conflict.resume": "Choose now",
"compare.legend": "Lines marked − exist only on disk, lines marked + only in your text.",
"compare.mine": "Only in your text",
"compare.theirs": "Only on disk",
"commands.doc.conflict.mine": "Conflict: keep my text",
"commands.doc.conflict.mine.desc":
  "Rewrites the file with the buffer text, covering the change that arrived from outside.",
"commands.doc.conflict.theirs": "Conflict: keep the text on disk",
"commands.doc.conflict.theirs.desc":
  "Discards the unsaved changes and reloads the file as it is on disk.",
"panes.redraw_failed": "The panes did not redraw: {reason}",
"pane.named": "Pane: {name}",
"pane.resize": "Resize panes (arrow keys; double-click for equal parts)",
"pane.empty": "Empty pane",
"pane.empty.title": "No note open in this pane.",
"pane.empty.open": "Open a note",
"commands.panel.files": "Show files",
"commands.panel.files.desc": "Bring the vault tree into the sidebar.",
"commands.explorer.reveal": "Reveal the active note in the tree",
"commands.explorer.reveal.desc": "Opens the folders that contain it and scrolls the file tree to it.",
"commands.explorer.rename": "Rename in the tree",
"commands.explorer.rename.desc": "Opens the name field on the focused tree entry, or on the active note. Links that name it follow the new name.",
"commands.explorer.trash": "Move to trash from the tree",
"commands.explorer.trash.desc": "Trashes the focused tree entry, or the active note. It can be restored from the trash.",
"commands.panel.search": "Show search",
"commands.panel.search.desc": "Bring the search results into the sidebar.",
"commands.vault.open": "Open a vault…",
"commands.vault.open.desc": "Pick a folder and open it as a vault.",
"commands.palette": "Open the command palette",
"commands.palette.desc": "Search among all commands and run one.",
"palette.placeholder": "Command…",
"palette.empty": "No command",
"palette.unavailable": "The vault commands do not answer ({reason}): the palette shows the ones already known.",
"palette.open_view": "Open the {title} view",
"palette.open_view.desc": "Opens the view in the focused pane",
"palette.preview": "Preview…",
"palette.apply": "Apply",
"palette.required": "{title} *",
"palette.docs_placeholder": "one id per line (empty = the whole vault)",
"palette.numbers_placeholder": "one number per line",
"palette.reach.session": "this session",
"palette.reach.document": "one note",
"palette.reach.documents": "several notes",
"palette.reach.vault": "the vault",
"palette.reach.settings": "the settings",
"palette.reads": "reads · {dove}",
"palette.writes": "writes · {dove}",
"palette.irreversible": "{cosa} · not reversible",
"palette.plan_edits": "{doc} — Edits: {count}",
"palette.docs_limited": "Suggestions limited to the first {count}: type the full name or use Go to note",
"panel.render_failed": "The panel «{panel}» did not redraw: {reason}",
"document.overwritten":
  "{doc} was changed by another application while you had unsaved changes: nothing was overwritten, and at the next save you will choose which text to keep.",
"document.changed_on_disk": "{doc} changed on disk while you had unsaved changes: yours stay, and when saving you will choose which text to keep.",
"document.deleted_dirty":
  "{doc} was deleted from outside while you had unsaved changes: the text is kept as a draft. You can recreate it now or recover it at the next start.",
"document.recreate": "Recreate the note",
"document.save_failed": "{doc} was not saved: {reason}",
"document.close_unhooked":
  "Fub cannot listen for the window closing: use «Save now» before you close, because the last keystroke may not be on disk yet.",
"document.close_failed": "Close cancelled: {reason}. Documents remain open.",
"document.unsaved_blocks":
  "{doc} is not on disk: the operation stops here, because moving the file would leave the unsaved text behind.",
"document.save_conflict":
  "{doc} changed on disk since you opened it: nothing was written, and your edits are still here. Choose which text to keep in the bar above the note.",
"document.conflict_none": "No conflict to resolve for this document.",
"document.reload_failed": "{doc} could not be reread from disk: its text and state are unchanged.",
"document.close_unsaved.title": "Unsaved changes",
"document.close_unsaved": "“{doc}” could not be saved. Discard the changes, or keep it open to try again?",
"document.close_unsaved.discard": "Discard changes",
"document.close_unsaved.keep": "Keep it open",
"preview.open_failed": "Cannot open “{page}”: {reason}",
"preview.target_missing": "The destination document does not exist.",
"mermaid.diagram": "Mermaid diagram",
"mermaid.links": "Diagram links",
"mermaid.source": "Diagram source",
"mermaid.edit": "Open source",
"mermaid.loading": "Rendering diagram…",
"mermaid.error": "Diagram unavailable: {reason}",
"mermaid.too_large": "The diagram exceeds the limit of {limit} characters.",
"mermaid.image_failed": "The diagram image could not be displayed.",
"kernel.listener_failed": "A kernel event listener threw: {reason}",
"store.listener_failed": "A listener of «{signal}» threw: {reason}",
"state.not_remembered": "Could not remember how you left the panels.",
"organization.unreadable":
  "The vault organization cannot be read ({reason}): icons, pins and ordering of this session will not be saved.",
"organization.not_saved": "Organization not saved: {reason}",
"views.surface_missing":
  "The view «{view}» asks for the «{surface}» surface, which this shell does not host: {reason}.",
"views.open_unavailable": "The view «{view}» does not open in a pane",
"views.action_failed":
  "The «{action}» action did not go through ({reason}): what you see is from before.",
"commands.list_failed":
  "The command list did not arrive ({reason}): the palette is empty and the declared shortcuts do not respond.",
"vault.partial":
  "{count} notes could not be read while opening: search does not find them and the graph does not link them.",
"vault.partial.one":
  "One note could not be read while opening: search does not find it and the graph does not link it.",

"draft.found":
  "{count} notes had unsaved text: it has been put back. Where the file changed in the meantime, or the note is gone, you will choose which text to keep.",
"draft.found.one":
  "One note had unsaved text: it has been put back. If the file changed in the meantime, or the note is gone, you will choose which text to keep.",
"draft.case.superata": "The file already contains this text.",
"draft.case.nuova": "This note was never saved: the draft is all there is.",
"draft.case.orfana":
  "The note was deleted while this text was still in the editor: recovering it would bring the note back.",
"draft.case.intatta":
  "The file has not changed since you started this text: it is the unsaved copy to recover.",
"draft.case.divergente":
  "The file changed after this text diverged from it: keeping one loses the other.",
"draft.case.incerta":
  "It is not known which version of the file this text started from: look at both before choosing.",
"draft.blind":
  "Unsaved text no longer reaches the disk: from now on a crash would lose it. Use «Save now» for whatever you do not want to risk.",

"save.saved": "Saved",
"save.saving": "Saving…",
"save.unsaved": "Unsaved",
"save.failed": "Save failed",
"save.conflitto": "Changed on disk",
  "bookmarks.title": "Bookmarks",
  "bookmarks.save_tabs": "Save tabs",
  "bookmarks.save_tabs_hint": "Save all tabs in this pane as a bookmark.",
  "bookmarks.add": "Add bookmark",
  "bookmarks.add_hint": "Add a file, heading, block, search, view, workspace or folder",
  "bookmarks.type.file": "File",
  "bookmarks.type.heading": "Heading",
  "bookmarks.type.block": "Block",
  "bookmarks.type.search": "Search",
  "bookmarks.type.view": "View",
  "bookmarks.type.workspace": "Workspace",
  "bookmarks.type.folder": "Folder",
  "bookmarks.name_title": "Bookmark name",
  "bookmarks.default_tabs": "Open tabs",
  "bookmarks.save_failed": "Could not save the bookmark.",
  "bookmarks.new_group": "New group",
  "bookmarks.future": "The bookmarks use unsupported version {version}.",
  "bookmarks.corrupt": "The bookmarks cannot be read. The original content is not replaced.",
  "bookmarks.rename": "Rename",
  "bookmarks.rename_title": "New name",
  "bookmarks.delete": "Remove",
  "bookmarks.delete_group_confirm": "Remove the group “{title}”?",
  "bookmarks.delete_confirm": "Remove the bookmark “{title}”?",
  "bookmarks.empty": "There are no bookmarks.",
  "bookmarks.open": "Open",
  "bookmarks.move_up": "Move up",
  "bookmarks.move_down": "Move down",
  "bookmarks.assign_group": "Assign to a group",
  "bookmarks.assign_title": "Choose the group number:\n{groups}",
  "bookmarks.group_title": "Group name",
"bookmarks.group_filter": "Filter groups",
"bookmarks.tabs_count": "{count} tabs",
  "bookmarks.group_failed": "Could not create the group.",
  "bookmarks.saved": "Bookmark saved.",
  "workspaces.title": "Saved workspaces",
  "workspaces.save": "Save workspace",
  "workspaces.future": "The workspace list uses unsupported version {version}.",
  "workspaces.corrupt": "The workspace list cannot be read. The original content is not replaced.",
  "workspaces.empty": "There are no saved workspaces.",
  "workspaces.load": "Load",
  "workspaces.update": "Update from the current layout",
  "workspaces.rename": "Rename",
  "workspaces.rename_title": "New workspace name",
  "workspaces.rename_failed": "Could not rename the workspace.",
  "workspaces.delete": "Delete workspace",
  "workspaces.delete_confirm": "Delete workspace “{name}”? The documents remain in the vault.",
  "workspaces.delete_failed": "Could not delete the workspace.",
  "workspaces.save_title": "Workspace name",
"workspaces.summary": "{panes} panes · {tabs} tabs",
  "workspaces.save_failed": "Could not save the workspace.",
  "workspaces.saved": "Workspace saved.",
  "workspaces.update_failed": "Could not update the workspace.",
  "workspaces.updated": "Workspace updated.",
  "workspaces.missing": "The workspace is no longer available.",
  "workspaces.report_missing": "Missing documents: {docs}",
  "workspaces.report_views": "Unavailable views: {views}",
  "workspaces.applied": "Workspace loaded.",
  "workspaces.applied_partial": "Workspace loaded with unavailable items. Documents: {missing}. Views: {views}.",
  "windows.unavailable": "Separate windows are not available in this client.",
  "windows.open_failed": "Could not open the window: {reason}",
  "windows.drain_failed": "The window for {doc} cannot be closed: {reason}",
  "windows.drain_dirty": "{doc} still has unsaved changes. The window stays open.",
  "windows.drain_conflict": "{doc} conflicts with the file on disk. Resolve the conflict before closing.",
  "windows.invalid_request": "This window does not have a valid document.",
  "windows.local_error": "Local changes retained in this window: {reason}",
  "windows.saving": "Saving changes…",
  "windows.keep_local": "Keep my changes",
  "windows.discard_local": "Discard local changes",
  "windows.not_text": "{doc} does not open in a separate window: the window shows only notes and text files.",
  "windows.error.session_gone": "The document session is no longer available",
  "windows.error.bad_identity": "The window identity is not valid",
  "windows.error.closed_while_opening": "The window disconnected while opening; the session is kept",
  "windows.error.owner_changed": "The document changed hands: the session is kept",
  "windows.error.owner_changed_saving": "The document changed hands while saving",
  "windows.error.changed_closing": "The document changed while closing: the session is kept",
  "windows.error.disconnected": "The window disconnected before confirming its last changes; the session is kept",
  "windows.error.session_changed": "The session or the vault changed: the window stays",
  "windows.error.changed_draining": "The session changed while the window was being drained",
  "windows.error.still_opening": "The window is still opening",
  "windows.error.destroy_unconfirmed": "The window was not confirmed destroyed",
  "windows.error.close_event_missing": "The native close event did not arrive",
  "windows.error.close_incomplete": "The native close did not complete",
  "windows.error.save_unconfirmed": "The save was not confirmed",
  "windows.error.save_unconfirmed_doc": "The save was not confirmed: {doc}",
  "windows.error.changed_draining_doc": "The document changed while the window was being drained: {doc}",
  "mode.canvas": "Canvas",
  "canvas.surface": "Canvas",
  "canvas.add_text": "Add text",
  "canvas.add_file": "Add file",
  "canvas.pick_file": "Choose the card's file",
  "canvas.pick_file_filter": "Filter by name or path",
  "canvas.add_link": "Add web page",
  "canvas.add_group": "Add group",
  "canvas.duplicate": "Duplicate selection",
  "canvas.delete": "Delete selection",
  "canvas.bring_front": "Bring to front",
  "canvas.send_back": "Send to back",
  "canvas.fit": "Fit canvas",
  "canvas.zoom_in": "Zoom in",
  "canvas.zoom_out": "Zoom out",
  "canvas.connect": "Connect card {id}",
  "canvas.empty_text": "Empty card",
  "canvas.open_url": "Open web page",
  "canvas.ungrouped": "Unnamed group",
  "canvas.edit_text": "Edit the text of card {id}",
  "canvas.fit_selection": "Fit selection",
  "canvas.align_left": "Align left",
  "canvas.align_center": "Align center",
  "canvas.align_right": "Align right",
  "canvas.align_top": "Align top",
  "canvas.align_middle": "Align middle",
  "canvas.align_bottom": "Align bottom",
  "canvas.distribute_x": "Distribute horizontally",
  "canvas.distribute_y": "Distribute vertically",
  "canvas.select_edge": "Select edge",
  "canvas.default": "Default",
  "canvas.node_color": "Node color",
  "canvas.node_color_hex": "Node color hex",
  "canvas.edge_color": "Edge color",
  "canvas.edge_color_hex": "Edge color hex",
  "canvas.edge_label": "Edge label",
  "canvas.edge_from_node": "From node",
  "canvas.edge_to_node": "To node",
  "canvas.edge_from_side": "From side",
  "canvas.edge_to_side": "To side",
  "canvas.edge_from_end": "From end",
  "canvas.edge_to_end": "To end",
  "canvas.convert_note": "Convert to note",
  "canvas.too_large": "Canvas exceeds the interactive limit; use Source mode.",
  "publish.title": "Publish",
  "publish.dry_run": "Preview publication",
  "publish.commit": "Publish",
  "publish.unpublish": "Unpublish",
  "publish.rollback": "Restore a publication",
  "publish.no_preview": "Prepare a preview before publishing.",
  "publish.command_ok": "Operation requested: {command}",
  "publish.command_failed": "Operation {command} failed: {reason}",
  "commands.tab.pin": "Pin tab",
  "commands.tab.pin.desc": "Keeps this tab open when closing tabs in bulk.",
  "commands.tab.unpin": "Unpin tab",
  "commands.tab.unpin.desc": "Removes this tab’s protection from bulk closing.",
  "commands.tab.move.left": "Move tab left",
  "commands.tab.move.left.desc": "Moves this tab before the previous one.",
  "commands.tab.move.right": "Move tab right",
  "commands.tab.move.right.desc": "Moves this tab after the next one.",
  "commands.tab.move.pane.previous": "Move tab to previous pane",
  "commands.tab.move.pane.previous.desc": "Moves this tab into the pane before this one; from the first it wraps to the last.",
  "commands.tab.move.pane.next": "Move tab to next pane",
  "commands.tab.move.pane.next.desc": "Moves this tab into the pane after this one; from the last it wraps to the first.",
  "commands.tab.close.others": "Close other tabs",
  "commands.tab.close.others.desc": "Closes the other tabs in this pane after saving changes.",
  "commands.tab.close.unpinned": "Close unpinned tabs",
  "commands.tab.close.unpinned.desc": "Closes unpinned tabs after saving changes.",
  "commands.pane.back": "Go back in pane",
  "commands.pane.back.desc": "Returns to the previous destination in this pane’s history.",
  "commands.pane.forward": "Go forward in pane",
  "commands.pane.forward.desc": "Moves to the next destination in this pane’s history.",
  "commands.pane.link": "Link pane",
  "commands.pane.link.desc": "Links this pane’s navigation to the other linked panes.",
  "commands.pane.unlink": "Unlink pane",
  "commands.pane.unlink.desc": "Makes this pane’s navigation independent.",
  "commands.bookmarks.toggle": "Toggle bookmarks",
  "commands.bookmarks.toggle.desc": "Opens or closes the bookmarks panel.",
  "commands.bookmarks.save": "Bookmark note",
  "commands.bookmarks.save.desc": "Adds a bookmark for the current note.",
  "commands.bookmarks.group": "Create bookmark group",
  "commands.bookmarks.group.desc": "Organizes bookmarks under a chosen name.",
  "commands.bookmarks.open": "Open bookmarks",
  "commands.bookmarks.open.desc": "Shows saved bookmarks.",
  "commands.workspace.toggle": "Toggle workspaces",
  "commands.workspace.toggle.desc": "Opens or closes the saved workspaces panel.",
  "commands.workspace.save": "Save workspace",
  "commands.workspace.save.desc": "Saves the current layout under a name.",
  "commands.workspace.load": "Load workspace",
  "commands.workspace.load.desc": "Chooses a saved layout to restore.",
  "commands.workspace.update": "Update workspace",
  "commands.workspace.update.desc": "Replaces the saved layout of the current workspace.",
  "commands.workspace.rename": "Rename workspace",
  "commands.workspace.rename.desc": "Changes the current workspace’s name.",
  "commands.workspace.delete": "Delete workspace",
  "commands.workspace.delete.desc": "Removes the saved layout, not the documents.",
  "commands.preview.show": "Show preview",
  "commands.preview.show.desc": "Opens a preview of the current note without editing it.",
  "commands.preview.hide": "Close preview",
  "commands.preview.hide.desc": "Closes the open preview."
};

/// La lingua di ripiego di questa shell, che è quella in cui è scritto.
const FALLBACK = "it";

const CATALOGS: Record<string, Record<string, string>> = { it: IT, en: EN };

/// La chiave dell'impostazione della lingua. La stessa stringa sta in
/// `fub-kernel/src/locale.rs`, come `CHIAVE_TEMA` sta in
/// `fub-host/src/settings.rs` — e per la stessa ragione: una shell in
/// TypeScript non importa una costante Rust.
export const LANGUAGE_KEY = "locale.language";

/// Le lingue in cui la shell sa parlare, cioè quelle che vale la pena offrire
/// nel pannello: una lingua senza catalogo ricadrebbe sull'italiano.
export function catalogLanguages(): string[] {
  return Object.keys(CATALOGS);
}

/// Dove la shell ricorda l'ultima **scelta** di lingua.
///
/// Stesso mestiere della cache del tema, e stesso buco dichiarato: le
/// impostazioni si leggono dal canale dati, che vuole un vault aperto, e al
/// primo fotogramma non c'è niente da leggere. Ricordare la *scelta* e non la
/// lingua risolta è ciò che fa ripartire chi ha lasciato «come il sistema»
/// seguendo il sistema di **oggi**.
const CACHE = "fub.locale.language";

/// La scelta corrente, così com'è scritto nell'impostazione.
let choice = "";

/// Il proprietario di una rilettura asincrona. La generazione rende vecchia
/// ogni richiesta precedente; `active` impedisce a una risposta che arriva dopo
/// lo smontaggio di cambiare una finestra già rimontata.
type RereadOwner = {
  active: boolean;
  generation: number;
};

/// Chi va avvisato quando la lingua cambia: chi ha già disegnato del testo.
type LanguageRegistration = { listener: () => void };
const listeners: LanguageRegistration[] = [];

/// La lingua che vale, date la scelta e quella del sistema.
///
/// Gemella di `temaEffettivo`, e con la stessa regola per i valori strani: la
/// stringa vuota è «come il sistema» (la convenzione delle chiavi `locale.*`), e
/// lo è anche qualunque cosa non sia una stringa — un `settings.json` scritto a
/// mano non deve poter spegnere le stringhe.
export function effectiveLanguage(choice: unknown, systemLanguage: string): string {
  return typeof choice === "string" && choice.trim() !== "" ? choice.trim() : systemLanguage;
}

/// Il catalogo da cui pescare, per una lingua: la scala della 0040, i primi tre
/// gradini. Il quarto — la chiave nuda — lo fa `t`, perché è l'assenza di un
/// catalogo e non un catalogo.
export function catalogFor(language: string): Record<string, string> {
  return CATALOGS[catalogLanguage(language)]!;
}

/// La lingua del catalogo che serve davvero una lingua chiesta. Il ripiego è
/// lo stesso del contratto (`Strings::template`): la lingua di default dei
/// manifest del core, così shell e provider non parlano due lingue diverse.
export function catalogLanguage(language: string): string {
  const lower = language.toLowerCase();
  const base = lower.split(/[-_]/)[0] ?? "";
  if (CATALOGS[lower]) return lower;
  if (CATALOGS[base]) return base;
  return FALLBACK;
}

/// La lingua in cui la shell sta parlando adesso, per `lang` e per formattare
/// date e numeri accanto al testo: quella chiesta se il catalogo è il suo
/// (`it-IT` resta `it-IT`), quella del catalogo se è caduta sul ripiego.
export function resolvedLanguage(): string {
  const requested = languageCurrent();
  const catalog = catalogLanguage(requested);
  return requested.toLowerCase().split(/[-_]/)[0] === catalog ? requested : catalog;
}

/// La lingua corrente. Fuori da un browser (i test) `navigator` può non esserci.
function languageCurrent(): string {
  const systemLanguage = typeof navigator === "undefined" ? FALLBACK : navigator.language || FALLBACK;
  return effectiveLanguage(choice, systemLanguage);
}

/// Allinea il documento al testo che `t()` sta per restituire. Non si usa un
/// valore fermo in `index.html`: dopo un cambio di lingua anche i lettori che
/// non guardano una regione devono ricevere la lingua della pagina.
function applyDocumentLanguage(): void {
  if (typeof document === "undefined" || !document.documentElement) return;
  // La lingua del testo che si legge, non quella chiesta: con il sistema in
  // francese il testo è inglese, e va letto con la voce inglese.
  document.documentElement.lang = resolvedLanguage();
}

/// Sostituisce `{nome}` con l'argomento che si chiama così.
///
/// Le stesse regole del motore del contratto (`fub_abi::text::expand`), e non
/// per simmetria: una graffa raddoppiata è letterale (serve a scrivere
/// `{{"chiave": valore}}`), e un nome senza argomento **resta a vista** invece
/// di sparire — una frase con un buco si nota, una frase a cui manca una parola
/// no.
///
/// I due motori sono la sola coppia che il repo dichiarava gemella senza che
/// niente la tenesse tale, e divergevano già: di là un nome è **tutto ciò che
/// precede la prima `}`**, qui era `\w+`, quindi un argomento che si chiama
/// `foo-bar` — o `città` — veniva sostituito dal kernel e restava scritto a
/// video dalla shell (difetto 0224). Adesso è lo stesso cammino, passo per
/// passo, e a tenerlo tale è la fixture del mirror delle regole (`espansione`
/// in `rules/rules-mirror.test.ts`): un motore che cambia da solo è rosso.
///
/// Il nome si cerca **fra le chiavi proprie** dell'oggetto e non con un
/// accesso nudo: `{constructor}` in JavaScript trova qualcosa in qualunque
/// oggetto, e sarebbe una funzione stampata in mezzo a una frase.
export function expand(template: string, args: Record<string, string | number>): string {
  let outside = "";
  let rest = template;
  for (;;) {
    const where = rest.search(/[{}]/);
    if (where < 0) break;
    outside += rest.slice(0, where);
    const brace = rest[where]!;
    rest = rest.slice(where + 1);
    // Raddoppiata = letterale, per l'una e per l'altra.
    if (rest[0] === brace) {
      outside += brace;
      rest = rest.slice(1);
      continue;
    }
    // Una graffa chiusa spaiata è testo: non c'è niente da chiudere.
    if (brace === "}") {
      outside += "}";
      continue;
    }
    const end = rest.indexOf("}");
    // Una graffa aperta che non si chiude mai: testo fino alla fine.
    if (end < 0) {
      outside += "{";
      break;
    }
    const name = rest.slice(0, end);
    outside += Object.prototype.hasOwnProperty.call(args, name) ? String(args[name]) : `{${name}}`;
    rest = rest.slice(end + 1);
  }
  return outside + rest;
}

/// Il testo di una chiave, nella lingua di chi guarda.
/// La frase giusta per un numero: `one` per il singolare della lingua che si
/// sta parlando, `other` per tutto il resto. Le regole le sa `Intl`: in
/// italiano e in inglese «uno» è singolare, ma una lingua nuova non deve
/// portarsi dietro l'assunzione.
export function plural(count: number, one: Key, other: Key, args: Record<string, string | number> = {}): string {
  let form = "other";
  try {
    form = new Intl.PluralRules(resolvedLanguage()).select(count);
  } catch {
    form = count === 1 ? "one" : "other";
  }
  return t(form === "one" ? one : other, { count, n: count, ...args });
}

/// I nomi fra graffe di un modello del catalogo: `"«{name}»: {reason}"` →
/// `"name" | "reason"`. Le graffe raddoppiate sono testo, come in [`expand`].
type Placeholders<S extends string> = S extends `${string}{${infer Rest}`
  ? Rest extends `{${infer After}`
    ? Placeholders<After>
    : Rest extends `${infer Name}}${infer After}`
      ? Name | Placeholders<After>
      : never
  : never;

/// Gli argomenti che il modello italiano di `K` nomina, obbligatori: un
/// `{motivo}` che il chiamante passa come `reason` non compila, invece di
/// arrivare a schermo come graffa. Altri nomi restano ammessi (`plural`
/// aggiunge sempre `count` e `n`). Su una chiave calcolata (`K` unione) vale
/// la forma di una qualunque delle chiavi possibili: la prova piena è sulle
/// chiamate con la chiave scritta. Una chiave forzata (`as never`, letta da
/// un attributo) non promette niente e non chiede niente.
export type ArgsFor<K extends Key> = [K] extends [never] ? [args?: Record<string, string | number>] : ArgsOf<K>;

type ArgsOf<K extends Key> = K extends Key
  ? [Placeholders<(typeof IT)[K]>] extends [never]
    ? [args?: Record<string, string | number>]
    : [args: Record<Placeholders<(typeof IT)[K]>, string | number> & Record<string, string | number>]
  : never;

export function t<K extends Key>(key: K, ...[args = {}]: ArgsFor<K>): string {
  const template = catalogFor(languageCurrent())[key] ?? IT[key] ?? key;
  return expand(template, args);
}

/// Gli attributi che il testo fermo di `index.html` può chiedere, e dove
/// finisce ciò che si trova.
///
/// Un solo attributo per elemento sarebbe bastato al 90% dei casi e non al
/// rest: un pulsante ha un testo **e** un `title`, e un campo ha un
/// segnaposto e un nome accessibile. Sono quattro nomi e non un mini-linguaggio
/// dentro un attributo, che è la forma che si finisce per dover parsare.
const ATTRIBUTES = [
  ["data-i18n", "testo"],
  ["data-i18n-title", "tooltip"],
  ["data-i18n-placeholder", "placeholder"],
  ["data-i18n-label", "aria-label"],
] as const;

/// Riempie il testo fermo: `<button data-i18n="app.close">` diventa «Chiudi».
///
/// Gira al montaggio e a ogni cambio di lingua. Il testo scritto nell'HTML resta
/// comunque quello italiano — non è un segnaposto vuoto — perché è ciò che si
/// vede se questa funzione non gira: un ripiego che è già la lingua di ripiego.
export function applyStrings(root: ParentNode = document): void {
  applyDocumentLanguage();
  for (const [attribute, where] of ATTRIBUTES) {
    for (const el of root.querySelectorAll<HTMLElement>(`[${attribute}]`)) {
      const key = el.getAttribute(attribute) as Key;
      const text = t(key);
      if (where === "testo") el.textContent = text;
      else if (where === "tooltip") setTooltip(el, text);
      else el.setAttribute(where, text);
    }
  }
}

/// Chi ridisegna quando la lingua cambia, **iscritto da sé**.
///
/// La scocca la rifà `applicaStringhe`, e i pannelli li rifà l'host dei
/// pannelli; restano le superfici che disegnano testo e non sono né l'una né
/// gli altri — il pulsante degli avvisi, quello delle attività e le superfici
/// degli editor. Si iscrivono qui invece di essere chiamate da `main.ts`: chi
/// disegna del testo sa di disegnarlo, e il punto di montaggio non deve tenere
/// un elenco di chi lo fa — un elenco che si scopre incompleto solo cambiando
/// lingua e guardando bene.
///
/// Torna **come smettere**, come `onKernelEvent` in `host/ipc.ts` e come
/// `trapFocus`. Chi si iscrive deve affidare il disposer a una `Lifetime`:
/// `lifetime.add(onLanguage(redraw))`. `mountStrings` raccoglie nello stesso
/// modo le proprie iscrizioni a lingua, kernel e store, così il suo chiamante
/// può smontarle tutte insieme.
export function onLanguage(listener: () => void): Teardown {
  const registration: LanguageRegistration = { listener };
  listeners.push(registration);
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    const i = listeners.indexOf(registration);
    if (i >= 0) listeners.splice(i, 1);
  };
}

/// Rilegge la scelta dall'impostazione, se c'è un vault che possa rispondere.
async function reread(owner: RereadOwner): Promise<void> {
  const generation = ++owner.generation;
  let entries: SettingEntry[];
  try {
    entries = await settings();
  } catch {
    // Nessun vault aperto, o il canale dati che non risponde: si resta su ciò
    // che la cache diceva. Una lingua è la cosa meno urgente da cui far fallire
    // un avvio.
    return;
  }
  // Una risposta non può più applicarsi se nel frattempo è partita una
  // rilettura più nuova o il chiamante è stato smontato.
  if (!owner.active || owner.generation !== generation) return;
  const entry = entries.find((e) => e.spec.key === LANGUAGE_KEY);
  if (!entry) return;
  const next = typeof entry.value === "string" ? entry.value : "";
  if (next === choice) return;
  choice = next;
  // La cache è una memoria di cortesia: se il browser la vieta, la scelta
  // arrivata dall'impostazione resta comunque autorevole per questa finestra.
  try {
    localStorage.setItem(CACHE, choice);
  } catch {
    // Best effort: non impedire né l'applicazione né l'avviso del cambio.
  }
  applyStrings();
  // Una copia: un ascoltatore che si disiscrive mentre viene chiamato
  // altrimenti accorcerebbe l'array sotto l'iteratore, e il successivo
  // salterebbe il turno.
  for (const { listener } of [...listeners]) listener();
}

/// Accende le stringhe: applica subito ciò che si sa, poi insegue l'unica
/// sorgente che le può cambiare — l'impostazione.
///
/// Il sistema non è una seconda sorgente da inseguire come per il tema: la
/// lingua della webview non cambia mentre l'app è aperta, e se cambiasse
/// cambierebbe riavviandola.
export function mountStrings(onChange: () => void): Teardown {
  const owner: RereadOwner = { active: true, generation: 0 };
  try {
    choice = localStorage.getItem(CACHE) ?? "";
  } catch {
    choice = "";
  }
  applyStrings();
  const stopLanguage = onLanguage(onChange);
  const stopSetting = onEvent("setting_changed", () => {
    if (owner.active) void reread(owner);
  });
  const stopVault = on("vault", () => {
    if (owner.active) void reread(owner);
  });
  return () => {
    if (!owner.active) return;
    owner.active = false;
    owner.generation++;
    stopVault();
    stopSetting();
    stopLanguage();
  };
}
