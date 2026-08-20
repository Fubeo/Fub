// Le stringhe **della shell**, e come si scelgono (§12.4).
//
// La [decisione 0040](../../../docs/decisions/0040-chi-localizza.md) ha deciso
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
import type { Teardown } from "../ui/lifetime";

/// Il catalogo italiano. È anche la **forma** del catalogo: le altre lingue
/// devono avere le sue chiavi, tutte, o non compilano.
const IT = {
  // --- la scocca ---------------------------------------------------------
  "app.skip_to_editor": "Vai all'editor",
  "app.open_vault": "Apri vault…",
  "app.settings": "Impostazioni",
  "app.settings.hint": "Le impostazioni di questo vault",
  "app.close": "Chiudi",
  "app.cancel": "Annulla",
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

  // --- le regioni, che si leggono solo navigando -------------------------
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
  "menu.view.graph": "Mostra il grafo",
  "menu.view.mode_reading": "Modalità Lettura",
  "menu.view.mode_live": "Modalità Modifica",
  "menu.go.switcher": "Vai alla nota",
  "menu.tools.settings": "Impostazioni",

  // --- la rail: le icone a sinistra, sempre visibili ---------------------
  "rail.notes": "Note",
  "rail.notes.hint": "L'albero del vault",
  "rail.search": "Cerca",
  "rail.search.hint": "La ricerca nel vault",
  "rail.graph": "Grafo",
  "rail.graph.hint": "Il grafo dei collegamenti",

  // --- l'inspector: i linguetta a destra --------------------------------------
  "inspector.region": "Ispettore",

  "command-search.placeholder": "Cerca nel vault…",
  "command-search.hint": "Cerca nel vault. Palette: Mod-Shift-P",
  "region.rail": "Navigazione",

  // --- le tre modalità del pannello --------------------------------------
  "mode.group": "Modalità del pannello",
  "mode.source": "Sorgente",
  "mode.source.hint": "Solo sorgente, nessuna resa inline",
  "mode.live": "Live",
  "mode.live.hint": "Sorgente con resa inline",
  "mode.reading": "Lettura",
  "mode.reading.hint": "Sola lettura, senza editor",

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
  "search.occurrence": "Occorrenza {n}",

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
  "explorer.not_a_space": "Togli dagli spazi",
  "explorer.whole_vault": "Tutto il vault",
  "explorer.new_space": "Nuovo spazio da una cartella",
  "explorer.no_folders": "Nessuna cartella disponibile",
  "explorer.altre_voci": "…e altre {n} qui dentro",
  "explorer.altre_cartelle": "…e altre {n} cartelle",
  "explorer.to_folder_failed": "Non riesco a convertire {doc} in cartella: {reason}",
  "explorer.rename_failed": "Rinomina di {doc} in {to} rifiutata: {reason}",
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
  "explorer.bad_name": "«{nome}» non si può usare: {motivo}",
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

  // --- il cestino --------------------------------------------------------
  "trash.confirm_delete": "Spostare «{doc}» nel cestino?",
  "trash.delete_title": "Elimina nota",

  // --- il grafo e la cronologia ------------------------------------------
  "graph.count": "Grafo — Note: {note} · Collegamenti: {edges}",
  "graph.a11y.superficie": "Grafo del vault: {note} note, {edges} collegamenti",
  "graph.conf.titolo": "Fisica del grafo",
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

  // --- il centro attività e quello degli avvisi --------------------------
  "activity.title": "Attività",
  "activity.hint": "I lavori in corso",
  "activity.count": "Attività {count}",
  "activity.none": "Nessun lavoro in corso.",
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
  "settings.reset.hint": "Dimentica questa scelta: torna a valere il livello sotto",
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
  "commands.mode.reading": "Passa a Lettura",
  "commands.mode.reading.desc": "Mostra la nota resa, senza l'editor.",
  "commands.mode.live": "Passa a Modifica",
  "commands.mode.live.desc": "Mostra la nota come testo, con l'anteprima viva.",
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
  "pane.named": "Riquadro: {name}",
  "pane.empty": "Riquadro vuoto",
  "commands.panel.files": "Mostra i file",
  "commands.panel.files.desc": "Porta l'albero del vault nella barra laterale.",
  "commands.panel.search": "Mostra la ricerca",
  "commands.panel.search.desc": "Porta i risultati della ricerca nella barra laterale.",
  "commands.graph": "Mostra il grafo",
  "commands.graph.desc": "Apre il grafo dei collegamenti del vault.",
  "commands.vault.open": "Apri un vault…",
  "commands.vault.open.desc": "Sceglie una cartella e la apre come vault.",
  "commands.palette": "Apri la palette dei comandi",
  "commands.palette.desc": "Cerca fra tutti i comandi e lanciane uno.",
  "palette.empty": "Nessun comando",
  "palette.unavailable": "Comandi non disponibili: {reason}",
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

  // --- ciò che si dice quando un pezzo non risponde ----------------------
  "panel.render_failed": "Il pannello «{panel}» non si è ridisegnato: {reason}",
  "document.overwritten":
    "{doc} è stato cambiato da un'altra applicazione mentre il buffer è sporco: il buffer vince e quella modifica andrà persa al prossimo salvataggio.",
  "document.changed_on_disk":
    "{doc} è cambiato su disco mentre il buffer è sporco: il buffer vince.",
  "document.deleted_dirty":
    "{doc} è stato cancellato su disco mentre il buffer è sporco: il buffer vince, e il prossimo salvataggio lo ricrea.",
  "document.save_failed": "{doc} non è stato salvato: {reason}",
  // Dice **perché il gesto non è partito**, e nomina il documento appeso: chi
  // legge ha appena chiesto di spostare una nota e deve capire che il rifiuto
  // riguarda un salvataggio, non la rinomina.
  // L'iscrizione alla chiusura non è andata: da qui in poi la finestra si chiude
  // senza che nessuno metta in salvo il ritardo. È una frase e non una riga di
  // log perché chi scrive deve sapere che la rete sotto non c'è.
  "document.close_unhooked":
    "Fub non riesce ad ascoltare la chiusura della finestra: salva a mano prima di chiudere, perché l'ultima battuta potrebbe non essere ancora sul disco.",
  "document.unsaved_blocks":
    "{doc} non è sul disco: l'operazione si ferma qui, perché spostare il file lascerebbe indietro il testo non salvato.",
  // Dice **che non è stato scritto niente**, e non è un dettaglio tecnico: è la
  // sola frase che distingue questo caso da «non ci sono riuscito», e senza di
  // essa chi legge crede di aver perso il proprio testo.
  "document.save_conflict":
    "{doc} è cambiato su disco da quando l'hai aperto: non è stato scritto niente, e le tue modifiche sono ancora qui. Scegli quale testo tenere dalla palette dei comandi.",
  "document.conflict_none": "Nessun conflitto da risolvere su questo documento.",
  "preview.open_failed": "Non riesco ad aprire «{page}»: {reason}",
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
    "La view «{view}» chiede la superficie «{surface}», che questa shell non ospita: {motivo}.",
  "views.action_failed":
    "L'azione «{action}» non è andata a buon fine ({reason}): quello che vedi è di prima.",
  "commands.list_failed":
    "L'elenco dei comandi non è arrivato ({reason}): la palette è vuota e le scorciatoie dichiarate non rispondono.",
  "vault.partial":
    "{count} note non si sono lette all'apertura: la ricerca non le trova e il grafo non le collega.",

  // --- il buffer di crash (§15.2) ----------------------------------------
  //
  // Una frase per CASO e non una sola con dentro dei se: la domanda da fare è
  // diversa in ognuno, e una frase generica («c'è del testo non salvato»)
  // costringerebbe chi la legge ad aprire per capire cosa gli sta succedendo.
  "draft.found":
    "{count} note hanno del testo che non era stato salvato. È stato ritrovato: aprile per decidere cosa tenere.",
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
    "Il testo non salvato non arriva più sul disco: da adesso un crash lo perderebbe. Salva a mano ciò che non vuoi rischiare.",

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
} as const;

