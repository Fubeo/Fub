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
// L'ultimo gradino è brutto apposta, ed è la ragione scritta nella 0040: una
// chiave mancante deve essere *visibile e cercabile*, non plausibile.
//
// # Ciò che qui si può fare e in Rust no
//
// `Chiave` è l'unione delle chiavi del catalogo italiano, e i cataloghi delle
// altre lingue sono `Record<Chiave, string>`: **una chiave dimenticata in
// inglese non compila**. In Rust la stessa promessa costa un test che cammina
// sui cataloghi (`fub-features/tests/i_cataloghi.rs`), perché lì un catalogo è
// dato di manifest e le chiavi sono `&str`. Qui il compilatore la regala, e
// vale la pena prendersela: è il tipo di errore che altrimenti si scopre da una
// segnalazione.
//
// Ciò che il compilatore **non** copre è il testo fermo di `index.html`, che
// nomina le chiavi in un attributo: quello lo presidia `strings.test.ts`,
// leggendo il file vero.
import { impostazioni } from "../host/query";
import { onEvent } from "../state/kernel";
import { on } from "../state/store";

/// Il catalogo italiano. È anche la **forma** del catalogo: le altre lingue
/// devono avere le sue chiavi, tutte, o non compilano.
const IT = {
  // --- la scocca ---------------------------------------------------------
  "app.skip_to_editor": "Vai all'editor",
  "app.open_vault": "Apri vault…",
  "app.graph": "Grafo",
  "app.graph.hint": "Il grafo dei collegamenti del vault",
  "app.settings": "Impostazioni",
  "app.settings.hint": "Le impostazioni di questo vault e di questa macchina",
  "app.close": "Chiudi",
  "app.cancel": "Annulla",
  "app.retry": "Riprova",
  "app.run": "Esegui",
  "app.dialog": "Finestra di dialogo",
  "app.start_failed": "Avvio fallito: {reason}",
  "app.external_changes":
    "Le modifiche fatte da altre app non verranno rilevate: chiudi e riapri il vault per rileggerlo.",

  // --- le regioni, che si leggono solo navigando -------------------------
  "region.notes": "Note e ricerca",
  "region.document": "Documento",
  "region.sidebars": "Pannelli laterali",
  "region.bottom": "Pannelli in basso",
  "region.ribbon": "Azioni dei componenti",
  "region.status": "Stato dei componenti",
  "region.statusbar": "Barra di stato",

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
  "search.count": "Risultati: {count}",
  "search.unavailable": "Ricerca non disponibile",
  "search.occurrence": "Occorrenza {n}",

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

  // --- il cestino --------------------------------------------------------
  "trash.title": "Cestino",
  "trash.hint": "Apri il cestino",
  "trash.back": "Torna alle note",
  "trash.empty_button": "Svuota",
  "trash.empty_button.hint": "Cancella tutto per sempre",
  "trash.is_empty": "Il cestino è vuoto.",
  "trash.emptied": "Cestino svuotato.",
  "trash.restore": "Ripristina",
  "trash.restore_failed": "«{doc}» non è stata ripristinata: {reason}",
  "trash.restore_title": "Ripristina nota",
  "trash.exists_again": "«{doc}» esiste di nuovo. Ripristinare come «{proposta}»?",
  "trash.empty_title": "Svuota cestino",
  "trash.confirm_empty": "Cancellare per sempre tutto il cestino? Elementi: {count}",
  "trash.confirm_delete": "Spostare «{doc}» nel cestino?",
  "trash.delete_title": "Elimina nota",

  // --- il grafo e la cronologia ------------------------------------------
  "graph.count": "Grafo — Note: {note} · Collegamenti: {archi}",
  "history.title": "Cronologia",
  "history.restore": "Ripristina",
  "history.none": "Nessuna versione",
  "history.count": "Versioni: {count}",
  "history.current": "attuale",
  "history.size": "{size} B",

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
  "settings.group.other": "Altro",
  "settings.none": "Nessun componente dichiara impostazioni.",
  "settings.read_failed": "Non riesco a leggere: {reason}",
  "settings.components_hint":
    "Un componente spento si smonta subito e non viene più montato all'apertura del vault: non registra niente, e le sue impostazioni non compaiono.",
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
  "palette.empty": "Nessun comando",
  "palette.unavailable": "Comandi non disponibili: {reason}",
  "palette.preview": "Anteprima…",
  "palette.apply": "Applica",
  "palette.required": "{title} *",
  "palette.docs_placeholder": "un id per riga (vuoto = tutto il vault)",
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
} as const;

/// Una chiave del catalogo della shell.
export type Chiave = keyof typeof IT;

