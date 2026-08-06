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
//!   Nessuna impostazione le rivela, ed è [`e_struttura`].
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
//! disco, e ci passa anche [`e_struttura`]: `.Fub` su un filesystem
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
pub const DEFAULT_EXCLUDED: &[&str] = &[".obsidian", ".git", "node_modules"];

/// Questa **chiave** è struttura, cioè non è roba dell'utente?
///
/// È la metà della politica che nessuna impostazione può spostare, e le tre
/// righe che contiene sono tre danni diversi: la cartella di Fub è dove sta
/// l'indice (indicizzarlo lo raddoppierebbe a ogni giro), il cestino contiene
/// note che qualcuno ha buttato (mostrarle è riesumarle), e il temporaneo di
/// una scrittura è un file che fra un istante non esiste — chi lo vedesse gli
/// darebbe un [`DocId`](fub_abi::DocId) e lo perderebbe subito dopo.
///
/// Riceve una chiave di [`resolution_key`] e non un nome di directory grezzo:
/// le tre costanti che confronta sono già in quella forma, e su un filesystem
/// insensibile al caso `.Fub` è la cartella di Fub.
pub(crate) fn e_struttura(key: &str) -> bool {
    key == FUB_DIR || key == TRASH_DIR || crate::storage::e_temporaneo_di_scrittura(key)
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
    mostra_i_nascosti: bool,
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
    pub fn declaring(folders: impl IntoIterator<Item = String>, mostra_i_nascosti: bool) -> Self {
        IgnorePolicy {
            folders: folders.into_iter().map(|f| resolution_key(&f)).collect(),
            mostra_i_nascosti,
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
    pub fn esclude(&self, name: &str) -> bool {
        let name = resolution_key(name);
        if e_struttura(&name) {
            return true;
        }
        if !self.mostra_i_nascosti && name.starts_with('.') {
            return true;
        }
        self.folders.contains(&name)
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
    let mostra_i_nascosti = matches!(
        store.effective(SHOW_HIDDEN),
        Ok((SettingValue::Toggle(true), _))
    );
    IgnorePolicy::declaring(folders, mostra_i_nascosti)
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
            Text::key(I_EXCLUDED),
            SettingKind::List {
                default: DEFAULT_EXCLUDED.iter().map(|s| s.to_string()).collect(),
            },
        )
        .describing(Text::key(I_EXCLUDED_DESC))
        .grouped(Text::key(I_GROUP)),
        SettingSpec::new(
            SHOW_HIDDEN,
            Text::key(I_HIDDEN),
            SettingKind::Toggle { default: false },
        )
        .describing(Text::key(I_HIDDEN_DESC))
        .grouped(Text::key(I_GROUP)),
    ]
}

const I_GROUP: &str = "files.group";
const I_EXCLUDED: &str = "files.excluded_folders";
const I_EXCLUDED_DESC: &str = "files.excluded_folders.desc";
const I_HIDDEN: &str = "files.show_hidden";
const I_HIDDEN_DESC: &str = "files.show_hidden.desc";

/// Le frasi di queste impostazioni, nel catalogo di chi le ha scritte (0040).
///
/// Ognuna delle due descrizioni dice **cosa resta escluso comunque**: è
/// l'informazione che manca a chi accende l'interruttore e si aspetta di
/// vedere tutto, ed è anche l'unica forma in cui la distinzione fra struttura e
/// preferenza arriva a chi non legge il sorgente.
pub fn catalog() -> Vec<StringCatalog> {
    vec![
        StringCatalog::new("it")
            .with(I_GROUP, "File")
            .with(I_EXCLUDED, "Cartelle escluse")
            .with(
                I_EXCLUDED_DESC,
                "Le cartelle che non fanno parte di questo vault: non sono \
                 documenti, non si cercano, non compaiono nell'elenco dei file. \
                 Vale a qualunque profondità, per nome, senza distinzione fra \
                 maiuscole e minuscole: `node_modules` esclude anche \
                 `Node_Modules`, perché su alcuni sistemi sono la stessa \
                 cartella e il vault è lo stesso su tutti. La cartella di Fub \
                 (`.fub`), il cestino (`.trash`) e i temporanei di una \
                 scrittura restano esclusi comunque: non sono una preferenza. \
                 Un cambiamento vale dal prossimo «Ricostruisci gli indici».",
            )
            .with(I_HIDDEN, "Mostra i file nascosti")
            .with(
                I_HIDDEN_DESC,
                "Considera documenti anche i file e le cartelle il cui nome \
                 comincia per punto. Restano esclusi comunque la cartella di \
                 Fub, il cestino, i temporanei di una scrittura e tutto ciò che \
                 è elencato fra le cartelle escluse. Un cambiamento vale dal \
                 prossimo «Ricostruisci gli indici».",
            ),
        StringCatalog::new("en")
            .with(I_GROUP, "Files")
            .with(I_EXCLUDED, "Excluded folders")
            .with(
                I_EXCLUDED_DESC,
                "The folders that are not part of this vault: not documents, \
                 not searched, not listed. Matched by name, at any depth, \
                 ignoring case: `node_modules` also excludes `Node_Modules`, \
                 because on some systems they are the same folder and the vault \
                 is the same everywhere. Fub's \
                 own folder (`.fub`), the trash (`.trash`) and the temporary \
                 files of a write stay excluded regardless: they are not a \
                 preference. A change applies from the next «Rebuild indexes».",
            )
            .with(I_HIDDEN, "Show hidden files")
            .with(
                I_HIDDEN_DESC,
                "Treat files and folders whose name starts with a dot as \
                 documents too. Fub's own folder, the trash, the temporary \
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
    fn chi_non_dichiara_niente_esclude_come_ieri() {
        let p = IgnorePolicy::default();
        for name in [".obsidian", ".git", ".fub", ".trash", "node_modules"] {
            assert!(p.esclude(name), "{name}");
        }
        assert!(p.esclude(".bozza.md"), "un nascosto è escluso");
        assert!(!p.esclude("Idea.md"));
        assert!(!p.esclude("progetti"));
    }

    /// **Il cuore della voce**: le due specie non sono la stessa lista. Un vault
    /// che mostra tutto ciò che è preferenza continua a non vedere ciò che è
    /// struttura — se no, l'indice si indicizzerebbe e il cestino tornerebbe a
    /// essere un elenco di note.
    #[test]
    fn nessuna_dichiarazione_rivela_la_struttura() {
        let tutto = IgnorePolicy::declaring(Vec::new(), true);
        assert!(tutto.esclude(FUB_DIR));
        assert!(tutto.esclude(TRASH_DIR));
        // La preferenza, invece, si sposta davvero.
        assert!(!tutto.esclude(".bozza.md"));
        assert!(!tutto.esclude("node_modules"));
    }

    /// Dichiarare l'elenco lo **sostituisce**, non lo allunga: chi lo scrive sta
    /// dicendo cosa non è suo, e una lista che si sommasse a una costante
    /// invisibile sarebbe di nuovo una politica per metà nel sorgente.
    #[test]
    fn dichiarare_le_cartelle_sostituisce_il_default() {
        let p = IgnorePolicy::declaring(["build".to_string()], false);
        assert!(p.esclude("build"));
        assert!(!p.esclude("node_modules"));
        // I nascosti sono l'altra metà e non si muovono con questa.
        assert!(p.esclude(".git"));
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
    fn una_cartella_dichiarata_in_nfc_e_la_stessa_scritta_in_nfd() {
        let nfc = "Caf\u{e9}"; // «Café» come lo scrive una tastiera
        let nfd = "Cafe\u{301}"; // «Café» come lo scrive macOS sul disco
        assert_ne!(nfc, nfd, "le due scritture sono byte diversi");

        let p = IgnorePolicy::declaring([nfc.to_string()], false);
        assert!(p.esclude(nfd), "la cartella di macOS non veniva esclusa");
        // E nell'altro verso, perché la dichiarazione può nascere su macOS.
        let p = IgnorePolicy::declaring([nfd.to_string()], false);
        assert!(p.esclude(nfc));
    }

    /// La seconda riproduzione: su un filesystem insensibile al caso
    /// `Node_Modules` è `node_modules`, e la dichiarazione non lo sapeva.
    ///
    /// Vale anche per la **struttura**, che non è dichiarata da nessuno: `.FUB`
    /// e `.fub` sono la stessa cartella dove c'è l'indice.
    #[test]
    fn il_caso_di_una_lettera_non_fa_due_cartelle() {
        let p = IgnorePolicy::default();
        assert!(p.esclude("Node_Modules"));
        assert!(p.esclude("NODE_MODULES"));

        let tutto = IgnorePolicy::declaring(Vec::new(), true);
        assert!(tutto.esclude(".FUB"), "l'indice si sarebbe indicizzato");
        assert!(tutto.esclude(".Trash"), "il cestino sarebbe risorto");
    }

    /// Il verso opposto, **scelto e non subito**: piegare il caso esclude anche
    /// ciò che su Linux è una seconda cartella, e la regola si ferma lì.
    ///
    /// Fra i due errori si è preferito questo (il modulo dice perché); ciò che
    /// resta da presidiare è che non se ne mangi altro: una dichiarazione è un
    /// **nome intero**, non un prefisso, e non diventa un pattern.
    #[test]
    fn piegare_il_caso_non_allarga_la_dichiarazione() {
        let p = IgnorePolicy::declaring(["build".to_string()], false);
        assert!(p.esclude("Build"), "è la scelta, ed è dichiarata");
        assert!(!p.esclude("building"));
        assert!(!p.esclude("build.md"));
        assert!(!p.esclude("rebuild"));
    }

    /// Le due chiavi viaggiano col vault e nessun programma le scrive.
    #[test]
    fn la_politica_viaggia_col_vault_e_nessun_programma_la_scrive() {
        let specs = ignore_settings();
        assert_eq!(specs.len(), 2);
        for spec in specs {
            assert_eq!(spec.scope, fub_abi::settings::SettingScope::Vault);
            assert!(!spec.program_writable, "{} è scrivibile", spec.key);
        }
    }

    /// Il default dello schema e il default del valutatore sono **lo stesso
    /// elenco**: due liste che dicono cosa esclude un vault appena aperto
    /// potrebbero divergere, e la seconda non la legge nessuno.
    #[test]
    fn lo_schema_e_il_valutatore_dichiarano_lo_stesso_default() {
        let SettingKind::List { default } = &ignore_settings()[0].kind else {
            panic!("le cartelle escluse sono una lista");
        };
        let dallo_schema = IgnorePolicy::declaring(default.clone(), false);
        assert_eq!(dallo_schema, IgnorePolicy::default());
    }
}
