//! Il `Vault`: astrazione su una cartella di documenti sul filesystem.
//!
//! Agnostico rispetto al formato: conosce solo file, path e la mappatura
//! path ⇆ [`DocId`]. Non sa cosa sia il markdown.

use camino::{Utf8Path, Utf8PathBuf};
use fubmd_abi::DocId;
use serde::{Deserialize, Serialize};

use crate::error::{KernelError, Result};
use crate::time::{now_unix, stamp_from_unix};

/// Cartella dei dati **derivati** del vault: indice di ricerca, storage
/// persistente dei plugin. Sta dentro al vault perché ciò che è derivato da un
/// vault appartiene a quel vault — copiarlo o spostarlo se li porta dietro — ed
/// è ignorata dalla scansione: non sono documenti.
pub const DATA_DIR: &str = ".fubmd-data";

/// Directory ignorate durante la scansione del vault.
const IGNORED_DIRS: &[&str] = &[".obsidian", ".git", DATA_DIR, ".trash", "node_modules"];

/// Nome della cartella cestino dentro il vault.
///
/// È la stessa che usa Obsidian per "Move to Obsidian trash": un vault
/// condiviso fra le due app ha **un solo** cestino (vedi
/// `docs/PIANO.md`, "Decisioni (con il perché)", e
/// `docs/architecture/data-model.md`, "Il cestino").
pub const TRASH_DIR: &str = ".trash";

/// Un componente di path che il vault non deve mai guardare.
///
/// Unico punto di verità della regola: la usano sia la scansione
/// ([`Vault::list_documents`]) sia il percorso del watcher
/// ([`Vault::is_ignored`]). Finché viveva solo dentro la scansione, ogni file
/// spostato nel cestino tornava dentro dalla porta di servizio del watcher.
fn is_ignored_name(name: &str) -> bool {
    name.starts_with('.') || IGNORED_DIRS.contains(&name)
}

pub struct Vault {
    root: Utf8PathBuf,
}

impl Vault {
    pub fn open(root: impl AsRef<Utf8Path>) -> Self {
        Vault {
            root: root.as_ref().to_owned(),
        }
    }

    pub fn root(&self) -> &Utf8Path {
        &self.root
    }

    /// [`DocId`] (path relativo al vault, separatori `/`) per un path assoluto.
    pub fn doc_id_for_path(&self, abs: &Utf8Path) -> Result<DocId> {
        let rel = abs
            .strip_prefix(&self.root)
            .map_err(|_| KernelError::OutsideVault(abs.to_owned()))?;
        Ok(DocId::new(rel.as_str().replace('\\', "/")))
    }

    /// Path assoluto per un [`DocId`].
    pub fn path_for(&self, id: &DocId) -> Utf8PathBuf {
        self.root.join(id.as_str())
    }

    /// Il path assoluto cade in una parte del vault che non va guardata?
    ///
    /// Vale per **ogni** componente, non solo per l'ultimo: un file dentro
    /// `.trash/` è invisibile quanto la cartella che lo contiene. Un path fuori
    /// dal vault non è ignorato — semplicemente non è roba nostra, e a dirlo è
    /// [`Vault::doc_id_for_path`].
    pub fn is_ignored(&self, abs: &Utf8Path) -> bool {
        let Ok(rel) = abs.strip_prefix(&self.root) else {
            return false;
        };
        rel.components().any(|c| is_ignored_name(c.as_str()))
    }

    /// Elenca i documenti del vault le cui estensioni sono tra quelle date
    /// (senza punto, minuscole). Salta le directory ignorate e i file nascosti.
    pub fn list_documents(&self, extensions: &[String]) -> Result<Vec<DocId>> {
        let mut out = Vec::new();
        self.walk(&self.root, extensions, &mut out)?;
        out.sort();
        Ok(out)
    }