/// L'inglese. Il tipo è ciò che lo tiene completo: togliere una riga qui è un
/// errore di compilazione, non una chiave nuda scoperta da qualcuno.
const EN: Record<Chiave, string> = {
  "app.skip_to_editor": "Skip to the editor",
  "app.open_vault": "Open vault…",
  "app.graph": "Graph",
  "app.graph.hint": "The link graph of the vault",
  "app.settings": "Settings",
  "app.settings.hint": "The settings of this vault and of this machine",
  "app.close": "Close",
  "app.cancel": "Cancel",
  "app.retry": "Retry",
  "app.run": "Run",
  "app.dialog": "Dialog",
  "app.start_failed": "Startup failed: {reason}",
  "app.external_changes":
    "Changes made by other apps will not be detected: close and reopen the vault to read it again.",

  "region.notes": "Notes and search",
  "region.document": "Document",
  "region.sidebars": "Side panels",
  "region.bottom": "Bottom panels",
  "region.ribbon": "Component actions",
  "region.status": "Component status",
  "region.statusbar": "Status bar",

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
  "search.count": "Results: {count}",
  "search.unavailable": "Search unavailable",
  "search.occurrence": "Occurrence {n}",

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
  "explorer.to_folder_failed": "Cannot turn {doc} into a folder: {reason}",
  "explorer.rename_failed": "Renaming {doc} to {to} was refused: {reason}",
  "explorer.move_failed": "Cannot move {doc} into {folder}: {reason}",
  "explorer.root": "the root",

  "explorer.bad_name": "“{nome}” cannot be used: {motivo}",
  "name_fault.empty": "the name is missing",
  "name_fault.traversal": "“.” and “..” are not names",
  "name_fault.control": "it contains a control character",
  "name_fault.reserved": "it contains a character a filesystem reserves (< > : \" | ? * \\)",
  "name_fault.device": "it is a name Windows reserves (CON, NUL, COM1…)",
  "name_fault.trailing_dot": "it cannot end with a dot or a space",
  "name_fault.hidden": "it cannot start with a dot: the vault would not list the note",
  "name_fault.too_long": "it is too long (255 bytes at most)",

  "trouble.about": "{doc}: {reason}",
  "trouble.vault": "{reason}",

  "trash.title": "Trash",
  "trash.hint": "Open the trash",
  "trash.back": "Back to the notes",
  "trash.empty_button": "Empty",
  "trash.empty_button.hint": "Delete everything for good",
  "trash.is_empty": "The trash is empty.",
  "trash.emptied": "Trash emptied.",
  "trash.restore": "Restore",
  "trash.restore_failed": "«{doc}» was not restored: {reason}",
  "trash.restore_title": "Restore note",
  "trash.exists_again": "«{doc}» exists again. Restore it as «{proposta}»?",
  "trash.empty_title": "Empty the trash",
  "trash.confirm_empty": "Delete the whole trash for good? Items: {count}",
  "trash.confirm_delete": "Move «{doc}» to the trash?",
  "trash.delete_title": "Delete note",

  "graph.count": "Graph — Notes: {note} · Links: {archi}",
  "history.title": "History",
  "history.restore": "Restore",
  "history.none": "No version",
  "history.count": "Versions: {count}",
  "history.current": "current",
  "history.size": "{size} B",

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
  "settings.group.other": "Other",
  "settings.none": "No component declares settings.",
  "settings.read_failed": "I cannot read: {reason}",
  "settings.components_hint":
    "A component that is off unmounts at once and is not mounted again when the vault opens: it registers nothing, and its settings do not show up.",
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
  "palette.placeholder": "Command…",
  "palette.empty": "No command",
  "palette.unavailable": "Commands unavailable: {reason}",
  "palette.preview": "Preview…",
  "palette.apply": "Apply",
  "palette.required": "{title} *",
  "palette.docs_placeholder": "one id per line (empty = the whole vault)",
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
};

/// La lingua di ripiego di questa shell, che è quella in cui è scritta.
const RIPIEGO = "it";

const CATALOGHI: Record<string, Record<string, string>> = { it: IT, en: EN };

/// La chiave dell'impostazione della lingua. La stessa stringa sta in
/// `fub-kernel/src/locale.rs`, come `CHIAVE_TEMA` sta in
/// `fub-host/src/settings.rs` — e per la stessa ragione: una shell in
/// TypeScript non importa una costante Rust.
export const CHIAVE_LINGUA = "locale.language";

