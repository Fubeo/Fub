//! **Quali file del vault partecipano** (§15.6): la politica di esclusione.
//!
//! Fino a qui la regola era una costante di compilazione — un `&[&str]` nel
//! sorgente del vault, letto da una funzione che aggiungeva «e tutto ciò che
//! comincia per punto». Funzionava, e il difetto non era dove stava: era
//! **cos'era**. Una lista sola metteva nella stessa specie due esclusioni che
//! non si somigliano affatto.
//!
//! # Le due specie, ed è tutta la decisione
//!
//! - **La struttura.** `.fub/` è dove Fub scrive; `.trash/` è il cestino
//!   condiviso con Obsidian; il temporaneo di una scrittura atomica vive dentro
//!   il vault per una frazione di secondo. Nessuna di queste tre è una
//!   preferenza di chi apre il vault: mostrarle vorrebbe dire indicizzare
//!   l'indice, riesumare come documenti le note appena cestinate, e dare un
//!   [`DocId`](fub_abi::DocId) a un file che fra un istante non esiste più.
//!   Nessuna impostazione le rivela, ed è [`is_structural`].
//! - **La preferenza.** Che `node_modules/` o `.git/` non siano note è vero
//!   quasi sempre e non è vero per costruzione; che i dotfile si vedano o no è
//!   una domanda che ha due risposte legittime (§3.2 del catalogo). Sono
//!   **dato**, per-vault, e adesso hanno dove stare: una chiave dichiarata
//!   ([0036](../../../docs/decisions/0036-le-impostazioni-e-i-tre-stati.md)).
//!
//! Finché le due specie erano una lista sola, «esclusa» voleva dire una cosa
//! che nessuno poteva cambiare e una cosa che nessuno poteva scegliere, cioè il
//! peggio delle due.
//!
//! # Perché è del vault e non della macchina
//!
//! Perché descrive **questi file**: un vault che contiene un repo git lo
//! contiene su tutti i computer da cui lo si apre, e un vault che nasconde una
//! cartella su una macchina sola sarebbe due idee di cosa c'è dentro — la
//! stessa ragione della [0076](../../../docs/decisions/0076-le-impostazioni-vivono-nel-vault.md)
//! e la stessa forma di [`properties`](crate::properties).
//!
//! # Quando un nome dichiarato è **quel** nome
//!
//! Una dichiarazione è una frase scritta una volta e portata su ogni macchina,
//! e per questo la domanda «l'utente che ha scritto `node_modules` intendeva
//! questa cartella?» non può avere due risposte a seconda di dove il vault è
//! aperto. La risposta è la stessa del resto del progetto: la chiave di
//! [`resolution_key`](fub_abi::rules::path::resolution_key) — trim, NFC,
//! minuscolo — che è l'unico punto in cui si decide *quando due nomi sono lo
//! stesso nome*. Ci passano sia i nomi dichiarati sia il nome che arriva dal
//! disco, e ci passa anche [`is_structural`]: `.Fub` su un filesystem
//! insensibile al caso **è** `.fub`, e non escluderla sarebbe indicizzare
//! l'indice.
//!
//! Le due riproduzioni per cui la regola esiste, misurate: un `files.excluded-folders`
//! che dice `Café` scritto in NFC non escludeva la stessa cartella scritta in
//! NFD da macOS, e un `node_modules` dichiarato non escludeva `Node_Modules`
//! su un filesystem insensibile al caso — cioè la stessa dichiarazione, sullo
//! stesso vault sincronizzato, diceva due cose diverse.
//!
//! **Il verso opposto è stato misurato e scelto, non subito.** Piegare il caso
//! vuol dire che su Linux, dove `Build` e `build` possono coesistere davvero,
//! dichiararne una esclude entrambe. Fra i due errori si preferisce questo, per
//! tre ragioni: un'esclusione mancata è **silenziosa** e dipende dalla macchina
//! (una cartella di moduli che entra nell'indice, e un vault con due idee di
//! cosa contiene), mentre un'esclusione di troppo si **vede** — la cartella non
//! è nell'elenco dei file, e chi l'ha dichiarata sa cosa ha scritto; un vault
//! che contiene `Build` e `build` non è portabile a prescindere da noi, ed è
//! ciò che `HealthCheck::CollidingPaths` è lì per dire; e la stessa regola vale
//! già per i wikilink, dove `[[Nota]]` e `[[nota]]` sono lo stesso riferimento
//! ([0107](../../../docs/decisions/0107-il-caso-di-una-lettera.md)).
//! Sarebbe incoerente che due nomi fossero lo stesso documento per il grafo e
//! due cartelle diverse per la scansione.
//!
//! # I collegamenti: decisi, e non configurabili oggi
//!
//! Un symlink non partecipa. Dalla [0058] è ciò che *succede* — la scansione
//! chiede la specie con `file_type()`, che non segue il link, e un symlink
//! arriva come [`EntryKind::Other`](crate::storage::EntryKind::Other) — e da
//! qui è ciò che è **deciso**: la §15.6 li ha ricevuti dalla 0058 perché
//! «seguire un collegamento» è «questa voce di directory partecipa», che è la
//! domanda di questo modulo.
//!
//! Non sono un interruttore, e il verso conservativo è scartato **avendolo
//! detto**: seguirli si può fare solo sapendo riconoscere un nodo già visitato,
//! cioè avendone l'identità (`dev`+`ino` su Unix, l'indice del file su
//! Windows). Il [`VaultStorage`](crate::storage::VaultStorage) non ce l'ha, e
//! non ce l'ha di proposito (§15.1: un supporto può essere una memoria, un
//! archivio, un servizio). Senza identità, `a/collegamento -> a` è una
//! scansione che non torna: un'impostazione che accendesse quel caso sarebbe
//! una facoltà di appendere l'apertura del vault, e un'impostazione così non è
//! una facoltà. Il giorno in cui un supporto sa dire «questi due path sono lo
//! stesso nodo», la chiave si aggiunge qui accanto alle altre due.
//!
//! [0058]: ../../../docs/decisions/0058-un-nome-che-nasce.md
//!
//! # Una cartella dichiarata è **una cartella**, e si scrive come si scrive
//!
//! La chiave si chiama «cartelle escluse» e la sua frase dice «le cartelle che
//! non fanno parte di questo vault». Per due volte non era vero.
//!
//! Chi la dichiara arriva quasi sempre da un `.gitignore`, e lì `build/` è la
//! forma che si scrive per prima: lo slash finale è **come si nomina una
//! cartella**, non un secondo componente di path. Confrontata per uguaglianza
//! con un nome che dal disco arriva senza slash, quella dichiarazione non
//! combaciava con niente — e non se ne accorgeva nessuno, perché un'esclusione
//! che non scatta non dà errore: dà un vault che indicizza `build/` e chi l'ha
//! scritta convinto di averlo escluso. Le dichiarazioni passano da
//! [`folders::normalized`](fub_abi::rules::folders::normalized), che è la
//! stessa regola con cui il resto del progetto decide dove finisce una cartella
//! (difetto 0141): `build/`, `/build` e `build` sono la stessa cartella qui
//! come in una query.
//!
//! E una cartella esclusa escludeva anche i **file** che si chiamano allo
//! stesso modo. Un file di nome `build` accanto alla cartella `build/` spariva
//! dal vault senza che niente lo dicesse, ed è il danno peggiore di questo
//! modulo: non è un file che non si vede, è un file che non c'è — nessun
//! [`DocId`](fub_abi::DocId), nessuna voce d'anagrafe, nessun evento. Per
//! per questo [`IgnorePolicy::excludes`] chiede la [`Kind`]: la struttura e i
//! nascosti valgono per tutte e due, l'elenco dichiarato solo per le cartelle.
//! Chi cammina l'albero la specie ce l'ha già in mano — gliela dà la voce di
//! directory —, e chi giudica un path intero sa che tutto ciò che sta *in
//! mezzo* è una cartella per costruzione.
//!
//! # Le altre quattro politiche, e come si compongono
//!
//! Sullo stesso albero ne servono cinque: questa, l'esclusione dalla ricerca
//! (§9.1), quella dal sync (§18.1), quella dal contesto dell'AI (§23.2) e la
//! lettura del `.gitignore` (§3.1). La regola che le tiene insieme si scrive
//! qui perché qui c'è la prima: **si compongono per sottrazione**. Quella del
//! vault dice cosa è un file del vault, e le altre possono solo togliere
//! ancora — una cartella che non è nel vault non può essere nel sync, e una
//! ricerca non può ripescare ciò che il vault non contiene. Ognuna dichiarerà
//! la propria chiave e costruirà il proprio [`IgnorePolicy`] con questo
//! valutatore: il valore è parametrico, la lista arriva da chi chiede, e
//! nessuna di loro può ridefinire cos'è la struttura.

