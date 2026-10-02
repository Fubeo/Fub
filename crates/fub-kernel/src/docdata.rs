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
/// di plugin che ne ha uno. Restituisce ciò che va detto, per plugin.
///
/// È la forma di [`migrate`] per chi la rinomina l'ha già vista accadere: il
/// file è già stato spostato, e far fallire una rinomina riuscita perché un
/// plugin non ha potuto seguirla sarebbe il verso sbagliato (§11.3). La
/// rinomina vale, ciò che non ha seguito resta indietro, e qualcuno lo dice.
/// Nella stessa lista finisce anche ciò che si è spostato di lato per fare
/// posto ([`move_space`]): nessun dato è perso, ma qualcuno lo deve sapere.
pub(crate) fn migrate_data(
    storage: &dyn VaultStorage,
    roots: &[Utf8PathBuf],
    from: &DocId,
    to: &DocId,
) -> Vec<String> {
    migrate(storage, roots, from, to).messages
}

/// Uno spazio che una migrazione ha portato a destinazione: ciò che serve per
/// riportarlo indietro.
#[derive(Debug)]
struct Moved {
    source: Utf8PathBuf,
    destination: Utf8PathBuf,
    /// Dove è finito ciò che occupava la destinazione, se c'era.
    displaced: Option<Utf8PathBuf>,
}

/// L'esito di [`migrate`].
#[derive(Debug, Default)]
pub(crate) struct Migration {
    /// I guasti e gli spostamenti di lato, già in parole, per plugin.
    pub(crate) messages: Vec<String>,
    /// Il primo spazio che non ha raggiunto la destinazione, con il guasto.
    ///
    /// Chi non ha ancora mosso il file lo usa per **rifiutare** la rinomina: uno
    /// spazio lasciato sotto l'id vecchio di una nota che ha cambiato nome è,
    /// per la raccolta successiva, lo spazio di una nota che non esiste più.
    pub(crate) stranded: Option<(Utf8PathBuf, std::io::Error)>,
    moved: Vec<Moved>,
}

impl Migration {
    /// Riporta indietro **soltanto** ciò che questa migrazione ha spostato, e
    /// rimette sulla destinazione ciò che l'occupava. Torna ciò che non è
    /// riuscito.
    ///
    /// Non è una migrazione al contrario, ed è il punto: una migrazione da `to`
    /// a `from` sposterebbe anche ciò che sulla destinazione stava già prima e
    /// non si è mosso — un occupante che la migrazione non ha raggiunto
    /// finirebbe sotto `from`, e i dati veri di `from` di lato.
    pub(crate) fn undo(self, storage: &dyn VaultStorage) -> Vec<String> {
        let mut errors = Vec::new();
        for moved in self.moved.into_iter().rev() {
            match move_space(storage, &moved.destination, &moved.source) {
                Ok(None) => {}
                Ok(Some(displaced)) => errors.push(format!(
                    "{} already held another document space; it was moved to {displaced}",
                    moved.source
                )),
                Err(and) => {
                    errors.push(format!("{}: {and}", moved.destination));
                    continue;
                }
            }
            if let Some(displaced) = moved.displaced {
                if let Err(and) = storage.rename_no_replace(&displaced, &moved.destination) {
                    errors.push(format!(
                        "{displaced} could not go back to {}: {and}",
                        moved.destination
                    ));
                }
            }
        }
        errors
    }
}