/// Dove la shell ricorda l'ultima **scelta** di lingua.
///
/// Stesso mestiere della cache del tema, e stesso buco dichiarato: le
/// impostazioni si leggono dal canale dati, che vuole un vault aperto, e al
/// primo fotogramma non c'è niente da leggere. Ricordare la *scelta* e non la
/// lingua risolta è ciò che fa ripartire chi ha lasciato «come il sistema»
/// seguendo il sistema di **oggi**.
const CACHE = "fub.locale.language";

/// La scelta corrente, così com'è scritta nell'impostazione.
let scelta = "";

/// Chi va avvisato quando la lingua cambia: chi ha già disegnato del testo.
const ascoltatori: Array<() => void> = [];

/// La lingua che vale, date la scelta e quella del sistema.
///
/// Gemella di `temaEffettivo`, e con la stessa regola per i valori strani: la
/// stringa vuota è «come il sistema» (la convenzione delle chiavi `locale.*`), e
/// lo è anche qualunque cosa non sia una stringa — un `settings.json` scritto a
/// mano non deve poter spegnere le stringhe.
export function linguaEffettiva(scelta: unknown, sistema: string): string {
  return typeof scelta === "string" && scelta.trim() !== "" ? scelta.trim() : sistema;
}

/// Il catalogo da cui pescare, per una lingua: la scala della 0040, i primi tre
/// gradini. Il quarto — la chiave nuda — lo fa `t`, perché è l'assenza di un
/// catalogo e non un catalogo.
export function catalogoPer(lingua: string): Record<string, string> {
  const base = lingua.split(/[-_]/)[0] ?? "";
  return CATALOGHI[lingua.toLowerCase()] ?? CATALOGHI[base.toLowerCase()] ?? CATALOGHI[RIPIEGO]!;
}

/// La lingua corrente. Fuori da un browser (i test) `navigator` può non esserci.
function linguaCorrente(): string {
  const sistema = typeof navigator === "undefined" ? RIPIEGO : navigator.language || RIPIEGO;
  return linguaEffettiva(scelta, sistema);
}

/// Sostituisce `{nome}` con l'argomento che si chiama così.
///
/// Le stesse due regole del motore del contratto, e non per simmetria: una
/// graffa raddoppiata è letterale (serve a scrivere `{{"chiave": valore}}`), e
/// un nome senza argomento **resta a vista** invece di sparire — una frase con
/// un buco si nota, una frase a cui manca una parola no.
export function espandi(template: string, args: Record<string, string | number>): string {
  return template.replace(/\{\{|\}\}|\{(\w+)\}/g, (intero, nome?: string) => {
    if (intero === "{{") return "{";
    if (intero === "}}") return "}";
    const valore = args[nome!];
    return valore === undefined ? intero : String(valore);
  });
}

/// Il testo di una chiave, nella lingua di chi guarda.
export function t(chiave: Chiave, args: Record<string, string | number> = {}): string {
  const template = catalogoPer(linguaCorrente())[chiave] ?? IT[chiave] ?? chiave;
  return espandi(template, args);
}

/// Gli attributi che il testo fermo di `index.html` può chiedere, e dove
/// finisce ciò che si trova.
///
/// Un solo attributo per elemento sarebbe bastato al 90% dei casi e non al
/// resto: un pulsante ha un testo **e** un `title`, e un campo ha un
/// segnaposto e un nome accessibile. Sono quattro nomi e non un mini-linguaggio
/// dentro un attributo, che è la forma che si finisce per dover parsare.
const ATTRIBUTI = [
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
export function applicaStringhe(root: ParentNode = document): void {
  for (const [attributo, dove] of ATTRIBUTI) {
    for (const el of root.querySelectorAll<HTMLElement>(`[${attributo}]`)) {
      const chiave = el.getAttribute(attributo) as Chiave;
      const testo = t(chiave);
      if (dove === "testo") el.textContent = testo;
      else el.setAttribute(dove, testo);
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
export function onLingua(ascoltatore: () => void): void {
  ascoltatori.push(ascoltatore);
}

/// Rilegge la scelta dall'impostazione, se c'è un vault che possa rispondere.
async function rileggi(): Promise<void> {
  try {
    const entry = (await impostazioni()).find((e) => e.spec.key === CHIAVE_LINGUA);
    if (!entry) return;
    const prossima = typeof entry.value === "string" ? entry.value : "";
    if (prossima === scelta) return;
    scelta = prossima;
    localStorage.setItem(CACHE, scelta);
    applicaStringhe();
    for (const ascoltatore of ascoltatori) ascoltatore();
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
    scelta = localStorage.getItem(CACHE) ?? "";
  } catch {
    scelta = "";
  }
  applicaStringhe();
  ascoltatori.push(onChange);
  onEvent("setting_changed", () => void rileggi());
  on("vault", () => void rileggi());
}