/// Una chiave del catalogo della shell.
export type Key = keyof typeof IT;

/// L'inglese. Il tipo è ciò che lo tiene completo: togliere una riga qui è un
/// errore di compilazione, non una chiave nuda scoperta da qualcuno.
const EN: Record<Key, string> = {
  "app.skip_to_editor": "Skip to the editor",
  "app.open_vault": "Open vault…",
  "app.settings": "Settings",
  "app.settings.hint": "The settings of this vault",
  "app.close": "Close",
  "app.cancel": "Cancel",
  "app.retry": "Retry",
  "app.run": "Run",
  "app.dialog": "Dialog",
  "app.start_failed": "Startup failed: {reason}",
  "app.external_changes":
    "Changes made by other apps will not be detected: close and reopen the vault to read it again.",
  "app.vault_keys_pending":
    "This vault proposes {count} shortcuts that are not active yet ({commands}). Look at them in the settings, Shortcuts section.",

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
  "menu.view.graph": "Show graph",
  "menu.view.mode_reading": "Reading mode",
  "menu.view.mode_live": "Editing mode",
  "menu.go.switcher": "Go to note",
  "menu.tools.settings": "Settings",

  // --- the rail: the left icon strip, always visibile --------------------
  "rail.notes": "Notes",
  "rail.notes.hint": "The vault tree",
  "rail.search": "Search",
  "rail.search.hint": "Search the vault",
  "rail.graph": "Graph",
  "rail.graph.hint": "The links graph",

  // --- the inspector: the right tabs ------------------------------------
  "inspector.region": "Inspector",

  // --- the search trigger in the titlebar -------------------------------
  "command-search.placeholder": "Search the vault…",
  "command-search.hint": "Search the vault. Palette: Mod-Shift-P",
  "region.rail": "Navigation",

  "mode.group": "Pane mode",
  "mode.source": "Source",
  "mode.source.hint": "Source only, no inline rendering",
  "mode.live": "Live",
  "mode.live.hint": "Source with inline rendering",
  "mode.reading": "Reading",
  "mode.reading.hint": "Read only, no editor",

  "search.placeholder": "Search the vault…",
  "search.hint": "Search the vault",
  "search.results": "Results",
  "search.empty": "No results",
  "search.create": "Create this note",
  "search.indexing": "Indexing…",
  "search.count": "Results: {count}",
  "search.unavailable": "Search unavailable",
  "search.occurrence": "Occurrence {n}",

  "docsearch.title": "Search in note",
  "docsearch.placeholder": "Search in this note…",
  "docsearch.no_doc": "No note open",
  "commands.doc.search": "Search in note",
  "commands.doc.search.desc": "Search inside the open note, with the same engine as the vault.",

  "switcher.title": "Go to note",
  "switcher.placeholder": "Go to note…",
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
  "explorer.not_a_space": "Remove from the spaces",
  "explorer.whole_vault": "The whole vault",
  "explorer.new_space": "New space from a folder",
  "explorer.no_folders": "No folder available",
  "explorer.altre_voci": "…and {n} more in here",
  "explorer.altre_cartelle": "…and {n} more folders",
  "explorer.to_folder_failed": "Cannot turn {doc} into a folder: {reason}",
  "explorer.rename_failed": "Renaming {doc} to {to} was refused: {reason}",
  "explorer.move_failed": "Cannot move {doc} into {folder}: {reason}",
  "explorer.root": "the root",

  "explorer.bad_name": "“{nome}” cannot be used: {motivo}",
  "name_fault.empty": "the name is missing",
  "name_fault.traversal": "“.” and “..” are not names",
  "graph.count": "Graph — Notes: {note} · Links: {edges}",
  "graph.a11y.superficie": "Vault graph: {note} notes, {edges} links",
  "graph.conf.titolo": "Graph physics",
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

  "trash.confirm_delete": "Move «{doc}» to the trash?",
  "trash.delete_title": "Delete note",
  "activity.title": "Activity",
  "activity.hint": "The jobs in progress",
  "activity.count": "Activity {count}",
  "activity.none": "No job in progress.",
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

  "settings.title": "Settings",
  "settings.tabs": "Settings sections",
  "settings.tab.config": "Configuration",
  "settings.tab.components": "Components",
  "settings.tab.vaults": "Vaults",
  "settings.tab.shortcuts": "Shortcuts",
  "settings.shortcuts_hint":
    "One row per command: the combination that runs it. `Mod` is Ctrl (Cmd on the Mac); you write it as `Mod-Shift-f`. There are three modifiers — `Mod`, `Shift`, `Alt` — and no others: a hand-written `Ctrl-k` is not honoured. A combination without modifiers is not honoured, because it would steal a letter from whoever is typing. A space separates two keys pressed one after the other: `Mod-k d` is a single shortcut.",
  "settings.shortcuts.none": "No command declared.",
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
  "settings.reset.hint": "Forget this choice: the level below applies again",
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
  "commands.mode.reading": "Switch to Reading",
  "commands.mode.reading.desc": "Show the rendered note, without the editor.",
  "commands.mode.live": "Switch to Editing",
  "commands.mode.live.desc": "Show the note as text, with the live preview.",
  "commands.pane.split.right": "Split the pane to the right",
  "commands.pane.split.right.desc":
    "Opens the same note in a pane alongside, to look at two of them together.",
  "commands.pane.split.down": "Split the pane downwards",
  "commands.pane.split.down.desc": "Opens the same note in a pane below this one.",
  "commands.pane.close": "Close the pane",
  "commands.pane.close.desc": "Removes this pane; the last one does not close.",
  "commands.tab.close": "Close the tab",
  "commands.tab.close.desc": "Removes the note from this pane, saving it if needed.",
  "commands.doc.conflict.mine": "Conflict: keep my text",
  "commands.doc.conflict.mine.desc":
    "Rewrites the file with the buffer text, covering the change that arrived from outside.",
  "commands.doc.conflict.theirs": "Conflict: keep the text on disk",
  "commands.doc.conflict.theirs.desc":
    "Discards the unsaved changes and reloads the file as it is on disk.",
  "panes.redraw_failed": "The panes did not redraw: {reason}",
  "pane.named": "Pane: {name}",
  "pane.empty": "Empty pane",
  "commands.panel.files": "Show files",
  "commands.panel.files.desc": "Bring the vault tree into the sidebar.",
  "commands.panel.search": "Show search",
  "commands.panel.search.desc": "Bring the search results into the sidebar.",
  "commands.graph": "Show the graph",
  "commands.graph.desc": "Opens the graph of the vault links.",
  "commands.vault.open": "Open a vault…",
  "commands.vault.open.desc": "Pick a folder and open it as a vault.",
  "commands.palette": "Open the command palette",
  "commands.palette.desc": "Search among all commands and run one.",
  "palette.placeholder": "Command…",
  "palette.empty": "No command",
  "palette.unavailable": "Commands unavailable: {reason}",
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

  "panel.render_failed": "The panel «{panel}» did not redraw: {reason}",
  "document.overwritten":
    "{doc} was changed by another application while the buffer is dirty: the buffer wins and that change will be lost at the next save.",
  "document.changed_on_disk": "{doc} changed on disk while the buffer is dirty: the buffer wins.",
  "document.deleted_dirty":
    "{doc} was deleted on disk while the buffer is dirty: the buffer wins, and the next save recreates it.",
  "document.save_failed": "{doc} was not saved: {reason}",
  "document.close_unhooked":
    "Fub cannot listen for the window closing: save by hand before you close, because the last keystroke may not be on disk yet.",
  "document.unsaved_blocks":
    "{doc} is not on disk: the operation stops here, because moving the file would leave the unsaved text behind.",
  "document.save_conflict":
    "{doc} changed on disk since you opened it: nothing was written, and your changes are still here. Choose which text to keep from the command palette.",
  "document.conflict_none": "No conflict to resolve on this document.",
  "preview.open_failed": "Cannot open «{page}»: {reason}",
  "kernel.listener_failed": "A kernel event listener threw: {reason}",
  "store.listener_failed": "A listener of «{signal}» threw: {reason}",
  "state.not_remembered": "Could not remember how you left the panels.",
  "organization.unreadable":
    "The vault organization cannot be read ({reason}): icons, pins and ordering of this session will not be saved.",
  "organization.not_saved": "Organization not saved: {reason}",
  "views.surface_missing":
    "The view «{view}» asks for the «{surface}» surface, which this shell does not host: {motivo}.",
  "views.action_failed":
    "The «{action}» action did not go through ({reason}): what you see is from before.",
  "commands.list_failed":
    "The command list did not arrive ({reason}): the palette is empty and the declared shortcuts do not respond.",
  "vault.partial":
    "{count} notes could not be read while opening: search does not find them and the graph does not link them.",

  "draft.found":
    "{count} notes have text that was never saved. It has been recovered: open them to decide what to keep.",
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
    "Unsaved text no longer reaches the disk: from now on a crash would lose it. Save by hand whatever you do not want to risk.",

  "save.saved": "Saved",
  "save.saving": "Saving…",
  "save.unsaved": "Unsaved",
  "save.failed": "Save failed",
  "save.conflitto": "Changed on disk",
};

