//! **Il corpus senza perdite della pre-alpha** (PA T13).
//!
//! Per ogni formato della pre-alpha un file vero, copiato in
//! `tests/fixtures/prealpha-corpus/` dai corpus che ci sono già (il `README.md`
//! accanto dice da dove viene ciascuno). Il test copia il corpus in una
//! cartella temporanea, apre il vault con l'host vero e per ogni file prova:
//!
//! - che aprirlo e chiuderlo come fa la shell non cambia un byte: la lettura
//!   con la chiave di apertura, la griglia per un foglio, la risorsa per un
//!   PDF, e la chiusura della chiave (`document_closed`) dei motori;
//! - che scriverlo da una revisione vecchia dà il conflitto tipizzato, e il
//!   file resta;
//! - che un file in sola lettura per un motivo che l'host conosce (un `.docx`
//!   protetto, una cartella di Excel coperta da byte) rifiuta la scrittura
//!   con la sua specie, e il file resta;
//! - che un file che sparisce fra la lettura e la scrittura non rinasce;
//! - per i formati di testo (Markdown, SVG, `.canvas`), che una modifica
//!   piccola cambia i byte soltanto nello spazio della modifica, e che i fine
//!   riga e il BOM restano.
//!
//! La modifica di un `.docx` e di un `.xlsx` ha i suoi test nei crate dei
//! formati: il `README.md` del corpus li nomina.

#![cfg(all(
    feature = "rich",
    feature = "xlsx",
    feature = "draw",
    feature = "lavagna"
))]

use camino::Utf8PathBuf;
use fub_abi::command::InvokeMode;
use fub_abi::edit::{Revision, WriteBase};
use fub_abi::grid::GridWindowRequest;
use fub_abi::model::DocId;
use fub_abi::{GridCellKey, GridJournal, PluginError};
use fub_format_xlsx::grid::XLSX_GRID_SURFACE;
use fub_host::resources::{ResourceHost, ResourceWrite};
use fub_host::{Host, OpenKey};
use serde_json::json;

/// Il formato di un file del corpus, cioè come la shell lo apre e lo scrive.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Kind {
    /// Testo: la sorgente si legge e si scrive intera.
    Markdown,
    Svg,
    Canvas,
    /// Videoscrittura: la proiezione sotto la chiave di apertura.
    Docx,
    /// Foglio: il giornale vuoto, la griglia sui byte.
    Xlsx,
    /// Un PDF: una risorsa a byte.
    Pdf,
}

impl Kind {
    /// Il formato che il vault riconosce al file, se è un documento.
    fn format_id(self) -> Option<&'static str> {
        match self {
            Kind::Markdown => Some("markdown"),
            Kind::Svg => Some("svg"),
            Kind::Canvas => Some("canvas"),
            Kind::Docx => Some("docx"),
            Kind::Xlsx => Some("xlsx"),
            Kind::Pdf => None,
        }
    }
}

/// Ogni file del corpus, col suo formato. Il test
/// `il_corpus_è_tutto_qui_e_ha_la_provenienza` controlla che la cartella
/// non abbia altro e che il `README.md` li nomini tutti.
const CORPUS: &[(&str, Kind)] = &[
    ("Markdown/Alpha CRLF.md", Kind::Markdown),
    ("Markdown/Nota B con BOM.md", Kind::Markdown),
    ("Markdown/Indice è più già.md", Kind::Markdown),
    ("Documenti/Senza perdite.docx", Kind::Docx),
    ("Documenti/Protetto.docx", Kind::Docx),
    ("Fogli/Conti con formule.xlsx", Kind::Xlsx),
    ("Disegni/Mappa del quartiere.svg", Kind::Svg),
    ("Lavagne/Città con BOM.canvas", Kind::Canvas),
    ("PDF/Scena.pdf", Kind::Pdf),
];

/// I file della cartella del corpus che non sono del corpus.
const NOT_CORPUS: &[&str] = &["README.md", ".gitattributes"];

const BOM: &[u8] = b"\xEF\xBB\xBF";