    fn walk(&self, dir: &Utf8Path, exts: &[String], out: &mut Vec<DocId>) -> Result<()> {
        let entries = std::fs::read_dir(dir).map_err(|e| KernelError::Io {
            path: dir.to_owned(),
            source: e,
        })?;
        for entry in entries {
            let entry = entry.map_err(|e| KernelError::Io {
                path: dir.to_owned(),
                source: e,
            })?;
            let path = entry.path();
            let path = Utf8PathBuf::from_path_buf(path).map_err(KernelError::NonUtf8Path)?;
            let name = path.file_name().unwrap_or_default();
            if is_ignored_name(name) {
                continue;
            }
            let file_type = entry.file_type().map_err(|e| KernelError::Io {
                path: path.clone(),
                source: e,
            })?;
            if file_type.is_dir() {
                self.walk(&path, exts, out)?;
            } else if file_type.is_file() {
                if let Some(ext) = path.extension() {
                    if exts.iter().any(|e| e.eq_ignore_ascii_case(ext)) {
                        out.push(self.doc_id_for_path(&path)?);
                    }
                }
            }
        }
        Ok(())
    }

    pub fn read(&self, id: &DocId) -> Result<String> {
        let path = self.path_for(id);
        std::fs::read_to_string(&path).map_err(|e| KernelError::Io { path, source: e })
    }

    pub fn write(&self, id: &DocId, source: &str) -> Result<()> {
        let path = self.path_for(id);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| KernelError::Io {
                path: parent.to_owned(),
                source: e,
            })?;
        }
        std::fs::write(&path, source).map_err(|e| KernelError::Io { path, source: e })
    }

    pub fn exists(&self, id: &DocId) -> bool {
        self.path_for(id).exists()
    }

    /// Sposta un documento (creando le cartelle di destinazione se mancano).
    pub fn rename(&self, from: &DocId, to: &DocId) -> Result<()> {
        let from_path = self.path_for(from);
        let to_path = self.path_for(to);
        if let Some(parent) = to_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| KernelError::Io {
                path: parent.to_owned(),
                source: e,
            })?;
        }
        std::fs::rename(&from_path, &to_path).map_err(|e| KernelError::Io {
            path: from_path,
            source: e,
        })
    }

    // --- cestino ----------------------------------------------------------

    /// Sposta un documento nel cestino del vault e restituisce il [`DocId`] che
    /// vi ha assunto.
    ///
    /// Il cestino è **piatto**, come quello di Obsidian: la cartella di
    /// provenienza non sopravvive alla cancellazione (un ripristino riporta la
    /// nota nella radice). È il prezzo di avere *un solo* cestino in un vault
    /// condiviso fra le due app — vedi D1 — e il motivo per cui il nome
    /// originale va ricavato dal nome del file, non dal suo path.
    ///
    /// Sulle collisioni non si sovrascrive e non si fallisce: il nome prende un
    /// suffisso con l'istante della cancellazione (D2), e — se anche quello è
    /// occupato, cioè due cancellazioni nello stesso secondo — un contatore.
    pub fn trash(&self, id: &DocId) -> Result<DocId> {
        let from = self.path_for(id);
        let dir = self.root.join(TRASH_DIR);
        std::fs::create_dir_all(&dir).map_err(|e| KernelError::Io {
            path: dir.clone(),
            source: e,
        })?;

        let name = file_name_of(id.as_str());
        let stamp = stamp_from_unix(now_unix());
        let target = (0u32..)
            .map(|n| match n {
                0 => name.to_string(),
                1 => stamped_name(name, &stamp),
                _ => stamped_name(name, &format!("{stamp}-{n}")),
            })
            .map(|candidate| DocId::new(format!("{TRASH_DIR}/{candidate}")))
            .find(|candidate| !self.exists(candidate))
            .expect("la sequenza dei candidati è infinita");

        std::fs::rename(&from, self.path_for(&target)).map_err(|e| KernelError::Io {
            path: from,
            source: e,
        })?;
        Ok(target)
    }

    /// Il contenuto del cestino, dal più recente al più vecchio.
    ///
    /// Elenca **tutti** i file, anche quelli che nessun provider saprebbe
    /// riaprire e anche quelli dentro sottocartelle (Obsidian cestina cartelle
    /// intere): nascondere righe da una lista che l'utente sta per svuotare
    /// sarebbe il modo peggiore di essere discreti. Un ripristino impossibile
    /// lo dice quando glielo si chiede.
    pub fn list_trash(&self) -> Result<Vec<TrashEntry>> {
        let dir = self.root.join(TRASH_DIR);
        if !dir.exists() {
            return Ok(Vec::new());
        }
        let mut out = Vec::new();
        self.walk_trash(&dir, &mut out)?;
        // A parità di istante decide il nome, così l'ordine è totale e i test
        // non dipendono dall'ordine di lettura della directory.
        out.sort_by(|a, b| {
            b.deleted_at
                .cmp(&a.deleted_at)
                .then_with(|| a.id.as_str().cmp(b.id.as_str()))
        });
        Ok(out)
    }

    fn walk_trash(&self, dir: &Utf8Path, out: &mut Vec<TrashEntry>) -> Result<()> {
        let io = |path: &Utf8Path, e: std::io::Error| KernelError::Io {
            path: path.to_owned(),
            source: e,
        };
        for entry in std::fs::read_dir(dir).map_err(|e| io(dir, e))? {
            let entry = entry.map_err(|e| io(dir, e))?;
            let path =
                Utf8PathBuf::from_path_buf(entry.path()).map_err(KernelError::NonUtf8Path)?;
            let meta = entry.metadata().map_err(|e| io(&path, e))?;
            if meta.is_dir() {
                self.walk_trash(&path, out)?;
                continue;
            }
            let id = self.doc_id_for_path(&path)?;
            let name = file_name_of(id.as_str());
            out.push(TrashEntry {
                original: DocId::new(strip_stamp(name)),
                // L'mtime è l'istante dello spostamento nel cestino. Se il
                // filesystem non lo sa dire, meglio "epoca zero" che rifiutare
                // di mostrare la riga: la data è un dettaglio, la nota no.
                deleted_at: meta
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs())
                    .unwrap_or(0),
                size: meta.len(),
                id,
            });
        }
        Ok(())
    }

    /// Cancella davvero un file, ma **solo** dentro il cestino.
    ///
    /// È l'unica cancellazione che il vault sa fare, ed è deliberato: dall'app
    /// una nota si sposta nel cestino ([`Vault::trash`]), non si distrugge.
    /// Qui il file è già stato cestinato una volta, e svuotare il cestino è
    /// l'atto con cui l'utente conferma.
    pub fn remove_trashed(&self, id: &DocId) -> Result<()> {
        let path = self.path_for(id);
        if !path.starts_with(self.root.join(TRASH_DIR)) {
            return Err(KernelError::OutsideVault(path));
        }
        std::fs::remove_file(&path).map_err(|e| KernelError::Io { path, source: e })
    }

    /// Svuota il cestino e restituisce quante voci ha cancellato. Le
    /// sottocartelle rimaste vuote se ne vanno con il loro contenuto.
    pub fn empty_trash(&self) -> Result<usize> {
        let entries = self.list_trash()?;
        for entry in &entries {
            self.remove_trashed(&entry.id)?;
        }
        let dir = self.root.join(TRASH_DIR);
        if dir.exists() {
            std::fs::remove_dir_all(&dir).map_err(|e| KernelError::Io {
                path: dir.clone(),
                source: e,
            })?;
        }
        Ok(entries.len())
    }
}

