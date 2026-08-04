// **Gli accordi dei comandi di shell, in un posto solo** — e la ragione per cui
// esistono qui invece che accanto a chi li dichiara.
//
// La regola del §18.2 è che chi ha interesse dichiara e nessuno tiene la lista
// di tutti: i pannelli registrano i propri comandi al montaggio, e va bene per
// tutto ciò che riguarda un comando **da solo**. Ma un conflitto di scorciatoie
// non è una proprietà di un comando: è una proprietà della **coppia**, e nessuno
// dei due lati la può vedere. `Mod-Shift-f` è stato dichiarato due volte — dal
// kernel per `search.open` e da qui per il pannello della ricerca — e la shell
// ha eseguito per mesi quello sbagliato senza che niente diventasse rosso,
// perché i due registri si incontrano solo dentro l'app in esecuzione.
//
// Un banco non li può mettere insieme come fa l'app: i comandi della shell li
// dichiarano i pannelli, e importare un pannello in un test tira dentro un
// `document` globale che nella suite non c'è. Quindi gli **accordi** — solo
// quelli, non i comandi — si dichiarano qui, in un modulo che non importa
// niente e che chiunque può leggere: il presidio (`keybindings.test.ts`) legge
// questa tabella e la fixture del kernel, e fa la domanda sui due registri
// insieme. Il perché per esteso sta nella
// [0081](../../../docs/decisions/0081-un-accordo-ha-un-proprietario.md).
//
// Che la tabella resti **completa** non è una convenzione da ricordare: è il
// tipo. `ShellCommand.id` è `ShellCommandId`, cioè una chiave di qui, quindi un
// comando di shell che non compaia in questa tabella non compila — nello stesso
// modo in cui `data_root()` ha reso non compilabili i path composti a mano.

/// Gli accordi suggeriti per i comandi della shell, id → accordo.
///
/// `null` per un comando che non ne vuole: sta comunque in tabella, perché
/// l'elenco è quello dei comandi di shell e non quello delle scorciatoie — e un
/// comando che domani ne acquista una deve cambiare **questa** riga, dove il
/// presidio guarda, non una riga in mezzo a un pannello.
export const SHELL_KEYS = {
  "shell.vault.open": "Mod-Shift-o",
  "shell.palette": "Mod-Shift-p",
  "shell.panel.files": "Mod-Shift-e",
  // L'accordo che era conteso. Lo tiene la shell: qui il gesto è completo —
  // si preme e la ricerca è sotto gli occhi — mentre di là serviva compilare
  // un parametro obbligatorio prima di vedere qualcosa (0081).
  "shell.panel.search": "Mod-Shift-f",
  "shell.graph": "Mod-Shift-g",
  "shell.mode.reading": "Mod-e",
  "shell.mode.live": "Mod-Shift-l",
  "shell.pane.split.right": "Mod-\\",
  "shell.pane.split.down": "Mod-Shift-\\",
  "shell.pane.close": "Mod-Shift-w",
  "shell.tab.close": "Mod-w",
  "shell.doc.search": "Mod-f",
  // Il quick switcher (§21.5). `Mod-o` è quello di Obsidian, ed è la ragione
  // per cui non è `Mod-p` come in un editor di codice: chi arriva da lì ha
  // `Mod-Shift-o` già occupato da «apri vault» e le due `o` restano vicine.
  "shell.switcher": "Mod-o",
  // Cancellare le ricerche e le note recenti (§21.7). **Senza accordo**, e non
  // per mancanza di tasti liberi: è un gesto distruttivo che non si annulla —
  // la memoria cancellata non torna — e un tasto premuto per sbaglio è
  // esattamente il modo in cui succederebbe. Si cerca nella palette, dove per
  // arrivarci bisogna averlo scritto.
  "shell.history.clear": null,
  // Le due vie d'uscita da un conflitto di salvataggio (§18.1). **Senza
  // accordo**, e per la ragione di `shell.history.clear` più una sua: sono i
  // due gesti in cui l'utente sceglie quale testo perdere, e un tasto premuto
  // per sbaglio sceglierebbe al posto suo. Si cercano nella palette, dove per
  // arrivarci bisogna averli scritti.
  "shell.doc.conflict.mine": null,
  "shell.doc.conflict.theirs": null,
} as const satisfies Record<string, string | null>;

/// L'id di un comando della shell: uno di quelli in tabella, e nessun altro.
export type ShellCommandId = keyof typeof SHELL_KEYS;