/// Sposta lo spazio per-documento di `from` sotto `to`, in **ogni** spazio dati
/// di plugin che ne ha uno, e dice com'è andata ([`Migration`]).
///
/// Ciò che occupa una destinazione non ferma niente: si sposta di lato e si
/// nomina ([`move_space`]). Resta da fermarsi soltanto davanti a un guasto del
/// supporto, e lì lo spazio resta dov'era o sotto il nome intermedio.
pub(crate) fn migrate(
    storage: &dyn VaultStorage,
    roots: &[Utf8PathBuf],
    from: &DocId,
    to: &DocId,
) -> Migration {
    let mut migration = Migration::default();
    for root in roots {
        let source = space_dir(root, from);
        let destination = space_dir(root, to);
        let aside = move_aside(&source);
        let plugin = root.file_name().unwrap_or(root.as_str());
        // Un file sotto il nome di uno spazio non è uno spazio: non lo scrive
        // questa convenzione, la raccolta non lo tocca, e qui non si sposta.
        let source_ready = match storage.stat(&source) {
            Ok(stat) if stat.is_dir() => true,
            Ok(_) => {
                migration
                    .messages
                    .push(format!("{plugin}: {source} is not a folder"));
                continue;
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
            Err(error) => {
                migration.strand(plugin, &source, error);
                continue;
            }
        };
        let landed = if source_ready {
            // Il nome intermedio di una mossa interrotta che nessuna ripresa
            // ha completato: la ripresa lo completa soltanto quando la
            // sorgente manca, e qui la sorgente c'è. Lasciarlo lì fermerebbe
            // ogni rinomina futura di questa nota; si sposta di lato e si
            // dice, come ogni occupante.
            match crate::error::optional(storage.stat(&aside)) {
                Ok(None) => {}
                Ok(Some(_)) => match displace(storage, &aside) {
                    Ok(stale) => migration.messages.push(format!(
                        "{plugin}: {aside} held an interrupted move; it was moved to {stale}"
                    )),
                    Err(error) => {
                        migration.strand(plugin, &source, error);
                        continue;
                    }
                },
                Err(error) => {
                    migration.strand(plugin, &source, error);
                    continue;
                }
            }
            move_space(storage, &source, &destination)
        } else {
            match storage.stat(&aside) {
                Ok(stat) if stat.is_dir() => land(storage, &aside, &destination),
                Ok(_) => {
                    migration
                        .messages
                        .push(format!("{plugin}: {aside} is not a folder"));
                    continue;
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(error) => Err(error),
            }
        };
        match landed {
            Ok(displaced) => {
                if let Some(displaced) = &displaced {
                    migration.messages.push(format!(
                        "{plugin}: {destination} already held another document space; \
                         it was moved to {displaced} to make room for the data of {from}"
                    ));
                }
                migration.moved.push(Moved {
                    source,
                    destination,
                    displaced,
                });
            }
            Err(and) => migration.strand(plugin, &source, and),
        }
    }
    migration
}

impl Migration {
    fn strand(&mut self, plugin: &str, source: &Utf8Path, error: std::io::Error) {
        self.messages.push(format!("{plugin}: {error}"));
        if self.stranded.is_none() {
            self.stranded = Some((source.to_owned(), error));
        }
    }
}

/// Il suffisso dello spazio messo di lato durante una migrazione.
const ASIDE_SUFFIX: &str = ".in-progress";

/// Il path sotto cui la sorgente sta di lato durante una migrazione.
fn move_aside(source: &Utf8Path) -> Utf8PathBuf {
    let name = source.file_name().unwrap_or("space");
    source.with_file_name(format!("{name}{ASIDE_SUFFIX}"))
}

/// Il suffisso di ciò che occupava la destinazione di una migrazione e ne è
/// stato spostato di lato.
///
/// La `~` non sta nell'alfabeto di [`doc_data::encode`], che la codifica:
/// un nome che la porta nuda non è il nome di nessun documento. Così la
/// raccolta non lo tocca ([`collect`] raccoglie soltanto i nomi che questa
/// convenzione ha scritto) e nessuna nota lo eredita per omonimia.
const DISPLACED_SUFFIX: &str = "~displaced";

/// Sposta `destination` sotto il primo nome libero della famiglia
/// `{nome}~displaced`, `{nome}~displaced-2`, …, e torna il path scelto.
///
/// Ogni candidato si prova con `rename_no_replace`: la verifica e la mossa
/// sono una sola operazione, e un nome occupato nel frattempo non si
/// sovrascrive.
fn displace(storage: &dyn VaultStorage, destination: &Utf8Path) -> std::io::Result<Utf8PathBuf> {
    let name = destination.file_name().unwrap_or("space");
    for n in 1u64.. {
        let candidate = match n {
            1 => format!("{name}{DISPLACED_SUFFIX}"),
            n => format!("{name}{DISPLACED_SUFFIX}-{n}"),
        };
        let path = destination.with_file_name(candidate);
        match storage.rename_no_replace(destination, &path) {
            Ok(()) => return Ok(path),
            Err(and) if and.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(and) => return Err(and),
        }
    }
    unreachable!("i nomi di lato non finiscono: a ogni giro il candidato è diverso")
}

/// Porta lo spazio che sta di lato (`aside`) sulla destinazione, spostando
/// prima di lato ciò che la occupa. Torna dove è finito quell'occupante.
///
/// La sorgente a questo punto sta sotto `aside` e non più sotto nessuno dei
/// suoi nomi, quindi ciò che si trova sulla destinazione è per costruzione
/// un'altra cosa, anche su un filesystem che non distingue il caso.
fn land(
    storage: &dyn VaultStorage,
    aside: &Utf8Path,
    destination: &Utf8Path,
) -> std::io::Result<Option<Utf8PathBuf>> {
    let displaced = match crate::error::optional(storage.stat(destination))? {
        Some(_) => Some(displace(storage, destination)?),
        None => None,
    };
    if let Err(and) = storage.rename_no_replace(aside, destination) {
        // L'occupante torna dov'era: una migrazione che non è avvenuta non
        // lascia la destinazione vuota e il suo contenuto sotto un altro nome.
        let Some(displaced) = displaced else {
            return Err(and);
        };
        return Err(match storage.rename_no_replace(&displaced, destination) {
            Ok(()) => and,
            Err(back) => std::io::Error::new(
                and.kind(),
                format!("{and}; {displaced} could not go back to {destination}: {back}"),
            ),
        });
    }
    Ok(displaced)
}

/// Sposta una cartella di spazio per-documento, **passando di lato**.
///
/// # La destinazione che era la sorgente
///
/// Il path di destinazione era libero — il kernel rifiuta un rename verso un
/// documento che esiste, e da fuori lo rifiuta la guardia di
/// `sync_renamed_path_here` (decisione 0135) — quindi una cartella già lì,
/// si pensava, era di una nota che non c'è più, e la migrazione la toglieva
/// perché la `rename` avesse dove atterrare.
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
/// Un crash fra le due mosse lascia la sorgente sotto il nome deterministico
/// `.in-progress`. La rinomina recuperabile ripete la migrazione prima di
/// muovere il documento: se il nome originale manca e quello intermedio esiste,
/// completa la mossa con lo stesso atterraggio ([`land`]): una destinazione
/// comparsa nel frattempo si sposta di lato come qualunque occupante.
///
/// # La collisione: i dati seguono la nota, ciò che c'era si sposta di lato
///
/// La destinazione è libera come **documento**: lo garantiscono il rename del
/// kernel, la guardia di `sync_renamed_path_here` e il ripristino dal cestino.
/// Una cartella che sta comunque lì è il residuo di una nota che non c'è più, o
/// qualcosa che un plugin ha scritto per un documento che non esiste. Prima la
/// migrazione si rifiutava e lasciava la sorgente sotto l'id vecchio: la nota
/// rinominata ereditava il residuo, e i suoi dati veri, ormai sotto un
/// documento inesistente, li toglieva la raccolta successiva.
///
/// Due spazi per-documento sono dati arbitrari del plugin, quindi non si
/// fondono e non si cancellano. I dati della nota la seguono sulla
/// destinazione; l'occupante si sposta sotto `{nome}~displaced`
/// ([`displace`]), con i byte intatti, fuori dalla portata della raccolta, e
/// la migrazione lo nomina fra i suoi avvisi. Un file al posto della
/// cartella riceve lo stesso trattamento.
///
/// L'occupante si sposta **dopo** la sorgente: è ciò che lo distingue dalla
/// sorgente stessa vista con l'altro caso ([`land`]).
fn move_space(
    storage: &dyn VaultStorage,
    source: &Utf8Path,
    destination: &Utf8Path,
) -> std::io::Result<Option<Utf8PathBuf>> {
    let aside = move_aside(source);
    if crate::error::optional(storage.stat(&aside))?.is_some() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::AlreadyExists,
            format!("{aside} contains an interrupted document-space move"),
        ));
    }
    storage.rename(source, &aside)?;
    land(storage, &aside, destination).map_err(|and| {
        // La sorgente torna sotto il suo nome. Se non ci torna resta sotto
        // l'intermedio, che la raccolta non tocca e la ripresa completa.
        match storage.rename_no_replace(&aside, source) {
            Ok(()) => and,
            Err(back) => std::io::Error::new(
                and.kind(),
                format!("{and}; the data stays in {aside}: {back}"),
            ),
        }
    })
}