use std::collections::BTreeSet;

use fub_abi::rules::folders;
use fub_abi::rules::path::resolution_key;
use fub_abi::settings::{SettingKind, SettingSpec, SettingValue};
use fub_abi::text::{StringCatalog, Text};

use crate::settings::SharedSettings;
use crate::vault::{FUB_DIR, TRASH_DIR};

/// Le cartelle che questo vault non considera parte di sé.
pub const EXCLUDED_FOLDERS: &str = "files.excluded-folders";

/// I file che cominciano per punto sono documenti di questo vault?
pub const SHOW_HIDDEN: &str = "files.show-hidden";

/// Ciò che un vault esclude quando non dichiara niente: la lista che fino alla
/// §15.6 era la costante `IGNORED_DIRS`, meno le due che sono **struttura** e
/// che nessuna dichiarazione può togliere.
///
/// # Che cosa fa entrare un nome qui
///
/// Non «le cartelle che di solito non servono», che è un elenco senza fine:
/// **ciò che un attrezzo scrive e nessuno legge**. Un nome entra se soddisfa
/// tutte e tre — il suo contenuto lo rigenera un comando, dentro non ci si
/// scrivono note, e il nome è una convenzione abbastanza forte che usarlo per
/// le proprie note sorprenderebbe chi lo legge. `node_modules` e `.git` erano
/// già così; `target` è lo stesso nome per Cargo, ed è entrato per un vault
/// misurato: quello di questo progetto (difetto 0118).
///
/// I due errori non si pagano uguale, ed è la ragione per cui la lista è corta
/// ma non vuota. Un nome che manca costa **silenzio**: da quando il vault dice
/// cosa contiene invece di filtrare per estensione (§14.1), ogni file di
/// `target/` prende un [`DocId`](fub_abi::DocId) ed entra in anagrafe — decine
/// di migliaia di voci, un indice che le porta, e una ricerca che pesca
/// artefatti; e non se ne accorge nessuno finché non è già successo. Un nome
/// di troppo costa **una riga da togliere** da un elenco che si vede, in una
/// casella che l'utente compila. Questo è un default, non una regola: chi
/// dichiara la propria lista la sostituisce, e chi tiene le sue note in una
/// cartella che si chiama `target` scrive una riga e ha finito.
pub const DEFAULT_EXCLUDED: &[&str] = &[".obsidian", ".git", "node_modules", "target"];

