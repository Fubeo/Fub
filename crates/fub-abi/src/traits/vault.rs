//! Le voci del vault: ciò che sta nel cestino e l'anagrafe di documenti e
//! cartelle (`TrashEntry`, `VaultEntry`, `VaultFolder`, `FolderScope`).

use super::*;

// ---------------------------------------------------------------------------
// Cestino: la forma di ciò che è stato cancellato ma non distrutto.
// ---------------------------------------------------------------------------

/// Una voce del cestino del vault.
///
/// Sale nel contratto con la decisione 0013 perché [`VaultRead::list_trash`] la restituisce:
/// prima viveva nel kernel, dove il solo lettore era la shell attraverso un
/// comando Tauri. Porta **due** id perché sono due domande diverse — dove il
/// file si trova ora (`id`, ed è quello che si passa a
/// [`restore_document`](VaultStructure::restore_document)) e dove tornerebbe
/// (`original`) — e un cestino che sapesse solo la prima non saprebbe
/// ripristinare.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TrashEntry {
    /// Dove il file si trova ora: `.trash/Nota.2026-07-24T15-30-00.md`.
    pub id: DocId,
    /// Dove tornerebbe un ripristino: il path d'origine se il vault lo
    /// ricorda, altrimenti il nome de-timbrato nella radice.
    pub original: DocId,
    /// Istante della cancellazione (secondi UNIX).
    pub deleted_at: u64,
    pub size: u64,
}

// ---------------------------------------------------------------------------
// L'anagrafe: cosa c'è nel vault, e non solo quali note (§14.1, §14.2).
// ---------------------------------------------------------------------------

/// Che specie di file è una voce del vault.
///
/// Tre casi e non due, e il terzo è il punto: prima di questa voce il vault
/// vedeva i documenti e **basta** — un PNG accanto a una nota non esisteva per
/// Fub, né come allegato né come file. Le tre risposte sono tre cose che si
/// fanno diversamente: un documento si parsa, un allegato si mostra o si apre
/// con l'applicazione di sistema, un ignoto si nomina e non si tocca.
///
/// **Non è una proprietà del file**: è una proprietà del file *dato chi è
/// registrato adesso*. La regola sta in
/// [`rules::media::kind_of`](crate::rules::media::kind_of), prende le estensioni
/// dei provider come parametro, e il giorno che qualcuno rivendica `.canvas`
/// quei file diventano `Document` senza essere cambiati di un byte.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EntryKind {
    /// Un `FormatProvider` rivendica la sua estensione: ha un modello, sta
    /// nell'indice, è ciò che
    /// [`list_documents`](VaultRead::list_documents) restituisce.
    Document,
    /// Un allegato: un tipo di contenuto che sappiamo nominare
    /// ([`rules::media::mime_of`](crate::rules::media::mime_of)) e che nessuno
    /// parsa.
    Asset,
    /// Il vault lo vede e nessuno sa cosa sia. Non è un errore ed è metà del
    /// valore dell'anagrafe: un file che nessuno riconosce **esiste** lo stesso
    /// — occupa spazio, si può cancellare per sbaglio, e un backup che lo
    /// saltasse lo perderebbe in silenzio.
    Unknown,
}

/// Una voce del vault: un file, con ciò che si sa di lui **senza aprirlo**.
///
/// È l'anagrafe che mancava (§14.1, §14.2), e le due mancanze erano una sola:
/// il kernel non vedeva ciò che non è un documento, e dei documenti non teneva
/// né la data né la dimensione — quindi «apri in fretta un vault grande»,
/// «trova i duplicati», «note modificate di recente» e «cosa è cambiato da
/// ieri» non avevano una **fonte**, non una implementazione.
///
/// La chiave è il path, come per ogni altra cosa del vault
/// ([decisione 0043](../../../docs/decisions/0188-identita-path-e-rename.md)):
/// [`DocId`] nomina *un file del vault*, e non un secondo tipo identico che
/// significhi la stessa cosa per gli allegati.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct VaultEntry {
    /// Il path relativo alla radice del vault, separatori `/`.
    pub id: DocId,
    pub kind: EntryKind,
    /// Byte del file sul disco.
    pub size: u64,
    /// Ultima modifica, in **millisecondi** UNIX.
    ///
    /// Millisecondi e non secondi come [`TrashEntry::deleted_at`], perché qui
    /// il numero non serve a *mostrare* una data ma a **riconoscere una
    /// modifica**: con la granularità del secondo, due scritture della stessa
    /// dimensione nello stesso secondo sono indistinguibili — che è raro per un
    /// umano e normale per uno script. E non nanosecondi, che pure il
    /// filesystem sa dare: questo numero attraversa l'IPC come JSON, e oltre
    /// 2^53 un intero non sopravvive a un `double`.
    pub mtime: u64,
    /// L'identità del **contenuto**, quando qualcuno l'ha già avuto in mano.
    ///
    /// `None` non vuol dire «file vuoto» e non vuol dire «mai letto»: vuol dire
    /// che nessuno ha ancora pagato la lettura dei suoi byte. È la stessa
    /// impronta di [`VaultRead::document_revision`] — l'identità di un
    /// contenuto è una cosa sola, e un secondo tipo opaco accanto a
    /// [`Revision`] sarebbe due nomi per la stessa idea.
    ///
    /// **Quando si calcola**: dove i byte sono già in mano, mai aprendo un file
    /// apposta. Il kernel la calcola sui documenti che deve comunque leggere per
    /// parsarli; per un allegato non la calcola nessuno, perché leggere ogni
    /// byte di ogni PNG all'apertura è esattamente il costo che l'anagrafe
    /// esiste per togliere. Chi la vorrà — dedup (13.1), duplicati (3.2),
    /// integrità (24.2) — la farà calcolare da un job, che è il posto del
    /// lavoro lungo ([decisione 0032](../../../docs/decisions/0183-composizione-host-kernel.md)).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fingerprint: Option<Revision>,
}

