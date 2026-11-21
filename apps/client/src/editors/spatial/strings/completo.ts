// Le stringhe del Disegno completo che il catalogo del disegno ricompone
// (`../strings.ts`).
// - Le finestre dei comandi (piano K6, T6; `motore/finestre.ts`): il
//   caricamento di una funzione, l'errore che lo dice, la riga dell'anteprima e
//   i pulsanti. I nomi dei comandi e dei campi arrivano da chi le apre, col suo
//   catalogo.
// - Gli spazi di lavoro (piano K6, T7): lo spazio nella banda, il menu, le
//   azioni, i preset del Disegno completo e i messaggi di Gestisci e di Salva.
//   La banda (nel chunk principale) non le importa: riceve il testo già
//   tradotto dalla superficie (`SurfaceWorkspace`).

/// L'italiano di quest'area, che è anche la forma dell'inglese.
export const COMPLETO_IT = {
  "draw.window.loading": "Sto preparando questa funzione: la prima volta ci vuole un momento.",
  "draw.window.failed": "Non riesco a preparare questa funzione. Riprova.",
  "draw.window.nomemory": "Non riesco a preparare questa funzione: la memoria dei motori è piena. Chiudi un disegno o un foglio che non usi e riprova.",
  "draw.window.refused": "Il disegno non accetta questo comando adesso.",
  "draw.window.unanswered": "Il disegno non ha risposto. Riprova.",
  "draw.window.retry": "Riprova",
  "draw.window.cancel": "Annulla",
  "draw.window.ok": "OK",
  "draw.window.preview": "Anteprima",
  "draw.window.blank": "Scrivi qualcosa: i soli spazi non bastano.",
  "draw.window.range": "Scrivi un numero fra {min} e {max}.",
  "draw.window.range.min": "Scrivi un numero di almeno {min}.",
  "draw.window.range.max": "Scrivi un numero fino a {max}.",
  "draw.workspace.base.full": "Completo",
  "draw.workspace.base.full.description": "Tutti gli strumenti",
  "draw.workspace.base.simple": "Semplice",
  "draw.workspace.base.simple.description": "Per dita e penna",
  "draw.workspace.preset.completo-classico": "Completo classico",
  "draw.workspace.preset.automazione": "Automazione",
  "draw.workspace.preset.impaginazione": "Impaginazione",
  "draw.workspace.preset.pittura": "Pittura",
  "draw.workspace.preset.ricalco": "Ricalco",
  "draw.workspace.preset.stampa-e-prova": "Stampa e prova",
  "draw.workspace.preset.tipografia": "Tipografia",
  "draw.workspace.preset.web": "Web",
  "draw.workspace.reset": "Ripristina «{name}»",
  "draw.workspace.save": "Salva lo spazio di lavoro…",
  "draw.workspace.manage": "Gestisci gli spazi di lavoro…",
  "draw.workspace.off.others": "Gli altri spazi sono spenti",
  "draw.workspace.off.others.hint": "Accendili in Componenti",
  "draw.workspace.off.open": "Apri Componenti…",
  "draw.workspace.off.reason": "Accendi in Componenti",
  "draw.workspace.load.first": "Riprova prima",
  "draw.workspace.load.failed": "Non si è caricato",
  "draw.workspace.load.retry": "Riprova",
  "draw.workspace.saved.newer": "Creato con una versione più nuova di Fub",
  "draw.workspace.saved.broken": "Uno spazio salvato non si legge e resta com’è nel vault",
  "draw.workspace.saved.unreadable": "Spazio non letto",
  "draw.workspace.save.title": "Salva lo spazio di lavoro",
  "draw.workspace.save.label": "Nome dello spazio",
  "draw.workspace.save.ok": "Salva",
  "draw.workspace.save.taken": "C’è già uno spazio con questo nome: scegline un altro",
  "draw.workspace.save.preset": "«{name}» è uno spazio di serie: scegline un altro nome",
  "draw.workspace.save.empty": "Il nome non può essere vuoto",
  "draw.workspace.saved": "Spazio «{name}» salvato",
  "draw.workspace.manage.title": "Gestisci gli spazi di lavoro",
  "draw.workspace.manage.pick": "Scegli uno spazio salvato",
  "draw.workspace.manage.none": "Non hai ancora salvato nessuno spazio di lavoro",
  "draw.workspace.manage.rename": "Rinomina",
  "draw.workspace.manage.delete": "Elimina",
  "draw.workspace.manage.close": "Chiudi",
  "draw.workspace.manage.rename.done": "Spazio rinominato",
  "draw.workspace.manage.delete.done": "Spazio eliminato",
  "draw.workspace.manage.failed": "Non si è potuto cambiare lo spazio: {reason}",
  // I tasti del motore (K6 T9b, `completo/esegui.ts`): il comando che aspetta, che
  // non ha la sua finestra, che è fatto o non è andato, e il nome nella cronologia.
  "draw.completo.key.waiting": "La parte del disegno per questo comando sta arrivando: il comando parte appena è pronta.",
  "draw.completo.key.nowindow": "Questo comando non ha ancora la sua finestra.",
  "draw.completo.key.done": "{command}: fatto.",
  "draw.completo.key.failed": "Il comando non è andato a buon fine: il disegno è com'era.",
  "draw.completo.key.history": "Comando del motore",
} as const;