/// Questa **chiave** è struttura, cioè non è roba dell'utente?
///
/// È la metà della politica che nessuna impostazione può spostare, e le quattro
/// righe che contiene sono quattro danni diversi: la cartella di Fub è dove sta
/// l'indice (indicizzarlo lo raddoppierebbe a ogni giro), il cestino contiene
/// note che qualcuno ha buttato (mostrarle è riesumarle), il temporaneo di
/// una scrittura è un file che fra un istante non esiste — chi lo vedesse gli
/// darebbe un [`DocId`](fub_abi::DocId) e lo perderebbe subito dopo — e il
/// compagno di lock è un file che invece **non se ne va mai**, perché toglierlo
/// romperebbe il lock (difetto 0151): l'unica cosa che si può togliere è che si
/// veda.
///
/// Riceve una chiave di [`resolution_key`] e non un nome di directory grezzo:
/// le tre costanti che confronta sono già in quella forma, e su un filesystem
/// insensibile al caso `.Fub` è la cartella di Fub.
/// Questo nome è il temporaneo di **un altro attrezzo**?
///
/// Non è la gemella di [`is_write_temporary`](crate::storage::is_write_temporary)
/// e non le sta accanto: quella riconosce una forma che il kernel **scrive**, e
/// chi conosce una forma è chi la scrive; questa riconosce le forme che
/// scrivono gli altri, che nessuno qui compone e che quindi sono una politica —
/// una convenzione letta da fuori, non un contratto.
///
/// Ne vale la pena perché il costo è già misurato: da quando il vault dice cosa
/// contiene invece di filtrare per estensione (§14.1) ogni file prende un
/// [`DocId`](fub_abi::DocId), quindi il file d'appoggio che LibreOffice o Word
/// scrivono accanto alla nota entra in anagrafe, compare nell'esploratore e
/// sparisce da sé qualche secondo dopo — una voce che nasce e muore da sola, e
/// un `DocId` bruciato ogni volta che si salva da un altro programma (difetto
/// 0201).
///
/// Tre forme e non un elenco che cresce, scelte con lo stesso metro di
/// [`DEFAULT_EXCLUDED`]: il contenuto lo rigenera l'attrezzo, dentro non ci si
/// scrivono note, e il nome è una convenzione abbastanza vecchia che usarla per
/// una nota propria sorprenderebbe chi la legge. Le altre forme che si
/// incontrano — `.goutputstream-…` di GLib, `.nota.md.swp` di vim, `.~lock…#`
/// di LibreOffice, `.#nota.md` di Emacs — cominciano già per punto, e chi le
/// prende è la riga dei nascosti.
///
/// Sta **con i nascosti** e non con la struttura, che è senza appello: chi ha
/// davvero un file che si chiama così lo rivede accendendo «mostra i file
/// nascosti», che è la stessa via di uscita che ha già oggi per i `.qualcosa`.
/// Una regola senza uscita toglierebbe un file davvero, e senza dirlo.
pub(crate) fn is_foreign_temporary(key: &str) -> bool {
    // `~$nota.docx`: il file di proprietà che Office scrive accanto a quello
    // aperto, e che resta lì finché la finestra è aperta.
    let office = key
        .strip_prefix("~$")
        .is_some_and(|rest| !rest.is_empty());
    // `nota.md~`: la copia di prima, che lasciano dietro Emacs, gedit, kate,
    // joe e mezzo Unix.
    let copy = key.strip_suffix('~').is_some_and(|base| !base.is_empty());
    // `#nota.md#`: il salvataggio automatico di Emacs, che non comincia per
    // punto e quindi non lo prende nessun'altra riga.
    let autosave = key.len() > 2 && key.starts_with('#') && key.ends_with('#');
    office || copy || autosave
}

