//! **I comandi della shell, dichiarati di qua** (§16.3).
//!
//! La shell ha un registro di comandi suo — «passa a Lettura», «apri il
//! pannello dei file», «apri un vault» — e sono comandi veri: hanno un id, un
//! titolo, una descrizione e un accordo, e la palette e la tastiera li leggono
//! insieme a quelli del kernel ([0077](../../../docs/decisions/README.md)).
//! Ciò che li distingue è **chi li esegue**: `run()` nella webview, non
//! `invoke_command` di qua. Per questo non sono un [`CommandProvider`] e non
//! entrano nel registro del kernel — un comando che il kernel elenca e non sa
//! invocare sarebbe una bugia dentro il registro.
//!
//! [`CommandProvider`]: fub_abi::traits::CommandProvider
//!
//! # Cosa sta qui, e cosa resta di là
//!
//! Qui stanno **gli id e gli accordi dichiarati**, e nient'altro. Il titolo e la
//! descrizione restano nel catalogo della shell, perché la frase la localizza
//! chi l'ha scritta ([0040](../../../docs/decisions/0192-impostazioni-locale-e-temi.md)) e chi
//! ha scritto «Apri il pannello dei file» è la shell: portarne una copia qui
//! vorrebbe dire trentaquattro stringhe tradotte due volte, e la seconda
//! copia falsa al primo ritocco.
//!
//! Ne segue l'etichetta delle spec qui sotto, che è **l'id nudo**. È la stessa
//! forma delle chiavi di permesso (§23.17) e per una ragione parente: chi
//! disegna la riga sa dire il nome del comando meglio di chi la dichiara, e
//! l'etichetta serve a chi elenca le impostazioni **senza** la shell davanti —
//! lì un id dice qual è il comando, una frase inventata qui no.
//!
//! # Perché gli accordi stanno in Rust e la shell li riceve generati
//!
//! Perché un conflitto di scorciatoie non è una proprietà di un comando: è una
//! proprietà della **coppia**, e i due registri si incontravano solo dentro
//! l'app in esecuzione — `Mod-Shift-f` è stato dichiarato due volte, dal kernel
//! per `search.open` e dalla shell per il pannello della ricerca, e la shell ha
//! eseguito per mesi quello sbagliato senza che niente diventasse rosso
//! ([0081](../../../docs/decisions/0185-capability-un-solo-guard.md)). La
//! 0081 aveva messo la tabella degli accordi di shell in un modulo TypeScript e
//! li aveva fatti incontrare in un banco di là; da questa voce la tabella è
//! **una sola**, sta qui, e di là arriva emessa
//! (`apps/client/src/ui/shell-keys.generated.ts`). Così la domanda sui due registri
//! insieme si può porre anche di qua, dove il registro del kernel è in casa.
//!
//! Che la tabella resti **completa** non è una convenzione da ricordare: di là
//! `ShellCommandId` è una chiave del generato, quindi un comando di shell che
//! non compaia qui non compila.

use fub_abi::settings::{SettingKind, SettingSpec};