/// Chiave del catalogo del disegno: la stessa forma di `COMPLETO_IT`.
export type CompletoKey = keyof typeof COMPLETO_IT;

/// L'inglese, completo per chiave come quello della shell.
export const COMPLETO_EN: Record<CompletoKey, string> = {
  "draw.window.loading": "Preparing this function: the first time takes a moment.",
  "draw.window.failed": "I can’t prepare this function. Try again.",
  "draw.window.nomemory": "I can’t prepare this function: the engine memory is full. Close a drawing or a sheet you don’t use and try again.",
  "draw.window.refused": "The drawing doesn’t accept this command right now.",
  "draw.window.unanswered": "The drawing didn’t answer. Try again.",
  "draw.window.retry": "Try again",
  "draw.window.cancel": "Cancel",
  "draw.window.ok": "OK",
  "draw.window.preview": "Preview",
  "draw.window.blank": "Type something: spaces alone aren’t enough.",
  "draw.window.range": "Type a number between {min} and {max}.",
  "draw.window.range.min": "Type a number of at least {min}.",
  "draw.window.range.max": "Type a number up to {max}.",
  "draw.workspace.base.full": "Full",
  "draw.workspace.base.full.description": "All the tools",
  "draw.workspace.base.simple": "Simple",
  "draw.workspace.base.simple.description": "For fingers and pen",
  "draw.workspace.preset.completo-classico": "Classic Full",
  "draw.workspace.preset.automazione": "Automation",
  "draw.workspace.preset.impaginazione": "Layout",
  "draw.workspace.preset.pittura": "Painting",
  "draw.workspace.preset.ricalco": "Tracing",
  "draw.workspace.preset.stampa-e-prova": "Printing and Proofing",
  "draw.workspace.preset.tipografia": "Typography",
  "draw.workspace.preset.web": "Web",
  "draw.workspace.reset": "Reset “{name}”",
  "draw.workspace.save": "Save the workspace…",
  "draw.workspace.manage": "Manage workspaces…",
  "draw.workspace.off.others": "The other spaces are off",
  "draw.workspace.off.others.hint": "Turn them on in Components",
  "draw.workspace.off.open": "Open Components…",
  "draw.workspace.off.reason": "Turn it on in Components",
  "draw.workspace.load.first": "Try again first",
  "draw.workspace.load.failed": "Did not load",
  "draw.workspace.load.retry": "Try again",
  "draw.workspace.saved.newer": "Made with a newer version of Fub",
  "draw.workspace.saved.broken": "A saved workspace cannot be read and stays as it is in the vault",
  "draw.workspace.saved.unreadable": "Unreadable workspace",
  "draw.workspace.save.title": "Save the workspace",
  "draw.workspace.save.label": "Workspace name",
  "draw.workspace.save.ok": "Save",
  "draw.workspace.save.taken": "A workspace with this name already exists: choose another",
  "draw.workspace.save.preset": "“{name}” is a built-in workspace: choose another name",
  "draw.workspace.save.empty": "The name cannot be empty",
  "draw.workspace.saved": "Workspace “{name}” saved",
  "draw.workspace.manage.title": "Manage workspaces",
  "draw.workspace.manage.pick": "Choose a saved workspace",
  "draw.workspace.manage.none": "You have not saved any workspace yet",
  "draw.workspace.manage.rename": "Rename",
  "draw.workspace.manage.delete": "Delete",
  "draw.workspace.manage.close": "Close",
  "draw.workspace.manage.rename.done": "Workspace renamed",
  "draw.workspace.manage.delete.done": "Workspace deleted",
  "draw.workspace.manage.failed": "The workspace could not be changed: {reason}",
  "draw.completo.key.waiting": "The part of the drawing for this command is on its way: the command runs as soon as it is ready.",
  "draw.completo.key.nowindow": "This command does not have its window yet.",
  "draw.completo.key.done": "{command}: done.",
  "draw.completo.key.failed": "The command did not finish: the drawing is as it was.",
  "draw.completo.key.history": "Engine command",
};

