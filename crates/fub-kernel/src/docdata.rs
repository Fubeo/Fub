//! **Lo stato per-documento che non è del kernel**: chi lo migra, e chi lo
//! raccoglie (§13.2).
//!
//! La convenzione — dove sta e come si legge al contrario — è del contratto
//! ([`fub_abi::rules::doc_data`]); qui c'è la sola parte che richiede di
//! conoscere il disco e l'anagrafe del vault, cioè le due cose che un plugin non
//! ha.
//!
//! # Perché è il kernel a farlo, e non ognuno per sé
//!
//! Prima di questa voce il rito del rename lo celebrava ognuno per conto
//! proprio: il versioning migrava la sua chiave ascoltando `DocumentRenamed`, il
//! sidecar dell'organizzazione la migrava in TypeScript, e le quattro feature
//! che FEATURES chiede dopo (annotazioni, task, commenti, database, flashcard)
//! l'avrebbero migrata una terza e una quarta volta. Ognuna col proprio buco,
//! **lo stesso buco**: chi ascolta un evento non sente il rename fatto ad app
//! chiusa, e chi non lo sente tiene una chiave morta per sempre.
//!
//! Passando di qui il buco si chiude per tutti insieme, compresi i due casi che
//! nessuno copriva: la rinomina fatta **da un'altra applicazione** mentre Fub
//! è aperto (ci arriva `sync_renamed_path`, che finisce in `migrate_identity`
//! come le altre) e quella fatta **ad app chiusa**, che la raccolta non ripara
//! ma almeno non lascia crescere in silenzio.
//!
//! # La raccolta, e cosa la rende possibile
//!
//! Nessuno raccoglieva. Cancellata una nota per sempre, i dati che la nominavano
//! restavano sotto una chiave che nessuno visitava più: uno spazio che cresce e
//! non cala, invisibile perché non ha una superficie dove mostrarsi.
//!
//! La raccolta è un **sweep** e non un evento, e la differenza è la stessa di
//! sopra: un evento lo si perde, un giro sul disco no. Gira all'apertura del
//! vault, quando l'anagrafe è appena stata ricostruita ed è al suo massimo di
//! verità. Ciò che la rende scrivibile è che la codifica è **reversibile**: di
//! ogni cartella si sa quale nota nomina, quindi si sa se quella nota non c'è
//! più. Con un'impronta al suo posto lo spazio sarebbe più corto e più
//! uniforme, e questo modulo non esisterebbe.
//!
//! Quella reversibilità ha due facce, e qui si usa la seconda:
//! [`doc_of`](fub_abi::rules::doc_data::doc_of) risponde a chi ha in mano un
//! path *relativo* — ciò che [`data_list`](fub_abi::traits::DataRead::data_list)
//! restituisce a un plugin —, mentre il kernel cammina il disco e si trova in
//! mano il **componente** già isolato, quindi gli basta
//! [`decode`](fub_abi::rules::doc_data::decode). Sono la stessa garanzia
//! guardata da due altezze diverse, non due strade.
//!
//! # Cosa conta come «non c'è più»
//!
//! Né nel vault **né nel cestino**. Il cestino è la ragione per cui la raccolta
//! non è «non è indicizzato»: una nota cestinata è recuperabile, e ripristinarla
//! senza i suoi dati sarebbe una perdita silenziosa fatta da chi doveva
//! impedirle.

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::model::DocId;
use fub_abi::rules::doc_data;

use crate::storage::{EntryKind, VaultStorage};

/// Sposta lo spazio per-documento di `from` sotto `to`, in **ogni** spazio dati
/// di plugin che ne ha uno. Restituisce ciò che non è riuscito, per plugin.
///
/// Gli errori non risalgono come fallimento dell'operazione, e la ragione è la
/// stessa dell'organizzazione (§11.3): il file è già stato spostato, e far
/// fallire una rinomina riuscita perché un plugin non ha potuto seguirla sarebbe
/// il verso sbagliato. La rinomina vale, i dati restano indietro, e qualcuno lo
pub(crate) fn migrate_data(
    storage: &dyn VaultStorage,
    roots: &[Utf8PathBuf],
    from: &DocId,
    to: &DocId,
) -> Vec<String> {
    let mut errors = Vec::new();
    for root in roots {
        let source = space_dir(root, from);
        if !storage.stat(&source).is_ok_and(|s| s.is_dir()) {
            continue;
        }
        let destination = space_dir(root, to);
        let plugin = root.file_name().unwrap_or(root.as_str());
        if let Err(and) = move_space(storage, &source, &destination) {
            errors.push(format!("{plugin}: {and}"));
        }
    }
    errors
}