/// La lingua di ripiego di questa shell, che è quella in cui è scritto.
const FALLBACK = "it";

const CATALOGS: Record<string, Record<string, string>> = { it: IT, en: EN };

/// La chiave dell'impostazione della lingua. La stessa stringa sta in
/// `fub-kernel/src/locale.rs`, come `CHIAVE_TEMA` sta in
/// `fub-host/src/settings.rs` — e per la stessa ragione: una shell in
/// TypeScript non importa una costante Rust.
export const LANGUAGE_KEY = "locale.language";

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

/// Chi va avvisato quando la lingua cambia: chi ha già disegnato del testo.
const listeners: Array<() => void> = [];

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
  const base = language.split(/[-_]/)[0] ?? "";
  return CATALOGS[language.toLowerCase()] ?? CATALOGS[base.toLowerCase()] ?? CATALOGS[FALLBACK]!;
}

/// La lingua corrente. Fuori da un browser (i test) `navigator` può non esserci.
function languageCurrent(): string {
  const systemLanguage = typeof navigator === "undefined" ? FALLBACK : navigator.language || FALLBACK;
  return effectiveLanguage(choice, systemLanguage);
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
export function t(key: Key, args: Record<string, string | number> = {}): string {
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
  ["data-i18n-title", "title"],
  ["data-i18n-placeholder", "placeholder"],
  ["data-i18n-label", "aria-label"],
] as const;

/// Riempie il testo fermo: `<button data-i18n="app.close">` diventa «Chiudi».
///
/// Gira al montaggio e a ogni cambio di lingua. Il testo scritto nell'HTML resta
/// comunque quello italiano — non è un segnaposto vuoto — perché è ciò che si
/// vede se questa funzione non gira: un ripiego che è già la lingua di ripiego.
export function applyStrings(root: ParentNode = document): void {
  for (const [attribute, where] of ATTRIBUTES) {
    for (const el of root.querySelectorAll<HTMLElement>(`[${attribute}]`)) {
      const key = el.getAttribute(attribute) as Key;
      const text = t(key);
      if (where === "testo") el.textContent = text;
      else el.setAttribute(where, text);
    }
  }
}

/// Chi ridisegna quando la lingua cambia, **iscritto da sé**.
///
/// La scocca la rifà `applicaStringhe`, e i pannelli li rifà l'host dei
/// pannelli; restano le superfici che disegnano testo e non sono né l'una né
/// gli altri — il pulsante degli avvisi, quello delle attività. Si iscrivono
/// qui invece di essere chiamate da `main.ts`: chi disegna del testo sa di
/// disegnarlo, e il punto di montaggio non deve tenere un elenco di chi lo fa
/// — un elenco che si scopre incompleto solo cambiando lingua e guardando bene.
///
/// Torna **come smettere**, come `onKernelEvent` in `host/ipc.ts` e come
/// `trapFocus`. I quattro chiamanti di oggi lo ignorano, ed è corretto:
/// sono superfici montate una volta che vivono quanto la finestra, e per loro
/// non c'è niente da disfare. Il difetto non morde adesso — morde il primo
/// chiamante che sia un pannello, che si iscriverebbe di nuovo a ogni
/// montaggio senza che la vecchia iscrizione se ne vada, e ridisegnerebbe N
/// volte una superficie che non esiste più. Chi ha una `Lifetime` scrive
/// `lifetime.aggiungi(onLanguage(redraw))` e non ci pensa.
export function onLanguage(listener: () => void): Teardown {
  listeners.push(listener);
  return () => {
    const i = listeners.indexOf(listener);
    if (i >= 0) listeners.splice(i, 1);
  };
}

/// Rilegge la scelta dall'impostazione, se c'è un vault che possa rispondere.
async function reread(): Promise<void> {
  try {
    const entry = (await settings()).find((e) => e.spec.key === LANGUAGE_KEY);
    if (!entry) return;
    const next = typeof entry.value === "string" ? entry.value : "";
    if (next === choice) return;
    choice = next;
    localStorage.setItem(CACHE, choice);
    applyStrings();
    // Una copia: un ascoltatore che si disiscrive mentre viene chiamato
    // altrimenti accorcerebbe l'array sotto l'iteratore, e il successivo
    // salterebbe il turno.
    for (const listener of [...listeners]) listener();
  } catch {
    // Nessun vault aperto, o il canale dati che non risponde: si resta su ciò
    // che la cache diceva. Una lingua è la cosa meno urgente da cui far fallire
    // un avvio.
  }
}

/// Accende le stringhe: applica subito ciò che si sa, poi insegue l'unica
/// sorgente che le può cambiare — l'impostazione.
///
/// Il sistema non è una seconda sorgente da inseguire come per il tema: la
/// lingua della webview non cambia mentre l'app è aperta, e se cambiasse
/// cambierebbe riavviandola.
export function mountStrings(onChange: () => void): void {
  try {
    choice = localStorage.getItem(CACHE) ?? "";
  } catch {
    choice = "";
  }
  applyStrings();
  listeners.push(onChange);
  onEvent("setting_changed", () => void reread());
  on("vault", () => void reread());
}
