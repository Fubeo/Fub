//! Import ed export di markdown: il **primo cliente** dei trait della decisione 0006.
//!
//! È il caso banale di proposito. Un importer Notion o un export PDF hanno
//! difficoltà tutte loro (contenitori zip, mappatura degli allegati, un motore
//! di impaginazione) che direbbero poco sulla firma; il markdown non ne ha
//! nessuna, quindi ciò che resta visibile qui è **solo** il contratto: la
//! sorgente che arriva a byte, la prova a vuoto che non scrive, il conflitto
//! risolto con la convenzione dell'host, l'esito che esce a byte.
//!
//! Le due implementazioni stanno in questo crate — e non nel kernel — per la
//! stessa ragione per cui ci sta [`MarkdownProvider`](crate::MarkdownProvider):
//! sono l'unico posto del progetto a cui è concesso sapere che il markdown
//! esiste.

use fub_abi::format::ParseContext;
use fub_abi::traits::ReadApi;
use fub_abi::transfer::{
    ConflictPolicy, ExportArtifact, ExportProvider, ExportReport, ExportRequest, ExportTarget,
    ImportMode, ImportOutcome, ImportProvider, ImportReport, ImportRequest, ImportSource,
    ImportedDocument, TransferNote,
};
use fub_abi::{HostApi, PluginError};

/// Il media type del markdown, e i suoi sinonimi in circolazione.
const MEDIA_TYPES: &[&str] = &["text/markdown", "text/x-markdown", "text/plain"];

/// L'estensione con cui un documento importato entra nel vault. Non è
/// `source.extension()`: si importa `.markdown` e si scrive `.md`, perché
/// dentro il vault l'estensione canonica è una sola (la prima del
/// [`FormatDescriptor`](fub_abi::format::FormatDescriptor)).
const CANONICAL_EXT: &str = "md";

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

/// Fa entrare nel vault un documento markdown.
#[derive(Default)]
pub struct MarkdownImport;

impl MarkdownImport {
    pub fn new() -> Self {
        MarkdownImport
    }

    pub fn boxed() -> Box<dyn ImportProvider> {
        Box::new(MarkdownImport)
    }
}

impl ImportProvider for MarkdownImport {
    fn can_handle(&self, source: &ImportSource) -> bool {
        // Il nome comanda: `.md` è markdown anche se chi ha aperto il file ha
        // dichiarato `application/octet-stream` (i dialoghi di sistema lo fanno
        // di continuo). Il media type decide solo quando l'estensione non c'è o
        // non dice niente — un incolla dagli appunti non ha un nome di file.
        match source.extension().as_deref() {
            Some("md" | "markdown" | "mdown" | "mkd") => true,
            Some(_) => false,
            None => source
                .media_type
                .as_deref()
                .is_some_and(|m| MEDIA_TYPES.contains(&m.split(';').next().unwrap_or(m).trim())),
        }
    }