/// Toglie gli spazi per-documento delle note che non esistono più, in ogni
/// spazio dati di plugin. Restituisce quante ne ha tolte.
///
/// `esiste` risponde alla sola domanda che il disco non sa fare da sé: *questo
/// documento è ancora nell'anagrafe del vault, nel suo cestino, o sul disco
/// fuori dall'anagrafe perché le impostazioni lo escludono?*
///
/// # Ciò che non si è potuto togliere **si dice**
///
/// Uno spazio dati che non c'è è il caso normale — un plugin che non ha mai
/// scritto niente — e non è un guasto. Un `list` o un `remove_dir_all` che
/// falliscono per qualunque altra ragione lo sono, e prima finivano in un
/// `continue` e in un `is_ok()`: una cancellazione **parziale** — mezza
/// cartella tolta, il resto no — tornava indietro come un numero più piccolo,
/// indistinguibile da un vault in cui c'era meno da raccogliere. Adesso risale,
/// e chi ha chiamato decide.
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
            // silenzio invece di dire che quel file non era da toccare.
            if entry.stat.kind != EntryKind::Dir
                || doc_data::encode(&doc_data::decode(name)) != name
            {
                continue;
            }
            // Uno spazio messo di lato da una migrazione rimasta a metà è
            // l'unica copia dei suoi dati: la ripresa lo completa, la raccolta
            // non lo tocca. Il prezzo è che lo spazio di una nota che si chiama
            // davvero `*.in-progress` non si raccoglie più.
            if name.ends_with(ASIDE_SUFFIX) {
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

/// La cartella di `doc` dentro lo spazio dati di **un** plugin.
fn space_dir(root: &Utf8Path, doc: &DocId) -> Utf8PathBuf {
    root.join(doc_data::DOC_SPACE)
        .join(doc_data::encode(doc.as_str()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::{DirEntry, MemStorage, Merge, Stat};
    use std::io;

    /// Un supporto che **non distingue il caso**, come APFS e NTFS: due nomi che
    /// differiscono solo per una maiuscola sono lo stesso posto.
    ///
    /// È un doppio e non una macchina, ed è il punto: la macchina su cui il
    /// difetto vive non è quella su cui gira la CI, quindi la proprietà —
    /// «rinominare `Nota.md` in `nota.md` non fa sparire i dati» — o si scrive
    /// contro un supporto così o non si scrive affatto.
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
            self.0
                .rename_no_replace(&Self::lower(from), &Self::lower(to))
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
        fn same_file(&self, a: &Utf8Path, b: &Utf8Path) -> bool {
            Self::lower(a) == Self::lower(b)
        }
        fn remove_empty_dir(&self, dir: &Utf8Path) -> io::Result<()> {
            self.0.remove_empty_dir(&Self::lower(dir))
        }
    }

    /// Una voce dello spazio per-documento chiamata `name` tale e quale.
    fn beside(root: &Utf8Path, name: &str) -> Utf8PathBuf {
        root.join(doc_data::DOC_SPACE).join(name)
    }

    fn annotation(storage: &dyn VaultStorage, root: &Utf8Path, doc: &str) -> Option<Vec<u8>> {
        storage
            .read(&space_dir(root, &DocId::new(doc)).join("annotation"))
            .ok()
    }

    /// **Correggere una maiuscola non è cancellare i dati.** La destinazione
    /// «già occupata» era la sorgente stessa, vista con l'altro nome.
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

    /// Una collisione reale non inventa una fusione fra spazi arbitrari e non
    /// cancella niente: i dati seguono la nota, l'occupante si sposta di lato
    /// con i suoi byte e l'avviso nomina entrambi.
    #[test]
    fn a_destination_collision_moves_the_occupant_aside_and_names_it() {
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

        assert_eq!(errors.len(), 1, "the displacement is named: {errors:?}");
        assert!(errors[0].contains("b.md~displaced") && errors[0].contains("a.md"));
        assert_eq!(
            annotation(&storage, &root, "b.md").as_deref(),
            Some(&b"data of a"[..]),
            "the data follows the renamed note"
        );
        assert!(!storage.exists(&space_dir(&root, &from)));
        assert_eq!(
            storage
                .read(&beside(&root, "b.md~displaced").join("annotation"))
                .expect("the occupant keeps its bytes"),
            b"a remnant"
        );
    }

    /// Un nome di lato già preso non si sovrascrive: si passa al successivo.
    /// Un file al posto della cartella si sposta come una cartella.
    #[test]
    fn a_second_displacement_takes_the_next_free_name() {
        let storage = MemStorage::new();
        let root = Utf8PathBuf::from("/vault/.fub/data/plugins/test");
        let roots = vec![root.clone()];
        let from = DocId::new("a.md");
        let to = DocId::new("b.md");
        storage
            .write(&space_dir(&root, &from).join("annotation"), b"data of a")
            .expect("written");
        storage
            .write(
                &beside(&root, "b.md~displaced").join("annotation"),
                b"older",
            )
            .expect("written");
        storage
            .write(&space_dir(&root, &to), b"a stray file")
            .expect("written");

        let errors = migrate_data(&storage, &roots, &from, &to);

        assert_eq!(errors.len(), 1, "{errors:?}");
        assert!(errors[0].contains("b.md~displaced-2"), "{errors:?}");
        assert_eq!(
            storage
                .read(&beside(&root, "b.md~displaced").join("annotation"))
                .unwrap(),
            b"older"
        );
        assert_eq!(
            storage.read(&beside(&root, "b.md~displaced-2")).unwrap(),
            b"a stray file"
        );
        assert_eq!(
            annotation(&storage, &root, "b.md").as_deref(),
            Some(&b"data of a"[..])
        );
    }

    /// La raccolta non tocca uno spazio di lato: il suo nome non è il nome di
    /// nessun documento.
    #[test]
    fn the_collection_leaves_a_displaced_space_alone() {
        let storage = MemStorage::new();
        let root = Utf8PathBuf::from("/vault/.fub/data/plugins/test");
        storage
            .write(
                &beside(&root, "b.md~displaced").join("annotation"),
                b"a remnant",
            )
            .expect("written");

        let removed = collect(&storage, std::slice::from_ref(&root), &|_| false).expect("sweep");

        assert_eq!(removed, 0);
        assert!(storage.exists(&beside(&root, "b.md~displaced").join("annotation")));
    }

    #[test]
    fn an_interrupted_document_space_move_resumes_from_the_aside_name() {
        let storage = MemStorage::new();
        let root = Utf8PathBuf::from("/vault/.fub/data/plugins/test");
        let roots = vec![root.clone()];
        let from = DocId::new("a.md");
        let to = DocId::new("b.md");
        let source = space_dir(&root, &from);
        let aside = move_aside(&source);
        storage
            .write(&source.join("annotation"), b"data of a")
            .expect("written");
        storage
            .rename(&source, &aside)
            .expect("fault lands after the first move");

        let errors = migrate_data(&storage, &roots, &from, &to);

        assert!(errors.is_empty(), "{errors:?}");
        assert_eq!(
            annotation(&storage, &root, "b.md").as_deref(),
            Some(&b"data of a"[..])
        );
        assert!(!storage.exists(&aside));
    }

    /// La ripresa atterra come la mossa intera: una destinazione comparsa fra
    /// le due mosse si sposta di lato, non si sovrascrive e non trattiene i
    /// dati della nota sotto il nome intermedio.
    #[test]
    fn recovery_moves_aside_a_destination_that_appeared_after_the_aside_move() {
        let storage = MemStorage::new();
        let root = Utf8PathBuf::from("/vault/.fub/data/plugins/test");
        let roots = vec![root.clone()];
        let from = DocId::new("a.md");
        let to = DocId::new("b.md");
        let source = space_dir(&root, &from);
        let aside = move_aside(&source);
        storage
            .write(&source.join("annotation"), b"data of a")
            .expect("written");
        storage
            .rename(&source, &aside)
            .expect("fault lands after the first move");
        storage
            .write(&space_dir(&root, &to).join("annotation"), b"external")
            .expect("external destination");

        let errors = migrate_data(&storage, &roots, &from, &to);

        assert_eq!(errors.len(), 1, "{errors:?}");
        assert_eq!(
            annotation(&storage, &root, "b.md").as_deref(),
            Some(&b"data of a"[..])
        );
        assert_eq!(
            storage
                .read(&beside(&root, "b.md~displaced").join("annotation"))
                .unwrap(),
            b"external"
        );
        assert!(!storage.exists(&aside));
    }

    /// Un supporto che non lascia atterrare niente da un nome intermedio: la
    /// seconda mossa di una migrazione fallisce, la prima no.
    struct CannotLand(MemStorage);

    impl VaultStorage for CannotLand {
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
            if from.as_str().ends_with(ASIDE_SUFFIX) && to.file_name() == Some("b.md") {
                return Err(io::Error::other("the disk stopped answering"));
            }
            self.0.rename_no_replace(from, to)
        }
        fn remove(&self, path: &Utf8Path) -> io::Result<()> {
            self.0.remove(path)
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

    /// Una migrazione che non atterra non lascia niente fuori posto: la
    /// sorgente torna sotto il suo nome, l'occupante sulla destinazione, e
    /// l'esito la segna come rimasta indietro.
    #[test]
    fn a_landing_that_fails_puts_everything_back() {
        let storage = CannotLand(MemStorage::new());
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

        let migration = migrate(&storage, &roots, &from, &to);

        let (stranded, error) = migration.stranded.expect("the space did not follow");
        assert_eq!(stranded, space_dir(&root, &from));
        assert!(error.to_string().contains("stopped answering"), "{error}");
        assert_eq!(
            annotation(&storage, &root, "a.md").as_deref(),
            Some(&b"data of a"[..])
        );
        assert_eq!(
            annotation(&storage, &root, "b.md").as_deref(),
            Some(&b"a remnant"[..])
        );
        assert!(!storage.0.exists(&move_aside(&space_dir(&root, &from))));
        assert!(!storage.0.exists(&beside(&root, "b.md~displaced")));
    }

    /// Il nome intermedio di una mossa interrotta, accanto a una sorgente che
    /// c'è, non ferma la migrazione: si sposta di lato e si dice.
    #[test]
    fn a_stale_aside_next_to_a_live_source_is_moved_aside_and_named() {
        let storage = MemStorage::new();
        let root = Utf8PathBuf::from("/vault/.fub/data/plugins/test");
        let roots = vec![root.clone()];
        let from = DocId::new("a.md");
        let to = DocId::new("b.md");
        let source = space_dir(&root, &from);
        storage
            .write(&move_aside(&source).join("annotation"), b"older data of a")
            .expect("written");
        storage
            .write(&source.join("annotation"), b"data of a")
            .expect("written");

        let migration = migrate(&storage, &roots, &from, &to);

        assert!(migration.stranded.is_none(), "{:?}", migration.messages);
        assert_eq!(migration.messages.len(), 1, "{:?}", migration.messages);
        assert_eq!(
            annotation(&storage, &root, "b.md").as_deref(),
            Some(&b"data of a"[..])
        );
        assert_eq!(
            storage
                .read(&beside(&root, "a.md.in-progress~displaced").join("annotation"))
                .expect("the interrupted move keeps its bytes"),
            b"older data of a"
        );
    }

    /// Un supporto che non lascia togliere niente: `remove_dir_all` si compone
    /// da `remove`, quindi basta rifiutare quello.
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

    /// 0193 — **una raccolta a metà non è una raccolta riuscita.**
    ///
    /// L'esito del `remove_dir_all` finiva in un `is_ok()`: ciò che non si era
    /// potuto togliere restava sul disco e il conto tornava semplicemente più
    /// piccolo, indistinguibile da un vault in cui c'era meno da raccogliere.
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

    /// La mossa di lato è riuscita e la seconda no: senza crash non c'è niente
    /// da riprendere all'apertura, e la cartella di lato è l'unica copia.
    #[test]
    fn the_sweep_keeps_a_space_left_aside_by_a_half_done_move() {
        let storage = MemStorage::new();
        let root = Utf8PathBuf::from("/vault/.fub/data/plugins/test");
        let roots = vec![root.clone()];
        let aside = move_aside(&space_dir(&root, &DocId::new("a.md")));
        storage
            .write(&aside.join("annotation"), b"data of a")
            .expect("written");

        let removed = collect(&storage, &roots, &|_| false).expect("sweep");

        assert_eq!(removed, 0);
        assert_eq!(
            storage.read(&aside.join("annotation")).unwrap(),
            b"data of a"
        );
    }

    /// E la raccolta che riesce continua a contare ciò che ha tolto.
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

        let removed = collect(&storage, &roots, &|doc| doc.as_str() == "alive.md").expect("sweep");

        assert_eq!(removed, 1);
        assert!(annotation(&storage, &root, "gone.md").is_none());
        assert!(annotation(&storage, &root, "alive.md").is_some());
    }
}