pub(crate) fn is_structural(key: &str) -> bool {
    key == FUB_DIR
        || key == TRASH_DIR
        || crate::storage::is_write_temporary(key)
        || crate::storage::is_write_lock(key)
}

/// Che cosa è la voce di cui si sta chiedendo.
///
/// Esiste perché una delle tre regole non risponde uguale alle due: l'elenco
/// dichiarato si chiama «cartelle escluse» e vale per le cartelle, mentre la
/// struttura e i nascosti valgono per qualunque cosa porti quel nome. Senza
/// questa parola un file chiamato `build` spariva dal vault insieme alla
/// cartella `build/` (difetto 0176).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    /// Una cartella: contiene, e può essere dichiarata esclusa.
    Folder,
    /// Un file, o comunque una voce che non contiene niente.
    File,
}

/// La politica di esclusione che vale per un albero, come **valore**.
///
/// Non è un elenco di nomi: è un elenco di nomi *più* la risposta sui nascosti,
/// e le due cose insieme sono ciò che sta scritto in una lista sola quando la
/// politica è una costante. Chi la costruisce dichiara le due metà; chi la
/// interroga chiede di un nome per volta, a qualunque profondità, ed è ciò che
/// permette a [`Vault::is_ignored`](crate::vault::Vault::is_ignored) e alla
/// scansione di essere la stessa regola.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IgnorePolicy {
    folders: BTreeSet<String>,
    show_hidden: bool,
}

impl Default for IgnorePolicy {
    /// La politica di un vault che non ha dichiarato niente, che è anche quella
    /// di un kernel montato senza il bundle del core: **esattamente** ciò che
    /// il vault faceva prima della §15.6.
    fn default() -> Self {
        IgnorePolicy::declaring(DEFAULT_EXCLUDED.iter().map(|s| s.to_string()), false)
    }
}

impl IgnorePolicy {
    /// La politica dichiarata: le cartelle escluse, e se i nascosti si vedono.
    ///
    /// Le cartelle entrano come **chiavi** ([`resolution_key`]): chi dichiara
    /// scrive un nome, e il nome che il disco restituirà per quella cartella
    /// dipende dalla macchina — la composizione Unicode e il caso non sono
    /// scelte di chi ha scritto la frase.
    ///
    /// E prima ancora passano da
    /// [`folders::normalized`](fub_abi::rules::folders::normalized),
    /// perché nemmeno gli slash sono una scelta: `build/` è come si nomina una
    /// cartella per chi arriva da un `.gitignore`, e confrontato per uguaglianza
    /// con un nome che dal disco arriva senza slash non escludeva niente, in
    /// silenzio (difetto 0176). Ciò che si riduce a niente — `/`, o una riga
    /// lasciata vuota — non entra affatto: una chiave vuota non combacia con
    /// nessun nome, e tenerla vorrebbe dire portarsi in giro una dichiarazione
    /// che non dichiara.
    pub fn declaring(folders: impl IntoIterator<Item = String>, show_hidden: bool) -> Self {
        IgnorePolicy {
            folders: folders
                .into_iter()
                .map(|f| resolution_key(folders::normalized(&f)))
                .filter(|key| !key.is_empty())
                .collect(),
            show_hidden,
        }
    }