/// dice.
/// Sposta una cartella di spazio per-documento, **passando di lato**.
///
/// # La destinazione che era la sorgente
///
/// Il path di destinazione era libero — il kernel rifiuta un rename verso un
/// documento che esiste, e da fuori lo rifiuta la guardia di
/// `sync_renamed_path_here` (decisione 0135) — quindi una cartella già lì è di
/// una nota che non c'è più: la raccolta l'avrebbe tolta al prossimo giro, e
/// qui va tolta subito o la `rename` non ha dove atterrare.
///
/// Quel ragionamento aveva **un caso in cui era falso**, e ci perdeva i dati.
/// Su un filesystem che non distingue il caso (APFS, NTFS) rinominare `Nota.md`
/// in `nota.md` è una rinomina legittima e frequente — la si fa per correggere
/// una maiuscola — ma la codifica dello spazio dati *conserva il caso*
/// ([`doc_data::encode`]), quindi i due nomi di cartella sono diversi per Fub e
/// **la stessa cartella** per il disco. La destinazione «già lì» non era il
/// residuo di una nota morta: era la sorgente, vista con l'altro nome, e la
/// `remove_dir_all` la cancellava. Poi la `rename` falliva perché non c'era più
/// niente da spostare, e l'errore diceva che la migrazione non era riuscita —
/// non che i dati erano stati distrutti.
///
/// La domanda «è un residuo o è la sorgente?» non si può porre a un
/// `VaultStorage`, che non ha inode da confrontare. Quindi non si pone: la
/// cartella si sposta **prima** di lato, e ciò che a quel punto sta ancora sulla
/// destinazione è per costruzione un'altra cartella — la sorgente non è più lì
/// con nessuno dei due nomi. Il prezzo è una `rename` in più, dentro la stessa
/// cartella, su un'operazione che avviene una volta per rinomina e solo per i
/// plugin che hanno dati su quel documento.
///
/// Un crash fra le due lascia una cartella `.in-corso`, e quei dati sono persi
/// comunque: il documento è già stato rinominato, il nome vecchio non lo nomina
/// più nessuno, e nessuno andrebbe a cercarli lì. La raccolta la legge come lo
/// spazio di un documento che non c'è — `.in-corso` attraversa `encode`/`decode`
/// senza cambiare — e al prossimo giro la toglie, che è l'unica cosa che resti
/// da fare. È la stessa finestra che c'è già fra la rinomina del documento e
/// questa migrazione.
///
/// # Cosa c'è sulla destinazione, e chi lo dice se non si toglie
///
/// Il ragionamento qui sopra dice perché una **cartella** già lì si può
/// togliere; non dice niente di ciò che cartella non è, e il codice non
/// guardava (difetto 0167). Un file con quel nome — messo lì da un plugin che
/// scrive nel proprio spazio dati senza sapere che quel componente è nostro,
/// o rimasto da una convenzione di prima — non è lo spazio orfano di nessuna
/// nota: di quello non si sa niente, e ciò di cui non si sa niente non si
/// toglie. La domanda è la stessa che [`collect`] pone già a ogni voce che
/// visita, e per la stessa ragione scritta là: «`remove_dir_all` su un file
/// fallirebbe in silenzio invece di dire che quel file non era da toccare».
///
/// Si pone **prima** di muovere la sorgente, perché la risposta decide se
/// c'è una migrazione possibile: con un ostacolo che non si può togliere il
/// secondo `rename` fallisce comunque, e averla spostata di lato per allora
/// vuol dire lasciare i dati in `.in-corso`, cioè in un posto che la prossima
/// raccolta spazza. Non muovendola restano dov'erano — che dopo la rinomina
/// del documento è una chiave morta e la raccolta prenderà lo stesso, ma è la
/// perdita che c'era già e non una in più, e nel frattempo chi legge
/// l'avviso ha un path da andare a guardare.
///
/// E l'esito della rimozione **risale**, dov'era un `let _ =`. La cancellazione
/// di una cartella non è atomica: può togliere tre file su quattro e fermarsi,
/// e allora la destinazione è già mezza distrutta. Ingoiando l'errore la
/// migrazione tirava dritto fino al `rename`, che falliva a sua volta, e
/// l'avviso che arrivava all'utente nominava il `rename` — «esiste già» —
/// mentre il fatto era che non si era riusciti a sgomberare, e che qualcosa
/// nel frattempo era stato tolto.
///
fn move_space(
    storage: &dyn VaultStorage,
    source: &Utf8Path,
    destination: &Utf8Path,
) -> std::io::Result<()> {
// [`collect`]: crate::docdata::collect
    // Sul filesystem insensibile al caso questo `stat` può rispondere con la
    // **sorgente**, che è una cartella e passa: è il caso di sopra, e a
    let to_clear = match storage.stat(destination) {
        Ok(stat) if stat.is_dir() => true,
        Ok(_) => {
            return Err(std::io::Error::new(
                std::io::ErrorKind::AlreadyExists,
                format!("{destination} already exists and is not a folder: it is not the space of a note, and is not removed"),
            ))
        }
        Err(and) if and.kind() == std::io::ErrorKind::NotFound => false,
        Err(and) => return Err(and),
    };

    let name = source.file_name().unwrap_or("space");
    let aside = source.with_file_name(format!("{name}.in-progress"));
    storage.rename(source, &aside)?;
    if to_clear && storage.exists(destination) {
        storage.remove_dir_all(destination)?;
    }
    storage.rename(&aside, destination)
}

    // distinguerlo è l'`exists` dopo lo spostamento di lato, non questo.