/// Una voce del cestino.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TrashEntry {
    /// Dove il file si trova ora: `.trash/Nota.2026-07-24T15-30-00.md`.
    pub id: DocId,
    /// Dove tornerebbe un ripristino: il nome originale, nella radice.
    pub original: DocId,
    /// Istante della cancellazione (secondi UNIX).
    pub deleted_at: u64,
    pub size: u64,
}

fn file_name_of(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

/// `Nota.md` + `2026-07-24T15-30-00` → `Nota.2026-07-24T15-30-00.md`.
///
/// Il suffisso va **prima** dell'estensione, non dopo: un file che finisce per
/// `.md` resta un file markdown, aperto da Obsidian come dagli altri.
fn stamped_name(name: &str, stamp: &str) -> String {
    match name.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() => format!("{stem}.{stamp}.{ext}"),
        _ => format!("{name}.{stamp}"),
    }
}

/// L'inverso di [`stamped_name`]: il nome originale di un file cestinato.
///
/// Riconosce il suffisso dalla **forma**, non da un registro: il cestino è
/// condiviso con Obsidian, che non tiene nota di nulla, e la ricostruzione deve
/// funzionare anche su file che FubMD non ha mai visto. Il prezzo è che una
/// nota davvero intitolata `Riunione.2026-07-24T15-30-00` si ripristina come
/// `Riunione` — l'utente la rinomina, e nessun dato è andato perso.
fn strip_stamp(name: &str) -> String {
    let Some((stem, ext)) = name.rsplit_once('.') else {
        return name.to_string();
    };
    // Un file senza estensione porta il timbro in coda: lì l'estensione è il
    // timbro stesso.
    if !stem.is_empty() && is_stamp(ext) {
        return stem.to_string();
    }
    match stem.rsplit_once('.') {
        Some((base, tail)) if !base.is_empty() && is_stamp(tail) => format!("{base}.{ext}"),
        _ => name.to_string(),
    }
}