/// Una **cartella** del vault (§14.3).
///
/// Esiste perché il disco ce l'ha, non perché il path di un file la nomini: è
/// tutta la differenza fra una cartella e un prefisso. Prima di questa voce le
/// cartelle nascevano dai path delle note e vivevano nel solo albero della
/// shell, quindi una cartella vuota non c'era — e una cartella che restava
/// vuota (cestinata l'ultima nota) spariva da sola, mentre sul disco c'era
/// ancora.
///
/// La chiave è il path senza slash finale, come per
/// [`QueryPredicate::Folder`](crate::query::QueryPredicate::Folder) e come per
/// le chiavi dell'[organizzazione](crate::organization::Organization). **Non**
/// è un [`DocId`], che nomina un *file* («estensione inclusa»): una cartella
/// non si legge, non si scrive e non ha un modello, e chiamarla con lo stesso
/// tipo avrebbe voluto dire che ogni firma che prende un `DocId` accetta anche
/// una cartella senza saperlo. La radice del vault non è una voce: non ha un
/// nome, non si rinomina e non si cancella.
///
/// Nome e cartella genitore **non sono campi**, per la ragione per cui il MIME
/// di un allegato non lo è ([decisione 0046](../../../docs/decisions/0188-identita-path-e-rename.md)):
/// sono funzioni pure del path — l'ultimo segmento, e
/// [`folder_of`](crate::query::folder_of) — e copiarle qui vorrebbe dire
/// scriverne una copia per cartella di ogni vault.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct VaultFolder {
    /// Path relativo alla radice, separatori `/`, senza slash finale. Mai
    /// vuoto: `""` è la radice, e la radice non è una voce.
    pub path: String,
    /// Quante **sottocartelle dirette** ha.
    ///
    /// Sta qui perché è ciò che serve a decidere se disegnare la freccetta che
    /// apre, cioè prima di chiedere cosa c'è dentro: senza, un albero pigro
    /// dovrebbe interrogare ogni cartella per sapere quali sono espandibili —
    /// che è esattamente il giro per cartella che questa voce esiste per non
    /// fare.
    pub folders: u32,
    /// Quanti **file diretti** ha, di ogni specie.
    ///
    /// Di ogni specie e non solo documenti: la domanda a cui risponde è «questa
    /// cartella è vuota?», e una cartella con dentro solo un PNG non lo è.
    pub entries: u32,
}

/// **Dove** guardare, per le domande che si fanno per cartella (§14.3, §14.4).
///
/// Due campi e non due varianti perché sono la stessa domanda con un raggio
/// diverso, ed è la stessa coppia di
/// [`QueryPredicate::Folder`](crate::query::QueryPredicate::Folder) — che è
/// deliberato: la regola che decide se qualcosa ci sta dentro
/// ([`in_folder`](crate::query::in_folder)) è una, e due copie divergerebbero
/// sul caso che nessuno prova (la radice, che con `descendants` è tutto il
/// vault).
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct FolderScope {
    /// La cartella. `""` è la radice del vault, e gli slash ai due capi sono
    /// cortesia: `Progetti`, `Progetti/` e `/Progetti/` sono la stessa cartella
    /// ([`folders`](crate::rules::folders)).
    pub path: String,
    /// Anche ciò che sta nelle sue discendenti. `false` = i soli figli
    /// **diretti**, che è la domanda che disegna un livello di albero.
    #[serde(default)]
    pub descendants: bool,
}

impl FolderScope {
    /// I figli diretti di questa cartella.
    pub fn direct(path: impl Into<String>) -> Self {
        FolderScope {
            path: path.into(),
            descendants: false,
        }
    }
}