fn fixtures() -> Utf8PathBuf {
    Utf8PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/prealpha-corpus")
}

/// I byte del file del corpus com'è nel repository.
fn original(name: &str) -> Vec<u8> {
    std::fs::read(fixtures().join(name)).expect("the corpus file is in the repository")
}

/// Il corpus copiato in una cartella temporanea e aperto con l'host vero.
struct Vault {
    _config: tempfile::TempDir,
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
    host: Host,
}

impl Vault {
    fn open() -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = Utf8PathBuf::from_path_buf(dir.path().canonicalize().unwrap()).expect("utf8");
        for (name, _) in CORPUS {
            let to = root.join(name);
            std::fs::create_dir_all(to.parent().unwrap()).unwrap();
            std::fs::copy(fixtures().join(name), &to).expect("copies the corpus file");
        }
        let config = tempfile::tempdir().expect("config");
        let host = Host::without_watcher()
            .with_config_dir(&Utf8PathBuf::from_path_buf(config.path().to_path_buf()).unwrap());
        host.open(&root).expect("opens the vault");
        host.wait_indexed(Some(root.as_str())).expect("indexed");
        Vault {
            _config: config,
            _dir: dir,
            root,
            host,
        }
    }

    fn name(&self) -> Option<&str> {
        Some(self.root.as_str())
    }

    fn on_disk(&self, name: &str) -> Vec<u8> {
        std::fs::read(self.root.join(name)).expect("the file is on disk")
    }

    fn path(&self, name: &str) -> Utf8PathBuf {
        self.root.join(name)
    }
}

impl Drop for Vault {
    fn drop(&mut self) {
        let _ = self.host.close();
    }
}

fn key(name: &str) -> OpenKey {
    // Una chiave per file, come una sessione di documento della shell.
    let n = CORPUS
        .iter()
        .position(|(file, _)| *file == name)
        .expect("a corpus file");
    OpenKey::parse(&format!("prealpha-corpus-{n}")).expect("a well-formed key")
}

/// Ciò che la shell tiene di un file aperto: la sorgente (o la proiezione,
/// o il giornale) e la revisione su cui scriverà.
struct Opened {
    source: String,
    revision: Revision,
}

/// Apre il file come la shell e lo lascia aperto sotto la sua chiave.
fn open_as_shell(vault: &Vault, name: &str, kind: Kind) -> Opened {
    let id = DocId::new(name);
    if kind == Kind::Pdf {
        // Il visore dei PDF legge la risorsa a pezzi, e la chiude.
        let descriptor = vault
            .host
            .resource_open(vault.name(), &id)
            .expect("opens the PDF");
        let mut bytes = Vec::new();
        loop {
            let chunk = vault
                .host
                .resource_read(descriptor.handle, bytes.len() as u64, 64 * 1024)
                .expect("reads the PDF");
            if chunk.is_empty() {
                break;
            }
            bytes.extend(chunk);
        }
        vault
            .host
            .resource_close(descriptor.handle)
            .expect("closes the PDF");
        assert_eq!(descriptor.len, bytes.len() as u64, "{name}");
        assert_eq!(bytes, original(name), "{name}: the PDF reads as it is");
        return Opened {
            source: String::new(),
            revision: Revision::of_bytes(&bytes),
        };
    }
    let (source, revision, format) = vault
        .host
        .open_document_with_format(vault.name(), &id, &key(name))
        .unwrap_or_else(|error| panic!("{name}: opens: {error:?}"));
    assert_eq!(
        format.map(|known| known.descriptor.id),
        kind.format_id().map(str::to_string),
        "{name}: the format the vault recognises"
    );
    if kind == Kind::Xlsx {
        // La griglia si apre sui byte col giornale vuoto, mostra le celle e
        // si chiude.
        let session = vault
            .host
            .grid_bytes_open(
                vault.name(),
                XLSX_GRID_SURFACE,
                &id,
                &source,
                revision.clone(),
            )
            .expect("the grid opens");
        let window = vault
            .host
            .grid_bytes_window(
                vault.name(),
                XLSX_GRID_SURFACE,
                &session.instance,
                GridWindowRequest {
                    revision: session.revision.clone(),
                    sheet: "s1".into(),
                    row_start: 0,
                    row_count: 3,
                    column_start: 0,
                    column_count: 2,
                    known_media: Vec::new(),
                },
            )
            .expect("the grid shows the cells");
        assert!(!window.cells.is_empty(), "{name}: the grid has cells");
        vault
            .host
            .grid_bytes_close(vault.name(), XLSX_GRID_SURFACE, &session.instance)
            .expect("the grid closes");
    }
    Opened { source, revision }
}