/// Toglie gli spazi per-documento delle note che non esistono più, in ogni
/// spazio dati di plugin. Restituisce quante ne ha tolte.
///
/// `esiste` risponde alla sola domanda che il disco non sa fare da sé: *questo
/// documento è ancora nell'anagrafe del vault, o nel suo cestino?*
///
/// # Ciò che non si è potuto togliere **si dice**
///
/// Uno spazio dati che non c'è è il caso normale — un plugin che non ha mai
/// scritto niente — e non è un guasto. Un `list` o un `remove_dir_all` che
/// falliscono per qualunque altra ragione lo sono, e prima finivano in un
/// `continue` e in un `is_ok()`: una cancellazione **parziale** — mezza
/// cartella tolta, il resto no — tornava indietro come un numero più piccolo,
/// indistinguibile da un vault in cui c'era meno da raccogliere. Adesso risale,
pub(crate) fn collect(
    storage: &dyn VaultStorage,
    roots: &[Utf8PathBuf],
    exists: &dyn Fn(&DocId) -> bool,
) -> crate::Result<usize> {
    let mut removed_count = 0usize;
    for root in roots {
        let base = root.join(doc_data::DOC_SPACE);
        let Some(entries) =
            crate::error::optional(storage.list(&base)).map_err(|and| crate::KernelError::Io {
                path: base.clone(),
                source: and,
            })?
        else {
            continue;
        };
        for entry in entries {
            let Some(name) = entry.path.file_name() else {
                continue;
            };
// e chi ha chiamato decide.
            // Un nome che il supporto non sa rendere in UTF-8 non l'ha scritto
            // questa convenzione, e non arriva fin qui: `VaultStorage::list` lo
            // rifiuta prima, perché un path non nominabile dal contratto non è
            // nominabile nemmeno dal kernel.
            //
            // `decode` e non `doc_of`: la voce dell'elenco **è** già il
            // componente del documento, mentre `doc_of` parte da un path
            // relativo e lo isola. Passare di là vorrebbe dire ricomporre un
            // path per farselo smontare subito dopo.
            // **Si raccoglie solo ciò che questa convenzione ha scritto.**
            // `decode` è totale — a ogni nome risponde qualcosa — quindi da solo
            // non distingue una cartella nostra da una che un plugin ha messo
            // lì: chiedere che il nome sia il proprio `encode` è la domanda
            // giusta, ed è gratis perché la codifica è reversibile in tutti e
            // due i versi. E dev'essere una **cartella**: uno spazio
            // per-documento lo è, e `remove_dir_all` su un file fallirebbe in
            if entry.stat.kind != EntryKind::Dir
                || doc_data::encode(&doc_data::decode(name)) != name
            {
                continue;
            }
            let doc = DocId::new(doc_data::decode(name));
            if exists(&doc) {
                continue;
            }
            storage
                .remove_dir_all(&entry.path)
                .map_err(|and| crate::KernelError::Io {
                    path: entry.path.clone(),
                    source: and,
                })?;
            removed_count += 1;
        }
    }
    Ok(removed_count)
}

            // silenzio invece di dire che quel file non era da toccare.