/// La scheda Risorse dell'ispettore (K6 T10): il suo titolo, i campioni del
/// documento e le sue parole di errore. I testi delle sezioni che le famiglie
/// portano stanno nelle famiglie.
export const RISORSE_IT = {
  "draw.chrome.tab.resources": "Risorse",
  "draw.resources.aria": "Risorse",
  "draw.resources.swatches": "Campioni",
  "draw.resources.swatches.document": "Documento",
  "draw.resources.swatches.none": "Il disegno non ha campioni.",
  "draw.resources.count": "{count} campioni",
  "draw.resources.failed": "Questa parte non si è aperta. «Riprova» la carica di nuovo.",
  "draw.resources.retry": "Riprova",
} as const;

/// L'inglese della scheda Risorse.
export const RISORSE_EN: Record<keyof typeof RISORSE_IT, string> = {
  "draw.chrome.tab.resources": "Resources",
  "draw.resources.aria": "Resources",
  "draw.resources.swatches": "Swatches",
  "draw.resources.swatches.document": "Document",
  "draw.resources.swatches.none": "The drawing has no swatches.",
  "draw.resources.count": "{count} swatches",
  "draw.resources.failed": "This part did not open. Try again to load it.",
  "draw.resources.retry": "Try again",
};

/// La colonna e il cassetto del Disegno completo (K6 T8): la casella «Tutti
/// gli strumenti», il cassetto con la ricerca e i nomi dei suoi gruppi.
export const COLONNA_IT = {
  "draw.chrome.column.all": "Tutti gli strumenti",
  "draw.engine.tool": "Strumento del motore",
  "draw.engine.prepare.failed": "Lo strumento non si è preparato: lo strumento di prima resta. Riprova.",
  "draw.chrome.drawer.title": "Tutti gli strumenti",
  "draw.chrome.drawer.note": "Scegline uno per usarlo adesso.",
  "draw.chrome.drawer.search": "Cerca uno strumento",
  "draw.chrome.drawer.empty": "Nessuno strumento ha quel nome.",
  "draw.chrome.drawer.edit": "Modifica la colonna…",
  "draw.chrome.drawer.failed": "Il cassetto non si è aperto. Riprova.",
  "draw.chrome.drawer.group.pick": "Selezione",
  "draw.chrome.drawer.group.ink": "Disegna",
  "draw.chrome.drawer.group.shape": "Forme",
  "draw.chrome.drawer.group.text": "Testo",
} as const;

/// L'inglese della colonna e del cassetto.
export const COLONNA_EN: Record<keyof typeof COLONNA_IT, string> = {
  "draw.chrome.column.all": "All tools",
  "draw.engine.tool": "Engine tool",
  "draw.engine.prepare.failed": "The tool did not get ready: the previous tool stays. Try again.",
  "draw.chrome.drawer.title": "All tools",
  "draw.chrome.drawer.note": "Choose one to use it now.",
  "draw.chrome.drawer.search": "Search for a tool",
  "draw.chrome.drawer.empty": "No tool has that name.",
  "draw.chrome.drawer.edit": "Edit the column…",
  "draw.chrome.drawer.failed": "The drawer did not open. Try again.",
  "draw.chrome.drawer.group.pick": "Selection",
  "draw.chrome.drawer.group.ink": "Draw",
  "draw.chrome.drawer.group.shape": "Shapes",
  "draw.chrome.drawer.group.text": "Text",
};