/// La shell chiude la sessione del documento.
fn close_as_shell(vault: &Vault, name: &str, kind: Kind) {
    if kind != Kind::Pdf {
        vault
            .host
            .document_closed(vault.name(), &key(name))
            .expect("closes the key");
    }
}

/// Una revisione che il file non ha: quella di altri byte.
fn stale() -> Revision {
    Revision::of_bytes(b"una versione di prima")
}

/// Il giornale di una cella cambiata del foglio del corpus: A1 da 1 a 2.
fn xlsx_journal() -> String {
    let mut journal = GridJournal::new();
    journal
        .record(
            GridCellKey {
                sheet: "s1".into(),
                row: "r0".into(),
                column: "c0".into(),
            },
            "1".into(),
            "2".into(),
        )
        .expect("a journal entry");
    journal.to_text()
}

/// Scrive il file come la shell, da `base`. Per il testo la sorgente con una
/// parola in più, per la videoscrittura la proiezione com'è, per il foglio
/// una cella cambiata, per il PDF altri byte.
fn write_as_shell(
    vault: &Vault,
    name: &str,
    kind: Kind,
    opened: &Opened,
    base: Revision,
) -> Result<Revision, PluginError> {
    let id = DocId::new(name);
    match kind {
        Kind::Markdown | Kind::Svg | Kind::Canvas => {
            // Il JSON della lavagna e l'XML del disegno restano validi con
            // uno spazio in più prima dell'ultimo a capo.
            let mut source = opened.source.clone();
            let at = source.trim_end().len();
            source.insert(at, ' ');
            vault.host.write_open_document(
                vault.name(),
                &id,
                &source,
                WriteBase::DescendsFrom(base),
                &key(name),
            )
        }
        Kind::Docx => vault.host.write_open_document(
            vault.name(),
            &id,
            &with_a_word_more(&opened.source),
            WriteBase::DescendsFrom(base),
            &key(name),
        ),
        Kind::Xlsx => vault.host.write_open_document(
            vault.name(),
            &id,
            &xlsx_journal(),
            WriteBase::DescendsFrom(base),
            &key(name),
        ),
        Kind::Pdf => vault
            .host
            .resource_write(vault.name(), &id, b"%PDF-1.7\n%%EOF\n", Some(base))
            .map(|receipt| receipt.revision),
    }
}

/// La proiezione di un documento di videoscrittura con una parola in più nel
/// primo testo: una proiezione uguale non scriverebbe niente, e la prova
/// del rifiuto non proverebbe nulla.
fn with_a_word_more(projection: &str) -> String {
    fn first_text(value: &mut serde_json::Value) -> bool {
        match value {
            serde_json::Value::Object(map) => {
                if let Some(serde_json::Value::String(text)) = map.get_mut("x") {
                    text.push_str(" ancora");
                    return true;
                }
                map.values_mut().any(first_text)
            }
            serde_json::Value::Array(items) => items.iter_mut().any(first_text),
            _ => false,
        }
    }
    let mut value: serde_json::Value =
        serde_json::from_str(projection).expect("the projection is JSON");
    assert!(
        first_text(value.get_mut("blocks").expect("the projection has blocks")),
        "the projection has a text"
    );
    value.to_string()
}

/// La chiave del catalogo di un errore tipizzato.
fn message_key(error: &PluginError) -> Option<&str> {
    match error {
        PluginError::PermissionDenied(text) | PluginError::BadArgs(text) => {
            text.as_message().map(|message| message.key.as_str())
        }
        _ => None,
    }
}