    /// Questo componente di path non partecipa?
    ///
    /// La struttura per prima e senza appello: è ciò che rende «mostra i
    /// nascosti» una preferenza sicura invece di un interruttore che apre la
    /// cartella di Fub alla scansione.
    ///
    /// Il nome diventa una chiave **una volta sola e in cima**, e da lì in giù
    /// il nome grezzo non è più raggiungibile: le tre domande sono la stessa
    /// domanda, e il quarto ramo che qualcuno aggiungerà eredita la regola
    /// invece di doverla ripetere.
    ///
    /// Le prime due valgono per qualunque [`Kind`] — la cartella di Fub non
    /// diventa un documento perché qualcuno ci mette accanto un file omonimo —
    /// mentre l'elenco dichiarato parla di cartelle e solo di quelle: un file
    /// che si chiama come una cartella esclusa è un file di questo vault, e
    /// toglierlo sarebbe toglierlo davvero, senza [`DocId`](fub_abi::DocId) e
    /// senza un evento che lo dica (difetto 0176).
    pub fn excludes(&self, name: &str, kind: Kind) -> bool {
        let name = resolution_key(name);
        if is_structural(&name) {
            return true;
        }
        // Il punto davanti e la convenzione dell'attrezzo che lo ha scritto
        // sono la stessa domanda — «questo lo ha messo qui un programma per
        // sé?» — e stanno sulla stessa riga perché abbiano la stessa uscita.
        if !self.show_hidden && (name.starts_with('.') || is_foreign_temporary(&name)) {
            return true;
        }
        kind == Kind::Folder && self.folders.contains(&name)
    }
}

/// La politica che vale **adesso** per un vault, letta dalle sue impostazioni.
///
/// A ogni domanda e non una volta al montaggio, per la ragione di
/// `CoreIndex::date_formats`: chi cambia la
/// dichiarazione cambia cosa il vault contiene, e una politica risolta al
/// montaggio direbbe di no **anche dopo** che l'utente ha riparato la causa.
/// Chi non ha impostazioni — un `Vault` costruito a mano, un kernel montato
/// senza il core — prende il [default](IgnorePolicy::default), che è il
/// comportamento di prima.
pub(crate) fn resolve(settings: Option<&SharedSettings>) -> IgnorePolicy {
    let Some(store) = settings.and_then(|s| s.read().ok()) else {
        return IgnorePolicy::default();
    };
    let folders = match store.effective(EXCLUDED_FOLDERS) {
        Ok((SettingValue::List(v), _)) => v,
        _ => DEFAULT_EXCLUDED.iter().map(|s| s.to_string()).collect(),
    };
    let show_hidden = matches!(
        store.effective(SHOW_HIDDEN),
        Ok((SettingValue::Toggle(true), _))
    );
    IgnorePolicy::declaring(folders, show_hidden)
}

/// Le impostazioni che il core dichiara per l'esclusione.
///
/// Di livello **vault**: descrivono questi file, e sono la sola cosa che deve
/// viaggiare con loro.
///
/// **Non** `program_writable`, e per una ragione più stretta di quella del
/// tema: un componente che potesse aggiungere una cartella all'elenco
/// toglierebbe dal vault le note che ci stanno dentro — senza toccare un file,
/// e con l'unico segnale di un elenco che si accorcia.
pub fn ignore_settings() -> Vec<SettingSpec> {
    vec![
        SettingSpec::new(
            EXCLUDED_FOLDERS,
            Text::key(THE_EXCLUDED),
            SettingKind::List {
                default: DEFAULT_EXCLUDED.iter().map(|s| s.to_string()).collect(),
            },
        )
        .describing(Text::key(THE_EXCLUDED_DESC))
        .grouped(Text::key(THE_GROUP)),
        SettingSpec::new(
            SHOW_HIDDEN,
            Text::key(THE_HIDDEN),
            SettingKind::Toggle { default: false },
        )
        .describing(Text::key(THE_HIDDEN_DESC))
        .grouped(Text::key(THE_GROUP)),
    ]
}

const THE_GROUP: &str = "files.group";
const THE_EXCLUDED: &str = "files.excluded_folders";
const THE_EXCLUDED_DESC: &str = "files.excluded_folders.desc";
const THE_HIDDEN: &str = "files.show_hidden";
const THE_HIDDEN_DESC: &str = "files.show_hidden.desc";