/// La forma `YYYY-MM-DDTHH-MM-SS`, eventualmente seguita da `-<contatore>`
/// (due cancellazioni della stessa nota nello stesso secondo).
fn is_stamp(s: &str) -> bool {
    let b = s.as_bytes();
    if b.len() < 19 {
        return false;
    }
    let forma = b[..19].iter().enumerate().all(|(i, c)| match i {
        4 | 7 | 13 | 16 => *c == b'-',
        10 => *c == b'T',
        _ => c.is_ascii_digit(),
    });
    let contatore = match &b[19..] {
        [] => true,
        [b'-', cifre @ ..] => !cifre.is_empty() && cifre.iter().all(|c| c.is_ascii_digit()),
        _ => false,
    };
    forma && contatore
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_trashed_name_keeps_its_extension() {
        // Il timbro sta in mezzo: il file resta un `.md`, e Obsidian lo apre.
        assert_eq!(
            stamped_name("Nota.md", "2026-07-24T15-30-00"),
            "Nota.2026-07-24T15-30-00.md"
        );
        assert_eq!(
            stamped_name("senza-estensione", "2026-07-24T15-30-00"),
            "senza-estensione.2026-07-24T15-30-00"
        );
        // Un file che è solo estensione (`.gitignore`) non ha stem da timbrare.
        assert_eq!(
            stamped_name(".env", "2026-07-24T15-30-00"),
            ".env.2026-07-24T15-30-00"
        );
    }

    #[test]
    fn the_original_name_survives_the_round_trip() {
        for nome in ["Nota.md", "Con.punti.nel.nome.md", "senza-estensione"] {
            let timbrato = stamped_name(nome, "2026-07-24T15-30-00");
            assert_eq!(strip_stamp(&timbrato), nome, "andata e ritorno di {nome}");
        }
        // Anche col contatore delle collisioni nello stesso secondo.
        assert_eq!(strip_stamp("Nota.2026-07-24T15-30-00-3.md"), "Nota.md");
    }

    #[test]
    fn a_name_that_only_looks_stamped_is_left_alone() {
        // Un file mai timbrato torna identico.
        assert_eq!(strip_stamp("Nota.md"), "Nota.md");
        // Forma sbagliata: non è un timbro, è parte del nome.
        assert_eq!(
            strip_stamp("Riunione.2026-07-24 15:30:00.md"),
            "Riunione.2026-07-24 15:30:00.md"
        );
        assert_eq!(strip_stamp("Bilancio.2026.md"), "Bilancio.2026.md");
        // Il contatore vuole cifre, non un suffisso qualsiasi.
        assert_eq!(
            strip_stamp("Nota.2026-07-24T15-30-00-bozza.md"),
            "Nota.2026-07-24T15-30-00-bozza.md"
        );
    }

    #[test]
    fn what_is_ignored_is_ignored_at_any_depth() {
        let v = Vault::open("/vault");
        assert!(!v.is_ignored("/vault/note/Idea.md".into()));
        assert!(v.is_ignored("/vault/.trash/Idea.md".into()));
        assert!(v.is_ignored("/vault/.obsidian/plugins/x/main.js".into()));
        assert!(v.is_ignored("/vault/node_modules/pacchetto/readme.md".into()));
        // Un file nascosto è nascosto anche in fondo a un path pulito.
        assert!(v.is_ignored("/vault/note/.bozza.md".into()));
        // Fuori dal vault non è "ignorato": è di qualcun altro, e a dirlo è
        // `doc_id_for_path`.
        assert!(!v.is_ignored("/altrove/.trash/Idea.md".into()));
    }
}