#[test]
fn il_corpus_è_tutto_qui_e_ha_la_provenienza() {
    let mut on_disk = Vec::new();
    let mut pending = vec![fixtures()];
    while let Some(dir) = pending.pop() {
        for entry in std::fs::read_dir(&dir).unwrap() {
            let path = Utf8PathBuf::from_path_buf(entry.unwrap().path()).unwrap();
            if path.is_dir() {
                pending.push(path);
            } else {
                on_disk.push(
                    path.strip_prefix(fixtures())
                        .unwrap()
                        .as_str()
                        .replace('\\', "/"),
                );
            }
        }
    }
    on_disk.retain(|name| !NOT_CORPUS.contains(&name.as_str()));
    on_disk.sort();
    let mut listed: Vec<String> = CORPUS.iter().map(|(name, _)| name.to_string()).collect();
    listed.sort();
    assert_eq!(
        on_disk, listed,
        "the corpus folder holds the corpus and nothing else"
    );

    let readme = std::fs::read_to_string(fixtures().join("README.md")).unwrap();
    for (name, _) in CORPUS {
        assert!(
            readme.contains(&format!("`{name}`")),
            "the README says where `{name}` comes from"
        );
    }
}

/// I file del corpus hanno ciò che il piano chiede: senza, il resto del test
/// proverebbe meno di quanto dice.
#[test]
fn il_corpus_ha_crlf_bom_frontmatter_e_caratteri_fuori_dal_piano_base() {
    let alpha = original("Markdown/Alpha CRLF.md");
    assert!(!alpha.starts_with(BOM));
    assert!(alpha.starts_with(b"---\r\n"), "frontmatter, CRLF");
    assert_eq!(lone_lf(&alpha), 0);

    let nota = original("Markdown/Nota B con BOM.md");
    assert!(
        nota.starts_with(b"\xEF\xBB\xBF---\n"),
        "BOM, frontmatter, LF"
    );

    let indice = original("Markdown/Indice è più già.md");
    assert!(indice.starts_with(b"\xEF\xBB\xBF---\r\n"));
    assert_eq!(lone_lf(&indice), 0);
    let text = std::str::from_utf8(&indice[3..]).unwrap();
    assert!(text.chars().any(|c| c as u32 > 0xFFFF), "outside the BMP");

    let svg = original("Disegni/Mappa del quartiere.svg");
    assert!(svg.starts_with(BOM) && lone_lf(&svg) == 0);
    assert!(std::str::from_utf8(&svg).unwrap().contains("inkscape"));

    let canvas = original("Lavagne/Città con BOM.canvas");
    assert!(canvas.starts_with(BOM) && lone_lf(&canvas) == 0);

    assert!(original("PDF/Scena.pdf").starts_with(b"%PDF-"));
    assert!(original("Documenti/Senza perdite.docx").starts_with(b"PK"));
    assert!(original("Fogli/Conti con formule.xlsx").starts_with(b"PK"));
}

/// Quanti `\n` non vengono dopo un `\r`.
fn lone_lf(bytes: &[u8]) -> usize {
    bytes
        .iter()
        .enumerate()
        .filter(|(at, byte)| **byte == b'\n' && (*at == 0 || bytes[at - 1] != b'\r'))
        .count()
}

#[test]
fn aprire_e_chiudere_come_la_shell_non_cambia_un_byte() {
    let vault = Vault::open();
    for &(name, kind) in CORPUS {
        // Due volte: la seconda apertura trova il motore già caldo.
        for _ in 0..2 {
            let opened = open_as_shell(&vault, name, kind);
            assert_eq!(
                opened.revision,
                Revision::of_bytes(&original(name)),
                "{name}: the revision is the one of the bytes"
            );
            close_as_shell(&vault, name, kind);
            assert_eq!(
                vault.on_disk(name),
                original(name),
                "{name}: not a byte changed"
            );
        }
    }
    assert_eq!(vault.host.open_keys(vault.name()), 0, "every key is closed");
}