/// Le frasi di queste impostazioni, nel catalogo di chi le ha scritte (0040).
///
/// Ognuna delle due descrizioni dice **cosa resta escluso comunque**: è
/// l'informazione che manca a chi accende l'interruttore e si aspetta di
/// vedere tutto, ed è anche l'unica forma in cui la distinzione fra struttura e
/// preferenza arriva a chi non legge il sorgente.
pub fn catalog() -> Vec<StringCatalog> {
    vec![
        StringCatalog::new("it")
            .with(THE_GROUP, "File")
            .with(THE_EXCLUDED, "Cartelle escluse")
            .with(
                THE_EXCLUDED_DESC,
                "Le cartelle che non fanno parte di questo vault: non sono \
                 documenti, non si cercano, non compaiono nell'elenco dei file. \
                 Vale a qualunque profondità, per nome, senza distinzione fra \
                 maiuscole e minuscole: `node_modules` esclude anche \
                 `Node_Modules`, perché su alcuni sistemi sono la stessa \
                 cartella e il vault è lo stesso su tutti. Lo slash si può \
                 scrivere o no — `build`, `build/` e `/build` sono la stessa \
                 cartella — e parla di **cartelle**: un file che si chiama come \
                 una di loro resta un file di questo vault. La cartella di Fub \
                 (`.fub`), il cestino (`.trash`) e i file di servizio di una \
                 scrittura — il temporaneo e il compagno di lock — restano \
                 esclusi comunque: non sono una preferenza. \
                 Un cambiamento vale dal prossimo «Ricostruisci gli indici».",
            )
            .with(THE_HIDDEN, "Mostra i file nascosti")
            .with(
                THE_HIDDEN_DESC,
                "Considera documenti anche i file e le cartelle il cui nome \
                 comincia per punto. Restano esclusi comunque la cartella di \
                 Fub, il cestino, i file di servizio di una scrittura e tutto ciò \
                 che è elencato fra le cartelle escluse. Un cambiamento vale dal \
                 prossimo «Ricostruisci gli indici».",
            ),
        StringCatalog::new("en")
            .with(THE_GROUP, "Files")
            .with(THE_EXCLUDED, "Excluded folders")
            .with(
                THE_EXCLUDED_DESC,
                "The folders that are not part of this vault: not documents, \
                 not searched, not listed. Matched by name, at any depth, \
                 ignoring case: `node_modules` also excludes `Node_Modules`, \
                 because on some systems they are the same folder and the vault \
                 is the same everywhere. Slashes are optional — `build`, \
                 `build/` and `/build` are the same folder — and this is about \
                 **folders**: a file named like one of them stays a file of \
                 this vault. Fub's \
                 own folder (`.fub`), the trash (`.trash`) and the service files \
                 of a write — the temporary and the lock companion — stay \
                 excluded regardless: they are not a \
                 preference. A change applies from the next «Rebuild indexes».",
            )
            .with(THE_HIDDEN, "Show hidden files")
            .with(
                THE_HIDDEN_DESC,
                "Treat files and folders whose name starts with a dot as \
                 documents too. Fub's own folder, the trash, the service \
                 files of a write and everything listed under excluded folders \
                 stay excluded regardless. A change applies from the next \
                 «Rebuild indexes».",
            ),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Un vault che non dichiara niente si comporta come prima della §15.6.
    #[test]
    fn default_policy_excludes_like_before() {
        let p = IgnorePolicy::default();
        for name in [
            ".obsidian",
            ".git",
            ".fub",
            ".trash",
            "node_modules",
            "target",
        ] {
            assert!(p.excludes(name, Kind::Folder), "{name}");
        }
        assert!(
            p.excludes(".bozza.md", Kind::File),
            "a hidden file is excluded"
        );
        assert!(!p.excludes("Idea.md", Kind::File));
        assert!(!p.excludes("progetti", Kind::Folder));
    }

    /// **Il file d'appoggio di un altro programma non è una nota**, e non deve
    /// nascere in anagrafe per morirci qualche secondo dopo (difetto 0201).
    ///
    /// Le forme che cominciano per punto le prendeva già la riga dei nascosti;
    /// queste tre non cominciano per punto, e prima di questa riga passavano.
    #[test]
    fn other_programs_temporary_files_are_not_notes() {
        let p = IgnorePolicy::default();
        for name in ["~$Relazione.docx", "Nota.md~", "#Nota.md#"] {
            assert!(
                p.excludes(name, Kind::File),
                "{name} gets a DocId, appears in the explorer, and vanishes on \
                 its own: an entry born and dying by itself at every save"
            );
        }
        // E non un carattere in più di così: il `~` e il `#` dentro un nome sono
        // caratteri come gli altri, e una regola che li prendesse toglierebbe
        // note vere.
        for name in ["Nota~2.md", "#hashtag.md", "~.md", "Nota.md"] {
            assert!(!p.excludes(name, Kind::File), "{name}");
        }
    }

    /// La via d'uscita è quella che c'è già: sono nascosti per convenzione di
    /// chi li scrive, non struttura, quindi chi vuole vederli accende
    /// l'interruttore che accende anche i `.qualcosa`.
    #[test]
    fn showing_hidden_files_reveals_those_too() {
        let all = IgnorePolicy::declaring(Vec::new(), true);
        assert!(!all.excludes("Nota.md~", Kind::File));
        assert!(!all.excludes("~$Relazione.docx", Kind::File));
        // La struttura invece resta senza appello, com'era.
        assert!(all.excludes(FUB_DIR, Kind::Folder));
    }

    /// **Il cuore della voce**: le due specie non sono la stessa lista. Un vault
    /// che mostra tutto ciò che è preferenza continua a non vedere ciò che è
    /// struttura — se no, l'indice si indicizzerebbe e il cestino tornerebbe a
    /// essere un elenco di note.
    #[test]
    fn no_declaration_reveals_the_structure() {
        let all = IgnorePolicy::declaring(Vec::new(), true);
        assert!(all.excludes(FUB_DIR, Kind::Folder));
        // E nemmeno un file che si chiamasse come loro: la struttura non è un
        // elenco di cartelle, è dove Fub scrive.
        assert!(all.excludes(FUB_DIR, Kind::File));
        assert!(all.excludes(TRASH_DIR, Kind::Folder));
        // La preferenza, invece, si sposta davvero.
        assert!(!all.excludes(".bozza.md", Kind::File));
        assert!(!all.excludes("node_modules", Kind::Folder));
    }

    /// Dichiarare l'elenco lo **sostituisce**, non lo allunga: chi lo scrive sta
    /// dicendo cosa non è suo, e una lista che si sommasse a una costante
    /// invisibile sarebbe di nuovo una politica per metà nel sorgente.
    #[test]
    fn declaring_folders_replaces_the_default() {
        let p = IgnorePolicy::declaring(["build".to_string()], false);
        assert!(p.excludes("build", Kind::Folder));
        assert!(!p.excludes("node_modules", Kind::Folder));
        // I nascosti sono l'altra metà e non si muovono con questa.
        assert!(p.excludes(".git", Kind::Folder));
    }

    /// **La riparazione della 0110 con la 0107 in mano**: la stessa cartella
    /// scritta in NFC e in NFD è la stessa cartella.
    ///
    /// Non si presidia sul filesystem, e non per comodità: il caso vero è un
    /// vault sincronizzato con macOS, dove i nomi arrivano in NFD, e un banco
    /// `#[cfg(target_os = "macos")]` in questa CI non verrebbe nemmeno
    /// compilato — cioè presidierebbe **niente** restando verde. Le due
    /// scritture della stessa stringa si costruiscono qui, e la funzione è
    /// pura.
    #[test]
    fn a_folder_declared_in_nfc_is_the_same_written_in_nfd() {
        let nfc = "Caf\u{e9}"; // «Café» come lo scrive una tastiera
        let nfd = "Cafe\u{301}"; // «Café» come lo scrive macOS sul disco
        assert_ne!(nfc, nfd, "the two writings are different bytes");

        let p = IgnorePolicy::declaring([nfc.to_string()], false);
        assert!(
            p.excludes(nfd, Kind::Folder),
            "the macOS folder was not excluded"
        );
        // E nell'altro verso, perché la dichiarazione può nascere su macOS.
        let p = IgnorePolicy::declaring([nfd.to_string()], false);
        assert!(p.excludes(nfc, Kind::Folder));
    }

    /// La seconda riproduzione: su un filesystem insensibile al caso
    /// `Node_Modules` è `node_modules`, e la dichiarazione non lo sapeva.
    ///
    /// Vale anche per la **struttura**, che non è dichiarata da nessuno: `.FUB`
    /// e `.fub` sono la stessa cartella dove c'è l'indice.
    #[test]
    fn a_single_letter_case_does_not_make_two_folders() {
        let p = IgnorePolicy::default();
        assert!(p.excludes("Node_Modules", Kind::Folder));
        assert!(p.excludes("NODE_MODULES", Kind::Folder));

        let all = IgnorePolicy::declaring(Vec::new(), true);
        assert!(
            all.excludes(".FUB", Kind::Folder),
            "the index would have indexed itself"
        );
        assert!(
            all.excludes(".Trash", Kind::Folder),
            "the trash would have risen from the dead"
        );
    }

    /// Il verso opposto, **scelto e non subito**: piegare il caso esclude anche
    /// ciò che su Linux è una seconda cartella, e la regola si ferma lì.
    ///
    /// Fra i due errori si è preferito questo (il modulo dice perché); ciò che
    /// resta da presidiare è che non se ne mangi altro: una dichiarazione è un
    /// **nome intero**, non un prefisso, e non diventa un pattern.
    #[test]
    fn folding_case_does_not_widen_the_declaration() {
        let p = IgnorePolicy::declaring(["build".to_string()], false);
        assert!(
            p.excludes("Build", Kind::Folder),
            "it is the chosen direction, and it is declared"
        );
        assert!(!p.excludes("building", Kind::Folder));
        assert!(!p.excludes("build.md", Kind::File));
        assert!(!p.excludes("rebuild", Kind::Folder));
    }

    /// **La prima metà della 0176**: una cartella si dichiara come la si
    /// scrive.
    ///
    /// `build/` è la forma che scrive per prima chi arriva da un `.gitignore`,
    /// e confrontata per uguaglianza con `build` non combaciava con niente —
    /// cioè quella riga non escludeva un bel niente, e nessuno lo diceva.
    #[test]
    fn a_folder_declared_with_a_slash_is_the_same_folder() {
        for written in ["build", "build/", "/build", "/build/"] {
            let p = IgnorePolicy::declaring([written.to_string()], false);
            assert!(
                p.excludes("build", Kind::Folder),
                "\"{written}\" excluded nothing, silently"
            );
        }
        // E ciò che si riduce a niente non diventa una chiave vuota che
        // combacia con chissà cosa: non entra affatto.
        let p = IgnorePolicy::declaring(["/".to_string(), String::new()], false);
        assert_eq!(p, IgnorePolicy::declaring(Vec::<String>::new(), false));
    }

    /// **La seconda metà della 0176**: l'elenco si chiama «cartelle escluse», e
    /// un file che si chiama come una di loro è un file di questo vault.
    ///
    /// Non è un file che non si vede: è un file che non c'è — senza `DocId`,
    /// senza voce d'anagrafe, senza un evento che lo dica. La struttura, che
    /// non è un elenco ma il posto dove Fub scrive, resta esclusa per tutte e
    /// due le specie.
    #[test]
    fn a_file_is_not_the_folder_named_after_it() {
        let p = IgnorePolicy::declaring(["build".to_string()], false);
        assert!(p.excludes("build", Kind::Folder));
        assert!(
            !p.excludes("build", Kind::File),
            "a file named \"build\" vanished from the vault without saying so"
        );
        // La struttura non fa questa distinzione, e non deve farla.
        assert!(p.excludes(FUB_DIR, Kind::File));
        assert!(p.excludes(TRASH_DIR, Kind::File));
        // Nemmeno i nascosti: la domanda lì è sul nome, non sulla specie.
        assert!(p.excludes(".git", Kind::File));
    }

    /// Le due chiavi viaggiano col vault e nessun programma le scrive.
    #[test]
    fn the_policy_travels_with_the_vault_and_no_program_writes_it() {
        let specs = ignore_settings();
        assert_eq!(specs.len(), 2);
        for spec in specs {
            assert_eq!(spec.scope, fub_abi::settings::SettingScope::Vault);
            assert!(!spec.program_writable, "{} is writable", spec.key);
        }
    }

    /// Il default dello schema e il default del valutatore sono **lo stesso
    /// elenco**: due liste che dicono cosa esclude un vault appena aperto
    /// potrebbero divergere, e la seconda non la legge nessuno.
    #[test]
    fn the_schema_and_the_evaluator_declare_the_same_default() {
        let SettingKind::List { default } = &ignore_settings()[0].kind else {
            panic!("excluded folders are a list");
        };
        let from_the_schema = IgnorePolicy::declaring(default.clone(), false);
        assert_eq!(from_the_schema, IgnorePolicy::default());
    }
}