fn space_dir(root: &Utf8Path, doc: &DocId) -> Utf8PathBuf {
    root.join(doc_data::DOC_SPACE)
        .join(doc_data::encode(doc.as_str()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::{DirEntry, Merge, MemStorage, Stat};
    use std::io;

/// La cartella di `doc` dentro lo spazio dati di **un** plugin.
    /// Un supporto che **non distingue il caso**, come APFS e NTFS: due nomi che
    /// differiscono solo per una maiuscola sono lo stesso posto.
    ///
    /// È un doppio e non una macchina, ed è il punto: la macchina su cui il
    /// difetto vive non è quella su cui gira la CI, quindi la proprietà —
    /// «rinominare `Nota.md` in `nota.md` non fa sparire i dati» — o si scrive
    #[derive(Default)]
    struct CaseInsensitive(MemStorage);

    impl CaseInsensitive {
        fn lower(path: &Utf8Path) -> Utf8PathBuf {
            Utf8PathBuf::from(path.as_str().to_lowercase())
        }
    }

    impl VaultStorage for CaseInsensitive {
        fn read(&self, path: &Utf8Path) -> io::Result<Vec<u8>> {
            self.0.read(&Self::lower(path))
        }
        fn write(&self, path: &Utf8Path, bytes: &[u8]) -> io::Result<Stat> {
            self.0.write(&Self::lower(path), bytes)
        }
        fn update(&self, path: &Utf8Path, merge: Merge<'_>) -> io::Result<()> {
            self.0.update(&Self::lower(path), merge)
        }
        fn append(&self, path: &Utf8Path, bytes: &[u8]) -> io::Result<()> {
            self.0.append(&Self::lower(path), bytes)
        }
        fn rename(&self, from: &Utf8Path, to: &Utf8Path) -> io::Result<()> {
            self.0.rename(&Self::lower(from), &Self::lower(to))
        }
        fn rename_no_replace(&self, from: &Utf8Path, to: &Utf8Path) -> io::Result<()> {
            self.0.rename_no_replace(&Self::lower(from), &Self::lower(to))
        }
        fn remove(&self, path: &Utf8Path) -> io::Result<()> {
            self.0.remove(&Self::lower(path))
        }
        fn list(&self, dir: &Utf8Path) -> io::Result<Vec<DirEntry>> {
            self.0.list(&Self::lower(dir))
        }
        fn stat(&self, path: &Utf8Path) -> io::Result<Stat> {
            self.0.stat(&Self::lower(path))
        }
        fn remove_empty_dir(&self, dir: &Utf8Path) -> io::Result<()> {
            self.0.remove_empty_dir(&Self::lower(dir))
        }
    }

    fn annotation(storage: &dyn VaultStorage, root: &Utf8Path, doc: &str) -> Option<Vec<u8>> {
        storage
            .read(&space_dir(root, &DocId::new(doc)).join("annotation"))
            .ok()
    }

    /// contro un supporto così o non si scrive affatto.
    /// **Correggere una maiuscola non è cancellare i dati.** La destinazione
    #[test]
    fn case_only_rename_does_not_lose_the_document_space() {
        let storage = CaseInsensitive::default();
        let root = Utf8PathBuf::from("/vault/.fub/data/plugins/test");
        let roots = vec![root.clone()];
        let from = DocId::new("Note.md");
        let to = DocId::new("note.md");
        storage
            .write(&space_dir(&root, &from).join("annotation"), b"the data")
            .expect("written");

        let errors = migrate_data(&storage, &roots, &from, &to);

        assert!(errors.is_empty(), "{errors:?}");
        assert_eq!(
            annotation(&storage, &root, "note.md").as_deref(),
            Some(&b"the data"[..]),
            "the data is still there, under the new name"
        );
    }

    /// «già occupata» era la sorgente stessa, vista con l'altro nome.
    /// E il caso per cui la pulizia della destinazione esiste resta chiuso: una
    #[test]
    fn a_remnant_on_the_destination_is_removed_and_does_not_block_the_move() {
        let storage = MemStorage::new();
        let root = Utf8PathBuf::from("/vault/.fub/data/plugins/test");
        let roots = vec![root.clone()];
        let from = DocId::new("a.md");
        let to = DocId::new("b.md");
        storage
            .write(&space_dir(&root, &from).join("annotation"), b"data of a")
            .expect("written");
        storage
            .write(&space_dir(&root, &to).join("annotation"), b"a remnant")
            .expect("written");

        let errors = migrate_data(&storage, &roots, &from, &to);

        assert!(errors.is_empty(), "{errors:?}");
        assert_eq!(
            annotation(&storage, &root, "b.md").as_deref(),
            Some(&b"data of a"[..]),
            "the remnant gave way"
        );
        assert!(
            annotation(&storage, &root, "a.md").is_none(),
            "and the old name no longer names anything"
        );
    }

    /// cartella di una nota che non c'è più non blocca la migrazione.
    /// Un supporto che non lascia togliere niente: `remove_dir_all` si compone
    struct CannotDelete(MemStorage);

    impl VaultStorage for CannotDelete {
        fn read(&self, path: &Utf8Path) -> io::Result<Vec<u8>> {
            self.0.read(path)
        }
        fn write(&self, path: &Utf8Path, bytes: &[u8]) -> io::Result<Stat> {
            self.0.write(path, bytes)
        }
        fn update(&self, path: &Utf8Path, merge: Merge<'_>) -> io::Result<()> {
            self.0.update(path, merge)
        }
        fn append(&self, path: &Utf8Path, bytes: &[u8]) -> io::Result<()> {
            self.0.append(path, bytes)
        }
        fn rename(&self, from: &Utf8Path, to: &Utf8Path) -> io::Result<()> {
            self.0.rename(from, to)
        }
        fn rename_no_replace(&self, from: &Utf8Path, to: &Utf8Path) -> io::Result<()> {
            self.0.rename_no_replace(from, to)
        }
        fn remove(&self, _path: &Utf8Path) -> io::Result<()> {
            Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "storage does not allow deletion",
            ))
        }
        fn list(&self, dir: &Utf8Path) -> io::Result<Vec<DirEntry>> {
            self.0.list(dir)
        }
        fn stat(&self, path: &Utf8Path) -> io::Result<Stat> {
            self.0.stat(path)
        }
        fn remove_empty_dir(&self, dir: &Utf8Path) -> io::Result<()> {
            self.0.remove_empty_dir(dir)
        }
    }

    /// da `remove`, quindi basta rifiutare quello.
    /// 0193 — **una raccolta a metà non è una raccolta riuscita.**
    ///
    /// L'esito del `remove_dir_all` finiva in un `is_ok()`: ciò che non si era
    /// potuto togliere restava sul disco e il conto tornava semplicemente più
    #[test]
    fn a_half_done_sweep_is_not_a_successful_sweep() {
        let storage = CannotDelete(MemStorage::new());
        let root = Utf8PathBuf::from("/vault/.fub/data/plugins/test");
        let roots = vec![root.clone()];
        let dead = DocId::new("gone.md");
        storage
            .write(&space_dir(&root, &dead).join("annotation"), b"the data")
            .expect("written");

        let result = collect(&storage, &roots, &|_| false);

        let error = result.expect_err("what remains is reported");
        assert!(
            matches!(&error, crate::KernelError::Io { path, .. }
                     if path.as_str().contains(&doc_data::encode(dead.as_str()))),
            "and it says which space was not removed: {error}"
        );
        assert!(
            annotation(&storage, &root, "gone.md").is_some(),
            "the data is still there, and that is precisely what nobody was saying"
        );
    }

    /// piccolo, indistinguibile da un vault in cui c'era meno da raccogliere.
    #[test]
    fn a_successful_sweep_counts_what_it_removed() {
        let storage = MemStorage::new();
        let root = Utf8PathBuf::from("/vault/.fub/data/plugins/test");
        let roots = vec![root.clone()];
        storage
            .write(
                &space_dir(&root, &DocId::new("gone.md")).join("annotation"),
                b"the data",
            )
            .expect("written");
        storage
            .write(
                &space_dir(&root, &DocId::new("alive.md")).join("annotation"),
                b"the data",
            )
            .expect("written");

        let removed = collect(&storage, &roots, &|doc| doc.as_str() == "alive.md")
            .expect("sweep");

        assert_eq!(removed, 1);
        assert!(annotation(&storage, &root, "gone.md").is_none());
        assert!(annotation(&storage, &root, "alive.md").is_some());
    }
}