    fn import(
        &mut self,
        source: &ImportSource,
        request: &ImportRequest,
        host: &mut dyn HostApi,
    ) -> Result<ImportReport, PluginError> {
        // Byte non testuali e nome inservibile sono «non ho potuto cominciare»:
        // errore, non una riga di giornale su un import per il resto riuscito.
        let text = source.text()?;
        let stem = source.stem().ok_or_else(|| {
            PluginError::BadArgs(
                format!("`{}` non dà un nome di documento utilizzabile", source.name).into(),
            )
        })?;

        let mut report = ImportReport::new(request.mode);
        let wanted = request.destination(&format!("{stem}.{CANONICAL_EXT}"));

        // Il modello serve a due cose vere: validare (una sorgente che non parsa
        // non entra) e raccontare cosa sta entrando. Non serve a riscriverla —
        // il documento si scrive **com'era**, che è la sola forma di import
        // markdown fedele (`serialize` è generazione, non round-trip).
        let model = crate::parse::parse_markdown(text, &ParseContext::obsidian(wanted.as_str()))
            .map_err(|e| PluginError::BadArgs(e.to_string().into()))?;
        report.log.push(
            TransferNote::info(format!(
                "{} link, {} tag, {} heading",
                model.links.len(),
                model.tags.len(),
                model.outline.len()
            ))
            .about(source.name.clone()),
        );

        let taken = host.list_documents(None)?.items;
        let occupied = taken.contains(&wanted);
        let (doc, outcome) = match (occupied, request.on_conflict) {
            (false, _) => (wanted, ImportOutcome::Created),
            (true, ConflictPolicy::Skip) => (wanted, ImportOutcome::Skipped),
            (true, ConflictPolicy::Replace) => (wanted, ImportOutcome::Replaced),
            (true, ConflictPolicy::Rename) => {
                // La convenzione dei nomi la decide l'host: qui rifarla
                // significherebbe farla diversa dal cestino e da «crea nota».
                let free = host.free_name(&wanted);
                report.log.push(
                    TransferNote::warning(format!("`{wanted}` esisteva già: entra come `{free}`"))
                        .about(source.name.clone()),
                );
                (free, ImportOutcome::Created)
            }
        };

        let writes = matches!(outcome, ImportOutcome::Created | ImportOutcome::Replaced)
            && request.mode == ImportMode::Apply;
        let outcome = if writes {
            // Senza base: un importer non sta correggendo un testo che ha
            // letto, lo sta **dettando** — e una base inventata sarebbe una
            // guardia che dice sempre di sì (§18.1).
            match host.write_document(&doc, text, None) {
                Ok(_) => outcome,
                // Un rifiuto del recinto o un errore di scrittura riguardano
                // QUESTO documento: il rapporto lo dice e l'import resta valido.
                Err(e) => ImportOutcome::Failed(e.to_string()),
            }
        } else {
            outcome
        };

        report.documents.push(ImportedDocument {
            doc,
            outcome,
            entry: Some(source.name.clone()),
        });
        Ok(report)
    }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/// La destinazione «un file per nota»: la cartella markdown di 17.2.
pub const TARGET_FILES: &str = "markdown.files";
/// La destinazione «un documento solo»: la selezione concatenata.
pub const TARGET_SINGLE: &str = "markdown.single";

/// Fa uscire dal vault documenti markdown.
#[derive(Default)]
pub struct MarkdownExport;

impl MarkdownExport {
    pub fn new() -> Self {
        MarkdownExport
    }

    pub fn boxed() -> Box<dyn ExportProvider> {
        Box::new(MarkdownExport)
    }
}

impl ExportProvider for MarkdownExport {
    fn targets(&self) -> Vec<ExportTarget> {
        vec![
            ExportTarget {
                id: TARGET_FILES.to_string(),
                name: "Markdown (un file per nota)".to_string(),
                // Più artefatti: chi apre il dialogo chiede una cartella.
                extension: None,
            },
            ExportTarget {
                id: TARGET_SINGLE.to_string(),
                name: "Markdown (documento unico)".to_string(),
                extension: Some(CANONICAL_EXT.to_string()),
            },
        ]
    }