#[test]
fn una_revisione_vecchia_dà_il_conflitto_e_il_file_resta() {
    let vault = Vault::open();
    for &(name, kind) in CORPUS {
        let opened = open_as_shell(&vault, name, kind);
        let written = write_as_shell(&vault, name, kind, &opened, stale());
        assert!(
            matches!(written, Err(PluginError::Conflict(_))),
            "{name}: the typed conflict, not {written:?}"
        );
        close_as_shell(&vault, name, kind);
        assert_eq!(
            vault.on_disk(name),
            original(name),
            "{name}: the file stays"
        );
    }
}

/// La sola lettura per un motivo che l'host conosce, lo stesso sui tre
/// sistemi: un `.docx` protetto dal suo autore, e una cartella di Excel che
/// la shell vorrebbe coprire con dei byte suoi invece di innestare il
/// giornale. Il permesso del file non è un motivo che l'host conosca: su
/// Linux e macOS la scrittura atomica sostituisce anche un file senza il
/// permesso di scrittura, e su Windows il rifiuto arriva come `Io`, non come
/// `PermissionDenied`. Per questo qui non si prova (PA T13, la domanda è
/// nel resoconto del task).
#[test]
fn un_file_in_sola_lettura_rifiuta_la_scrittura_e_resta() {
    let vault = Vault::open();

    let name = "Documenti/Protetto.docx";
    let opened = open_as_shell(&vault, name, Kind::Docx);
    let written = write_as_shell(&vault, name, Kind::Docx, &opened, opened.revision.clone());
    close_as_shell(&vault, name, Kind::Docx);
    assert_eq!(
        written.as_ref().err().and_then(message_key),
        Some("host.rich.readonly.protected"),
        "{name}: the typed refusal, not {written:?}"
    );
    assert_eq!(
        vault.on_disk(name),
        original(name),
        "{name}: the file stays"
    );

    let name = "Fogli/Conti con formule.xlsx";
    let opened = open_as_shell(&vault, name, Kind::Xlsx);
    let written = vault.host.resource_write(
        vault.name(),
        &DocId::new(name),
        &original("Documenti/Senza perdite.docx"),
        Some(opened.revision.clone()),
    );
    close_as_shell(&vault, name, Kind::Xlsx);
    assert_eq!(
        written.as_ref().err().and_then(message_key),
        Some("host.xlsx.readonly"),
        "{name}: the typed refusal"
    );
    assert_eq!(
        vault.on_disk(name),
        original(name),
        "{name}: the file stays"
    );
}

#[test]
fn un_file_che_sparisce_durante_la_prova_non_rinasce() {
    let vault = Vault::open();
    for &(name, kind) in CORPUS {
        let opened = open_as_shell(&vault, name, kind);
        std::fs::remove_file(vault.path(name)).expect("the file goes away");
        let written = write_as_shell(&vault, name, kind, &opened, opened.revision.clone());
        close_as_shell(&vault, name, kind);
        // Un foglio non nasce da un giornale: senza i byte non c'è niente in
        // cui innestarlo.
        let typed = match kind {
            Kind::Xlsx => written.as_ref().err().and_then(message_key) == Some("host.xlsx.missing"),
            _ => matches!(
                written,
                Err(PluginError::Conflict(_) | PluginError::NotFound(_))
            ),
        };
        assert!(typed, "{name}: a typed error, not {written:?}");
        assert!(
            !vault.path(name).exists(),
            "{name}: the file is not born again"
        );
    }
}