/// Gli accordi suggeriti per i comandi della shell, id → accordo.
///
/// `None` per un comando che non ne vuole: sta comunque in tabella, perché
/// l'elenco è quello dei **comandi** di shell e non quello delle scorciatoie —
/// e un comando che domani ne acquista una deve cambiare questa riga, dove il
/// presidio guarda, non una riga in mezzo a un pannello.
///
/// L'ordine è quello in cui la shell li mostra, non alfabetico: è l'ordine in
/// cui li leggerà chi apre la scheda delle scorciatoie.
pub const SHELL_COMMANDS: &[(&str, Option<&str>)] = &[
    ("shell.vault.open", Some("Mod-Shift-o")),
    ("shell.palette", Some("Mod-Shift-p")),
    ("shell.panel.files", Some("Mod-Shift-e")),
    // Mostra nell'albero il documento attivo. **Senza accordo**: è un gesto di
    // orientamento raro, e `Mod-Shift-e` porta già l'albero sotto gli occhi.
    ("shell.explorer.reveal", None),
    // Rinomina e cestina la voce dell'albero col fuoco, o la nota attiva.
    // **Senza accordo**: dentro l'albero li prendono F2 e Canc, tasti nudi
    // della sua keymap locale che un accordo globale non può essere; fuori,
    // cestinare è un gesto distruttivo che un tasto premuto per sbaglio non
    // deve poter fare.
    ("shell.explorer.rename", None),
    ("shell.explorer.trash", None),
    // L'accordo che era conteso. Lo tiene la shell: qui il gesto è completo —
    // si preme e la ricerca è sotto gli occhi — mentre di là serviva compilare
    // un parametro obbligatorio prima di vedere qualcosa (0081).
    ("shell.panel.search", Some("Mod-Shift-f")),
    // Alterna Lettura e l'ultima modalità di scrittura del riquadro.
    ("shell.mode.reading", Some("Mod-e")),
    // **Senza accordo**: `Mod-Shift-l` dentro l'editor è di CodeMirror
    // (`selectSelectionMatches`) e vinceva sempre; `Mod-e` alterna già.
    ("shell.mode.live", None),
    ("shell.mode.source", None),
    ("shell.pane.split.right", Some("Mod-\\")),
    // **Senza accordo**: `Mod-Shift-\` dentro l'editor è
    // `cursorMatchingBracket`, e lo split non partiva mai mentre si scriveva.
    ("shell.pane.split.down", None),
    ("shell.pane.close", Some("Mod-Shift-w")),
    ("shell.tab.close", Some("Mod-w")),
    ("shell.doc.search", Some("Mod-f")),
    // Il quick switcher (§21.5). `Mod-o` è quello di Obsidian, ed è la ragione
    // per cui non è `Mod-p` come in un editor di codice: chi arriva da lì ha
    // `Mod-Shift-o` già occupato da «apri vault» e le due `o` restano vicine.
    ("shell.switcher", Some("Mod-o")),
    // Cancellare le ricerche e le note recenti (§21.7). **Senza accordo**, e non
    // per mancanza di tasti liberi: è un gesto distruttivo che non si annulla —
    // la memoria cancellata non torna — e un tasto premuto per sbaglio è
    // esattamente il modo in cui succederebbe. Si cerca nella palette, dove per
    // arrivarci bisogna averlo scritto.
    ("shell.history.clear", None),
    // Le due vie d'uscita da un conflitto di salvataggio (§18.1). **Senza
    // accordo**, e per la ragione di `shell.history.clear` più una sua: sono i
    // due gesti in cui l'utente sceglie quale testo perdere, e un tasto premuto
    // per sbaglio sceglierebbe al posto suo.
    ("shell.doc.conflict.mine", None),
    ("shell.doc.conflict.theirs", None),
    ("shell.tab.pin", None),
    ("shell.tab.unpin", None),
    // Spostano la scheda col fuoco della tastiera, o l'attiva: lungo la
    // striscia, e nel riquadro prima o dopo. La famiglia di `Mod-PageUp/Down`
    // (`shell.tab.previous/next`), come nei browser: non le frecce, che dentro
    // l'editor sono di CodeMirror (`Alt-Shift-↑/↓` copiano la riga) e in un
    // campo di testo muovono il cursore.
    ("shell.tab.move.left", Some("Mod-Shift-PageUp")),
    ("shell.tab.move.right", Some("Mod-Shift-PageDown")),
    ("shell.tab.move.pane.previous", Some("Mod-Alt-PageUp")),
    ("shell.tab.move.pane.next", Some("Mod-Alt-PageDown")),
    ("shell.tab.close.others", None),
    ("shell.tab.close.unpinned", None),
    // **Senza accordo**: `Mod-Alt-←/→` dentro l'editor sono di CodeMirror.
    // Indietro e avanti passano dai tasti laterali del mouse e dai due
    // bottoni nella toolbar del riquadro.
    ("shell.pane.back", None),
    ("shell.pane.forward", None),
    ("shell.pane.link", None),
    ("shell.pane.unlink", None),
    ("shell.bookmarks.toggle", None),
    ("shell.bookmarks.save", None),
    ("shell.bookmarks.open", None),
    ("shell.bookmarks.group", None),
    // Mostra o nasconde il pannello dei workspace, come i segnalibri.
    ("shell.workspace.toggle", None),
    ("shell.workspace.save", None),
    ("shell.workspace.load", None),
    ("shell.workspace.update", None),
    ("shell.workspace.rename", None),
    ("shell.workspace.delete", None),
    ("shell.preview.show", None),
    ("shell.preview.hide", None),
    // Il salvataggio è automatico; `Mod-s` svuota subito la coda e riprova
    // dopo un guasto, il gesto che le dita fanno comunque.
    ("shell.doc.save", Some("Mod-s")),
    ("shell.note.new", Some("Mod-n")),
    ("shell.settings", Some("Mod-,")),
    // I pannelli laterali si mostrano e si nascondono; a finestra stretta
    // aprono il cassetto invece di restare irraggiungibili.
    ("shell.sidebar.toggle", Some("Mod-Alt-b")),
    ("shell.inspector.toggle", Some("Mod-Alt-i")),
    ("shell.tab.reopen", Some("Mod-Shift-t")),
    ("shell.tab.next", Some("Mod-PageDown")),
    ("shell.tab.previous", Some("Mod-PageUp")),
    ("shell.zoom.in", Some("Mod-=")),
    ("shell.zoom.out", Some("Mod--")),
    ("shell.zoom.reset", Some("Mod-0")),
    // La scrittura senza cornice: via pannelli, rail e toolbar.
    ("shell.focus.toggle", None),
];

