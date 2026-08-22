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

use fub_abi::edit::WriteBase;
use fub_abi::format::ParseContext;
use fub_abi::model::{custom_kind, Block};
use fub_abi::traits::ReadApi;
use fub_abi::transfer::{
    ArtifactSink, ConflictPolicy, ExportProvider, ExportReport, ExportRequest, ExportTarget,
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
        let text = source.text(host)?;
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
        let model = crate::parse::parse_markdown(&text, &ParseContext::obsidian(wanted.as_str()))
            .map_err(|and| PluginError::BadArgs(and.to_string().into()))?;
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
            // **Le due scritture non sono la stessa scrittura**, e l'esito lo
            // dice già: `Replaced` copre un documento che c'era, e l'ha chiesto
            // chi ha scelto la politica; `Created` va su un path che questo
            // codice ha scelto **perché era libero**.
            //
            // Fino a qui erano tutte e due `WriteBase::Dictated`, cioè «se ne
            // copre uno è voluto», e per il primo caso è giusto: un importer non
            // sta correggendo un testo che ha letto, lo sta dettando, e una base
            // inventata sarebbe una guardia che dice sempre di sì (§18.1).
            //
            // Per il secondo era sbagliato, ed è il difetto 0039. `free_name`
            // **non prenota** — lo dichiara il suo doc-comment, lo dichiara il
            // contratto, e la 0027 discarica la corsa dicendo che «a quel punto è
            // la scrittura a dirlo». Qui la scrittura non poteva dirlo: `Dictated`
            // copre in silenzio. Fra la domanda del nome libero e la scrittura ci
            // stanno un `parse` e — con `ConflictPolicy::Rename` — tutto il tempo
            // che l'import impiega sui documenti precedenti; se in quella
            // finestra qualcuno crea `Alpha 1.md`, l'import lo **cancellava**.
            // Cioè la discarica valeva per ogni chiamante di `free_name` tranne
            // il più esposto.
            //
            // La composizione giusta la scrive già il contratto di
            // `create_document`: *«chi vuole un nome comunque libero lo chiede a
            // `free_name` e passa quello»*. Qui la prima metà c'era e la seconda
            // no.
            let write_result = match &outcome {
                ImportOutcome::Replaced => host
                    .write_document(&doc, &text, WriteBase::Dictated)
                    .map(|_| ()),
                _ => host.create_document(&doc, &text),
            };
            match write_result {
                Ok(()) => outcome,
                // Un rifiuto del recinto o un errore di scrittura riguardano
                // QUESTO documento: il rapporto lo dice e l'import resta valido.
                // E adesso c'è un rifiuto in più che prima non esisteva: il nome
                // libero non lo era più. È un import fallito su una riga, non una
                // nota dell'utente sparita.
                Err(and) => ImportOutcome::Failed(and.to_string()),
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
        out: &mut dyn ArtifactSink,
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
                Err(and) => {
                    report
                        .log
                        .push(TransferNote::warning(and.to_string()).about(doc.to_string()));
                    continue;
                }
            };
            // Il documento diviso nelle due parti che le due destinazioni usano
            // in modi diversi: una le concatena, l'altra le copia.
            let (head, body) = match frontmatter_end(&source, doc.as_str()) {
                Some(the) => (&source[..the], &source[the..]),
                None => ("", source.as_str()),
            };

            match request.target.as_str() {
                // Il path dentro l'esito è il path dentro il vault: un export
                // di una cartella si riapre com'era.
                //
                // Passa dal sink **sempre**, anche quando l'esito starebbe in
                // memoria, e non è cerimonia: con un `MemorySink` la ricevuta
                // torna con i byte dentro e il rapporto è quello di prima, con
                // un `DirectorySink` la nota è già sul disco e non è mai stata
                // due volte in RAM. Una strada sola, e a scegliere è chi ha
                // aperto il dialogo — che è l'unico a sapere dove va a finire.
                TARGET_FILES => {
                    // Un file per nota: il frontmatter resta dov'era, cioè in
                    // testa al file, che è l'unico posto in cui è un frontmatter.
                    let body = if frontmatter { source.as_str() } else { body };
                    let h = out.open_artifact(doc.as_str(), MEDIA_TYPES[0])?;
                    out.write_artifact(h, body.as_bytes())?;
                    report.artifacts.push(out.close_artifact(h)?);
                }
                _ => {
                    if !single.is_empty() {
                        single.push_str("\n\n---\n\n");
                    }
                    single.push_str(&format!("# {}\n\n", doc.page_name()));
                    // **In una concatenazione un frontmatter non è un
                    // frontmatter**, ed è tutto il difetto: lo è solo in testa al
                    // file, e in testa al file ce ne sta uno. Copiato dov'era, il
                    // primo `---` diventava un divisore orizzontale e il secondo
                    // faceva del `titolo: X` un'intestazione — di ogni documento,
                    // primo compreso, perché il `# Nome` qui sopra lo precede
                    // comunque.
                    //
                    // Recintarlo è la sola forma che tiene le tre cose insieme:
                    // i byte ci sono tutti, si vede che sono metadati, e nessun
                    // pezzo cambia significato per il posto in cui è finito.
                    // Toglierli renderebbe `frontmatter = true` e
                    // `frontmatter = false` la stessa cosa per questa
                    // destinazione, cioè un'opzione che mente.
                    if frontmatter && !head.trim().is_empty() {
                        let fence = "`".repeat(3.max(crate::util::longest_run(head, '`') + 1));
                        single.push_str(&fence);
                        single.push_str("yaml\n");
                        single.push_str(head.trim_end());
                        single.push('\n');
                        single.push_str(&fence);
                        single.push_str("\n\n");
                    }
                    single.push_str(body.trim_end());
                    single.push('\n');
                }
            }
        }

        if request.target == TARGET_SINGLE {
            // Qui il buffer c'è comunque — un documento unico è una
            // concatenazione, e concatenare vuol dire tenere — quindi il sink
            // non fa risparmiare memoria: fa arrivare i byte dove vanno senza
            // che chi chiama debba riconoscere quale delle due destinazioni ha
            // chiesto. Il risparmio, per questa, sarebbe versare mentre si
            // concatena, e vale una voce sua: qui cambierebbe la forma del
            // giornale, perché un documento saltato si scopre dopo.
            let h = out.open_artifact(&format!("export.{CANONICAL_EXT}"), MEDIA_TYPES[0])?;
            out.write_artifact(h, single.as_bytes())?;
            report.artifacts.push(out.close_artifact(h)?);
        }
        Ok(report)
    }
}