/// I byte prima e dopo una modifica differiscono soltanto dentro `span`
/// (un intervallo dei byte di prima), e i fine riga e il BOM restano.
#[track_caller]
fn changed_only_inside(name: &str, before: &[u8], after: &[u8], span: std::ops::Range<usize>) {
    let prefix = before.iter().zip(after).take_while(|(a, b)| a == b).count();
    let suffix = before
        .iter()
        .rev()
        .zip(after.iter().rev())
        .take_while(|(a, b)| a == b)
        .count()
        .min(before.len().min(after.len()) - prefix);
    let changed = prefix..before.len() - suffix;
    assert!(
        span.start <= changed.start && changed.end <= span.end,
        "{name}: bytes {changed:?} changed, only {span:?} should: {:?} became {:?}",
        String::from_utf8_lossy(&before[changed.clone()]),
        String::from_utf8_lossy(&after[prefix..after.len() - suffix]),
    );
    assert_eq!(
        before.starts_with(BOM),
        after.starts_with(BOM),
        "{name}: the BOM"
    );
    assert_eq!(lone_lf(before), lone_lf(after), "{name}: the line endings");
    assert_eq!(
        before.windows(2).filter(|w| w == b"\r\n").count(),
        after.windows(2).filter(|w| w == b"\r\n").count(),
        "{name}: the line endings"
    );
}

/// Dove sta `needle` nei byte di `bytes`, la prima volta.
fn find(bytes: &[u8], needle: &str) -> std::ops::Range<usize> {
    let at = bytes
        .windows(needle.len())
        .position(|window| window == needle.as_bytes())
        .unwrap_or_else(|| panic!("{needle:?} is in the file"));
    at..at + needle.len()
}

/// Cambia una parola della sorgente come farebbe la shell, e scrive.
fn change_a_word(vault: &Vault, name: &str, kind: Kind, from: &str, to: &str) {
    let opened = open_as_shell(vault, name, kind);
    assert!(
        opened.source.contains(from),
        "{name}: {from:?} is in the source"
    );
    let source = opened.source.replacen(from, to, 1);
    vault
        .host
        .write_open_document(
            vault.name(),
            &DocId::new(name),
            &source,
            WriteBase::DescendsFrom(opened.revision.clone()),
            &key(name),
        )
        .unwrap_or_else(|error| panic!("{name}: writes: {error:?}"));
    close_as_shell(vault, name, kind);
}

#[test]
fn una_parola_cambiata_cambia_solo_quella_e_tiene_fine_riga_e_bom() {
    let vault = Vault::open();
    for (name, kind, from, to) in [
        (
            "Markdown/Alpha CRLF.md",
            Kind::Markdown,
            "Dipende",
            "Discende",
        ),
        (
            "Markdown/Nota B con BOM.md",
            Kind::Markdown,
            "grassetto",
            "corsivo",
        ),
        (
            "Markdown/Indice è più già.md",
            Kind::Markdown,
            "violino",
            "basso",
        ),
        (
            "Disegni/Mappa del quartiere.svg",
            Kind::Svg,
            "Parco",
            "Prato",
        ),
    ] {
        let before = vault.on_disk(name);
        change_a_word(&vault, name, kind, from, to);
        let after = vault.on_disk(name);
        assert_ne!(before, after, "{name}: the word changed");
        changed_only_inside(name, &before, &after, find(&before, from));
    }
}

#[test]
fn una_scheda_spostata_con_canvas_apply_cambia_solo_la_sua_x() {
    let vault = Vault::open();
    let name = "Lavagne/Città con BOM.canvas";
    let opened = open_as_shell(&vault, name, Kind::Canvas);
    let before = vault.on_disk(name);
    let ops = json!([{ "op": "move", "ids": ["t"], "dx": 40, "dy": 0 }]).to_string();
    vault
        .host
        .invoke_user_command(
            vault.name(),
            "canvas.apply",
            json!({ "doc": name, "ops": ops, "base": opened.revision.0 }),
            InvokeMode::Apply,
        )
        .expect("canvas.apply moves the card");
    close_as_shell(&vault, name, Kind::Canvas);
    let after = vault.on_disk(name);
    assert!(
        std::str::from_utf8(&after).unwrap().contains(r#""x":260"#),
        "the card moved by 40"
    );
    // La `x` della scheda `t` e nient'altro.
    let card = find(&before, r#"{"id":"t""#).start;
    let x = card + find(&before[card..], r#""x":220"#).start;
    changed_only_inside(name, &before, &after, x..x + r#""x":220"#.len());
}