/// Le chiavi di configurazione che hanno un gesto loro, e che nel form generico
/// delle impostazioni sarebbero un campo da non toccare a mano.
///
/// Stanno qui e non in un pannello della shell per la ragione degli accordi:
/// alcune sono di chi le dichiara (i tipi delle proprietà sono del kernel, e li
/// disegna il pannello Proprietà), e la shell le riceve generate
/// (`apps/client/src/ui/shell-ids.generated.ts`) invece di scriverne l'id per
/// letterale. Un rename del proprietario non compila finché questa riga non lo
/// segue.
pub const SETTINGS_WITH_THEIR_OWN_GESTURE: &[&str] = &[
    // La versione del formato dell'interfaccia.
    crate::settings::CHROME_SCHEMA,
    // La scheda Componenti.
    crate::settings::PLUGINS_DISABLED,
    // Ordine e icone nascoste si gestiscono dalla barra laterale.
    crate::settings::CHROME_RAIL_ORDER,
    crate::settings::CHROME_RAIL_HIDDEN,
    // Il pannello Proprietà.
    fub_kernel::properties::TYPES,
    // Il catalogo dei temi.
    crate::settings::APPEARANCE_THEME_ID,
];

/// Il job il cui esito, quando riesce, può portare gli artefatti di un export
/// da posare dove sceglie l'utente: import ed export passano dallo stesso job, e
/// l'esito dell'export si riconosce dagli `artifacts` di un
/// [`ExportReport`](fub_abi::transfer::ExportReport).
pub const ARTIFACT_JOB: &str = fub_importers::transfer_commands::TRANSFER_JOB;

/// Le impostazioni `keys.shell.*`, una per comando di shell (§16.3).
///
/// **Di macchina**, e non è un'eccezione appiccicata: è la regola che questa
/// voce ha trovato — *lo scope di una chiave segue la vita di ciò che la
/// dichiara*. Un comando del kernel esiste finché un vault è montato, quindi la
/// sua chiave sta nel vault e viaggia con lui (§23.13). Un comando della shell
/// esiste finché l'app è aperta, e `shell.vault.open` è il comando che esiste
/// **prima** di ogni vault: una sua chiave di vault nascerebbe solo dopo che un
/// vault è aperto — cioè quando serve meno — e vivrebbe dentro il vault che
/// serve ad aprire.
///
/// Il default è l'accordo dichiarato, come per le chiavi dei comandi del kernel
/// (`Workspace::keybinding_specs`), e ne segue la stessa proprietà: il valore
/// *efficace* della chiave **è** la scorciatoia, sempre, quindi a valle non
/// serve nessuna regola di fusione.
///
/// **Nessun gruppo**, e nessuna descrizione: la scheda delle scorciatoie le
/// raggruppa per conto suo e ci scrive sopra il titolo del comando, che è
/// l'unica cosa che di là si sa dire e di qua no.
pub fn shell_keybinding_specs() -> Vec<SettingSpec> {
    SHELL_COMMANDS
        .iter()
        .map(|(id, chord)| {
            SettingSpec::new(
                fub_abi::settings::keybinding_key(id),
                (*id).to_string(),
                SettingKind::Text {
                    default: chord.unwrap_or_default().to_string(),
                },
            )
            .for_machine()
        })
        .collect()
}