    fn export(
        &self,
        request: &ExportRequest,
        host: &dyn ReadApi,
    ) -> Result<ExportReport, PluginError> {
        if request.target != TARGET_FILES && request.target != TARGET_SINGLE {
            return Err(PluginError::BadArgs(
                format!(
                    "`{}` non è una destinazione di questo provider",
                    request.target
                )
                .into(),
            ));
        }
        // «Con o senza metadati» sono due voci letterali di 17.2, ed è l'unica
        // opzione che il markdown ha davvero: tutto il resto (tema, allegati,
        // impaginazione) è di destinazioni che il markdown non è.
        let frontmatter = request.flag("frontmatter", true);

        let docs = request.selection.resolve(host)?;
        let mut report = ExportReport::default();
        let mut single = String::new();

        for doc in docs {
            let source = match host.read_document(&doc) {
                Ok(source) => source,
                // Un documento sparito fra la selezione e la lettura non fa
                // fallire l'export di altri duecento.
                Err(e) => {
                    report
                        .log
                        .push(TransferNote::warning(e.to_string()).about(doc.to_string()));
                    continue;
                }
            };
            let body = if frontmatter {
                source
            } else {
                strip_frontmatter(&source, doc.as_str())
            };

            match request.target.as_str() {
                TARGET_FILES => report.artifacts.push(ExportArtifact {
                    // Il path dentro l'esito è il path dentro il vault: un
                    // export di una cartella si riapre com'era.
                    path: doc.as_str().to_string(),
                    media_type: MEDIA_TYPES[0].to_string(),
                    bytes: body.into_bytes(),
                }),
                _ => {
                    if !single.is_empty() {
                        single.push_str("\n\n---\n\n");
                    }
                    single.push_str(&format!("# {}\n\n", doc.page_name()));
                    single.push_str(body.trim_end());
                    single.push('\n');
                }
            }
        }

        if request.target == TARGET_SINGLE {
            report.artifacts.push(ExportArtifact {
                path: format!("export.{CANONICAL_EXT}"),
                media_type: MEDIA_TYPES[0].to_string(),
                bytes: single.into_bytes(),
            });
        }
        Ok(report)
    }
}

/// La sorgente senza il frontmatter, tagliata sullo **span del primo blocco**,
/// esteso all'indentazione che quello span lascia fuori.
///
/// È il modo dichiarato di modificare un documento in questo progetto — una
/// patch guidata dagli span del modello — e non una seconda lettura dei
/// delimitatori `---`, che sarebbe un secondo parser YAML in miniatura. Un
/// documento che non parsa o che è solo frontmatter esce vuoto: qui il
/// frontmatter *è* tutto il documento.
///
/// # Perché lo span del primo blocco non basta
///
/// Perché per un **code block indentato** comincia dopo i quattro spazi: lo span
/// dice dov'è il contenuto, e l'indentazione è sintassi. Tagliando lì l'export
/// produceva un documento in cui quel blocco non era più un code block — cioè
/// cambiava il significato dei byte che teneva, che è più di quanto «togli i
/// metadati» autorizzi a fare. Il taglio si estende quindi indietro fino
/// all'inizio della riga, **ma solo attraverso spazi e tabulazioni**: fermarsi al
/// primo carattere che non è indentazione è ciò che tiene il gesto una patch e
/// non una seconda lettura del file. Trovato dal round-trip sul corpus della
/// [0061](../../../docs/decisions/0061-un-giro-che-non-passa-dal-modello.md).
fn strip_frontmatter(source: &str, doc_id: &str) -> String {
    let Ok(model) = crate::parse::parse_markdown(source, &ParseContext::obsidian(doc_id)) else {
        return source.to_string();
    };
    if model.frontmatter.is_empty() {
        return source.to_string();
    }
    match model.body.first() {
        Some(first) => {
            let contenuto = first.span().start;
            let riga = source[..contenuto]
                .rfind(['\n', '\r'])
                .map(|i| i + 1)
                .unwrap_or(0);
            let taglio = if source[riga..contenuto]
                .chars()
                .all(|c| c == ' ' || c == '\t')
            {
                riga
            } else {
                contenuto
            };
            source[taglio..].to_string()
        }
        None => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn source(name: &str) -> ImportSource {
        ImportSource::text_source(name, "# Ciao\n")
    }

    #[test]
    fn the_name_decides_and_the_media_type_only_when_there_is_no_name() {
        let p = MarkdownImport::new();
        assert!(p.can_handle(&source("Nota.md")));
        assert!(p.can_handle(&source("Nota.MARKDOWN")));
        assert!(
            p.can_handle(&ImportSource {
                name: "Nota.md".into(),
                media_type: Some("application/octet-stream".into()),
                bytes: b"# x".to_vec(),
            }),
            "un dialogo di sistema dichiara octet-stream di continuo: \
             l'estensione resta più affidabile"
        );
        assert!(!p.can_handle(&source("vault.zip")));
        assert!(
            p.can_handle(&ImportSource {
                name: "appunti".into(),
                media_type: Some("text/markdown; charset=utf-8".into()),
                bytes: b"# x".to_vec(),
            }),
            "un incolla dagli appunti non ha estensione: decide il media type"
        );
        assert!(!p.can_handle(&ImportSource {
            name: "appunti".into(),
            media_type: None,
            bytes: b"# x".to_vec(),
        }));
    }

    #[test]
    fn the_frontmatter_leaves_by_span_and_takes_nothing_of_the_body_with_it() {
        let src = "---\ntitle: Ciao\n---\n\n# Titolo\n\nCorpo.\n";
        assert_eq!(strip_frontmatter(src, "n.md"), "# Titolo\n\nCorpo.\n");

        let senza = "# Titolo\n\nCorpo.\n";
        assert_eq!(
            strip_frontmatter(senza, "n.md"),
            senza,
            "senza frontmatter non si taglia niente"
        );

        assert_eq!(
            strip_frontmatter("---\ntitle: Solo\n---\n", "n.md"),
            "",
            "un documento che è solo frontmatter, senza, non è niente"
        );
    }
}