/// L'indice a cui il **frontmatter finisce e il corpo comincia**, tagliato sullo
/// **span del primo blocco** ed esteso all'indentazione che quello span lascia
/// fuori. `None` se non c'è niente da tagliare.
///
/// È il modo dichiarato di modificare un documento in questo progetto — una
/// patch guidata dagli span del modello — e non una seconda lettura dei
/// delimitatori `---`, che sarebbe un secondo parser YAML in miniatura. Un
/// documento che è solo frontmatter ha il corpo vuoto: lì il frontmatter *è*
/// tutto il documento.
///
/// Risponde con un **indice** e non con la coda perché le due destinazioni ne
/// vogliono due metà diverse: un file per nota tiene o butta la testa dov'era, un
/// documento unico la deve spostare — e spostarla è ciò che la smette di essere
/// un frontmatter.
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
fn frontmatter_end(source: &str, doc_id: &str) -> Option<usize> {
    let Ok(model) = crate::parse::parse_markdown(source, &ParseContext::obsidian(doc_id)) else {
        return None;
    };
    let unparsed_frontmatter = !model.frontmatter_present
        && matches!(
            model.body.first(),
            Some(Block::Custom { custom_kind, .. })
                if custom_kind == custom_kind::FRONTMATTER_UNPARSED
        );
    if !model.frontmatter_present && !unparsed_frontmatter {
        return None;
    }
    let first_body = if unparsed_frontmatter {
        model.body.get(1)
    } else {
        model.body.first()
    };
    match first_body {
        Some(first) => {
            let content = first.span().start;
            let row = source[..content]
                .rfind(['\n', '\r'])
                .map(|the| the + 1)
                .unwrap_or(0);
            Some(
                if source[row..content].chars().all(|c| c == ' ' || c == '\t') {
                    row
                } else {
                    content
                },
            )
        }
        // Il frontmatter *è* tutto il documento: la testa è tutto, il corpo è
        // niente.
        None => Some(source.len()),
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
                content: fub_abi::transfer::SourceContent::Bytes(b"# x".to_vec()),
            }),
            "un dialogo di sistema dichiara octet-stream di continuo: \
             l'estensione resta più affidabile"
        );
        assert!(!p.can_handle(&source("vault.zip")));
        assert!(
            p.can_handle(&ImportSource {
                name: "appunti".into(),
                media_type: Some("text/markdown; charset=utf-8".into()),
                content: fub_abi::transfer::SourceContent::Bytes(b"# x".to_vec()),
            }),
            "un incolla dagli appunti non ha estensione: decide il media type"
        );
        assert!(!p.can_handle(&ImportSource {
            name: "appunti".into(),
            media_type: None,
            content: fub_abi::transfer::SourceContent::Bytes(b"# x".to_vec()),
        }));
    }

    /// Le due metà del taglio, guardate insieme: **la testa e il corpo, e la
    /// loro somma è il sorgente.**
    ///
    /// La seconda riga di ogni coppia è quella che conta da quando il taglio è
    /// un indice: un `strip` che tornasse una coda giusta ma partendo dal punto
    /// sbagliato avrebbe una testa sbagliata, e nessuno la guardava.
    #[test]
    fn the_frontmatter_leaves_by_span_and_takes_nothing_of_the_body_with_it() {
        fn split(src: &str) -> (&str, &str) {
            match frontmatter_end(src, "n.md") {
                Some(the) => (&src[..the], &src[the..]),
                None => ("", src),
            }
        }

        let src = "---\ntitle: Ciao\n---\n\n# Titolo\n\nCorpo.\n";
        assert_eq!(
            split(src),
            ("---\ntitle: Ciao\n---\n\n", "# Titolo\n\nCorpo.\n")
        );

        let without = "# Titolo\n\nCorpo.\n";
        assert_eq!(
            split(without),
            ("", without),
            "senza frontmatter non si taglia niente"
        );

        let only = "---\ntitle: Solo\n---\n";
        assert_eq!(
            split(only),
            (only, ""),
            "un documento che è solo frontmatter, senza, non è niente"
        );

        let invalid = "---\ntitle: [\n---\n\n# Titolo\n";
        assert_eq!(
            split(invalid),
            ("---\ntitle: [\n---\n\n", "# Titolo\n"),
            "anche il frontmatter non proiettato si separa dal corpo"
        );

        let invalid_only = "---\ntitle: [\n---\n";
        assert_eq!(split(invalid_only), (invalid_only, ""));
    }
}
