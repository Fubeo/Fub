//! Il tipo della nota (E5): cambiarlo, e dire nel pannello quando il tipo non
//! va. Com'è fatto un tipo e a chi porta un nome lo dice `note_types`, il
//! modulo condiviso coi modelli.

use super::*;
use crate::note_types;

/// Il tipo: un link (`[[Tipi/Libro]]`), un percorso o un nome.
pub(super) const TYPE: &str = "type";
/// La revisione della nota che chi chiede ha letto.
pub(super) const EXPECTED_REVISION: &str = "expected_revision";
/// La chiave del nodo che dice che cosa non va nel tipo della nota.
const TYPE_STATE: &str = "note-type";
/// La chiave del nodo che dice che cosa non va nella pagina di un tipo.
const TYPE_PAGE: &str = "type-page";

/// Cambia il tipo della nota: `tipo` diventa il link al tipo nuovo, e le
/// proprietà del tipo che la nota non ha si aggiungono in fondo al
/// frontmatter, vuote. Non si toglie niente: né le proprietà del tipo di
/// prima né i valori già scritti. Una modifica sola, col suo annulla.
///
/// Un tipo che manca, che è di più o che non si legge non scrive niente; un
/// frontmatter che non si legge nemmeno (lo riscriveremmo alla cieca).
pub(super) fn set_note_type(
    args: Args<'_>,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let doc = commands::doc_from(args, host)?;
    let found = note_types::find_type(host, args.text(TYPE).unwrap_or_default())?;
    // La revisione prima di leggere: una modifica arrivata dopo fa fallire la
    // richiesta invece di scrivere su byte vecchi.
    let revision = host.document_revision(&doc)?;
    if args
        .text(EXPECTED_REVISION)
        .is_some_and(|expected| revision.0 != expected)
    {
        return Err(PluginError::Conflict(Text::message(
            E_NOTE_CHANGED,
            vec![Arg::text(DOC, doc.as_str())],
        )));
    }
    let source = host.read_document(&doc)?;
    let model = host.read_model(&doc)?;
    if let Some(Block::Custom {
        custom_kind, attrs, ..
    }) = model.body.first()
    {
        if custom_kind == fub_abi::model::custom_kind::FRONTMATTER_UNPARSED {
            return Err(yaml_error(
                attrs
                    .get("error")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default(),
            ));
        }
    }
    let registry = property_types(host);
    let link = serde_json::Value::String(found.reference.wikilink());
    let same_type = model.frontmatter.get(note_types::TYPE_KEY) == Some(&link);
    let missing: Vec<(String, serde_json::Value)> = found
        .properties
        .iter()
        .filter(|p| p.key != note_types::TYPE_KEY && model.frontmatter.get(&p.key).is_none())
        .map(|p| (p.key.clone(), p.empty_value(&registry)))
        .collect();
    let named = || {
        vec![
            Arg::text(TYPE, found.reference.name.as_str()),
            Arg::text(DOC, doc.as_str()),
            Arg::int(A_COUNT, i64::try_from(missing.len()).unwrap_or(i64::MAX)),
        ]
    };
    if same_type && missing.is_empty() {
        return Ok(CommandOutcome::notify(Text::message(P_TYPE_SAME, named())));
    }
    let edits = type_edits(&source, &model, &link, same_type, &missing)?;
    let request = EditRequest::new(revision, edits);
    let summary = Text::message(P_NOTE_TYPE, named());
    if mode.is_dry_run() {
        return Ok(
            CommandOutcome::done().with_effect(CommandEffect::Plan(CommandPlan::of_edits(
                summary,
                vec![PlannedEdit::new(doc.clone(), request)],
            ))),
        );
    }
    let report = host.apply_edit(&doc, request)?;
    Ok(CommandOutcome::notify(summary)
        .undoable(Undo::of_edits(
            Text::message(U_NOTE_TYPE, named()),
            vec![PlannedEdit::new(doc.clone(), report.inverse())],
        ))
        .with_effect(CommandEffect::Done))
}

/// Gli edit del cambio di tipo, lessicali come quelli di `note.property.set`:
/// `tipo` si riscrive al suo posto se c'è, le righe nuove vanno prima della
/// chiusura del frontmatter; senza frontmatter ne nasce uno in testa. Il
/// resto del YAML e il corpo restano byte per byte.
fn type_edits(
    source: &str,
    model: &DocumentModel,
    link: &serde_json::Value,
    same_type: bool,
    missing: &[(String, serde_json::Value)],
) -> Result<Vec<TextEdit>, PluginError> {
    let has_type = model.frontmatter.get(note_types::TYPE_KEY).is_some();
    let mut lines: Vec<String> = Vec::new();
    if !same_type && !has_type {
        lines.push(note_types::frontmatter_line(note_types::TYPE_KEY, link));
    }
    lines.extend(
        missing
            .iter()
            .map(|(key, value)| note_types::frontmatter_line(key, value)),
    );
    let start = source_start(source);
    if !model.frontmatter_present {
        // Il blocco nuovo va a capo come il resto della nota.
        let eol = if source.contains("\r\n") {
            "\r\n"
        } else {
            "\n"
        };
        let mut block = format!("---{eol}{}{eol}---{eol}", lines.join(eol));
        if start < source.len() {
            block.push_str(eol);
        }
        return Ok(vec![TextEdit::insert(start, block)]);
    }
    let mut edits = Vec::new();
    if !same_type && has_type {
        edits.push(edit_property_frontmatter(
            source,
            model,
            note_types::TYPE_KEY,
            Some(link),
        )?);
    }
    if !lines.is_empty() {
        let (inner_start, closing) = frontmatter_bounds(source, start)
            .ok_or_else(|| yaml_error("delimitatori frontmatter non validi"))?;
        let eol = if source[inner_start..closing].contains("\r\n") {
            "\r\n"
        } else {
            "\n"
        };
        let prefix = if closing > inner_start && !source[..closing].ends_with(['\n', '\r']) {
            eol
        } else {
            ""
        };
        let text = lines
            .iter()
            .map(|line| format!("{line}{eol}"))
            .collect::<String>();
        edits.push(TextEdit::insert(closing, format!("{prefix}{text}")));
    }
    Ok(edits)
}

/// Che cosa il pannello dice del tipo della nota aperta: il tipo che manca,
/// che è di più o che non si legge (la nota resta com'è); e, se la nota
/// aperta è essa stessa un tipo, ciò che non si legge o le proprietà per cui
/// vale il registro del vault.
pub(super) fn type_notices(
    host: &dyn ReadApi,
    doc: &DocId,
    model: &DocumentModel,
) -> Result<Vec<UiNode>, PluginError> {
    let mut out = Vec::new();
    // Un tipo che va non ha niente da dire qui: `tipo` è già una riga.
    if let Some(text) = note_types::state_text(&note_types::state_of(host, model)?) {
        out.push(UiNode::failed(text, None).with_key(TYPE_STATE));
    }
    // Il frontmatter del tipo si legge solo se la nota sta nella cartella dei
    // tipi: le altre non pagano la lettura del sorgente.
    if let Some(folder) = note_types::types_folder(host) {
        if doc.as_str().starts_with(&format!("{folder}/")) {
            let source = host.read_document(doc)?;
            match note_types::as_type(host, doc, model, &source) {
                Some(Ok(found)) => {
                    let registry = property_types(host);
                    out.extend(
                        note_types::conflict_texts(&found, &registry)
                            .into_iter()
                            .map(UiNode::text),
                    );
                }
                Some(Err(why)) => out.push(
                    UiNode::failed(note_types::unreadable_text(doc.page_name(), &why), None)
                        .with_key(TYPE_PAGE),
                ),
                None => {}
            }
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::note_types::{vault, LIBRO};
    use fub_abi::command::UndoStep;
    use fub_abi::traits::{CommandProvider, VaultRead, VaultWrite, ViewInstance, ViewProvider};
    use fub_sdk::testing::MemoryHost;

    fn set_type(
        host: &mut MemoryHost,
        doc: &str,
        wanted: &str,
        mode: InvokeMode,
    ) -> Result<CommandOutcome, PluginError> {
        PropertiesCommands.invoke(
            NOTES_TYPE_SET,
            serde_json::json!({ "doc": doc, "type": wanted }),
            mode,
            host,
        )
    }

    fn read(host: &MemoryHost, doc: &str) -> String {
        host.read_document(&DocId::new(doc)).unwrap()
    }

    /// Esegue l'annulla di un esito: le modifiche inverse, una per documento.
    fn undo(host: &mut MemoryHost, outcome: CommandOutcome) {
        let steps = outcome.undo.expect("annullabile").steps;
        assert_eq!(steps.len(), 1, "un annulla solo");
        for step in steps {
            let UndoStep::Edit(planned) = step else {
                panic!("un annulla di testo")
            };
            host.apply_edit(&planned.doc, planned.edit).unwrap();
        }
    }

    fn key(err: &PluginError) -> String {
        match err {
            PluginError::BadArgs(Text::Message(m)) | PluginError::Conflict(Text::Message(m)) => {
                m.key.clone()
            }
            other => format!("{other:?}"),
        }
    }

    #[test]
    fn changing_type_adds_what_is_missing_removes_nothing_and_undoes_in_one_step() {
        let before =
            "---\ntipo: \"[[Tipi/Film]]\"\nautore: Herbert\nregista: Villeneuve\n---\nIl corpo.\n";
        let mut host = vault(&[
            ("Tipi/Libro.md", LIBRO),
            ("Tipi/Film.md", "---\nproperties: [regista]\n---\n"),
            ("Dune.md", before),
        ]);
        let outcome = set_type(&mut host, "Dune.md", "Libro", InvokeMode::Apply).unwrap();
        assert_eq!(
            read(&host, "Dune.md"),
            "---\ntipo: \"[[Tipi/Libro]]\"\nautore: Herbert\nregista: Villeneuve\nletto: false\ngeneri: []\n---\nIl corpo.\n"
        );
        undo(&mut host, outcome);
        assert_eq!(read(&host, "Dune.md"), before);
    }

    #[test]
    fn a_note_without_frontmatter_gets_one_and_the_body_stays_byte_for_byte() {
        let before = "# Dune\r\n\r\nIl corpo.\r\n";
        let mut host = vault(&[("Tipi/Libro.md", LIBRO), ("Dune.md", before)]);
        let outcome = set_type(&mut host, "Dune.md", "[[Tipi/Libro]]", InvokeMode::Apply).unwrap();
        assert_eq!(
            read(&host, "Dune.md"),
            format!("---\r\ntipo: \"[[Tipi/Libro]]\"\r\nautore:\r\nletto: false\r\ngeneri: []\r\n---\r\n\r\n{before}")
        );
        undo(&mut host, outcome);
        assert_eq!(read(&host, "Dune.md"), before);
    }

    #[test]
    fn a_frontmatter_without_tipo_keeps_its_line_endings() {
        let before = "---\r\nautore: Herbert\r\n---\r\ntesto\r\n";
        let mut host = vault(&[("Tipi/Libro.md", LIBRO), ("Dune.md", before)]);
        set_type(&mut host, "Dune.md", "Libro", InvokeMode::Apply).unwrap();
        assert_eq!(
            read(&host, "Dune.md"),
            "---\r\nautore: Herbert\r\ntipo: \"[[Tipi/Libro]]\"\r\nletto: false\r\ngeneri: []\r\n---\r\ntesto\r\n"
        );
    }

    #[test]
    fn the_same_type_with_everything_there_writes_nothing() {
        let full = "---\ntipo: \"[[Tipi/Libro]]\"\nautore:\nletto: true\ngeneri: [a]\n---\n";
        let mut host = vault(&[("Tipi/Libro.md", LIBRO), ("Dune.md", full)]);
        let outcome = set_type(&mut host, "Dune.md", "Libro", InvokeMode::Apply).unwrap();
        assert!(outcome.undo.is_none());
        assert_eq!(read(&host, "Dune.md"), full);
    }

    #[test]
    fn the_dry_run_plans_one_edit_and_writes_nothing() {
        let before = "---\nautore: Herbert\n---\n";
        let mut host = vault(&[("Tipi/Libro.md", LIBRO), ("Dune.md", before)]);
        let outcome = set_type(&mut host, "Dune.md", "Libro", InvokeMode::DryRun).unwrap();
        let CommandEffect::Plan(plan) = outcome.effect else {
            panic!("un piano")
        };
        assert_eq!(plan.edits.len(), 1);
        assert_eq!(read(&host, "Dune.md"), before);
    }

    #[test]
    fn a_broken_type_or_an_unreadable_note_writes_nothing() {
        let note = "---\nautore: Herbert\n---\n";
        let broken = "---\nautore: [Herbert\n---\n";
        let mut host = vault(&[
            ("Tipi/Libro.md", LIBRO),
            ("Tipi/Rotto.md", "---\nfeatured: {a: 1}\n---\n"),
            ("Dune.md", note),
            ("Rotta.md", broken),
        ]);
        for (doc, wanted, why) in [
            ("Dune.md", "Rotto", "note_type.e_keys"),
            ("Dune.md", "Quadro", "note_type.e_missing"),
            ("Rotta.md", "Libro", E_YAML),
        ] {
            let err = set_type(&mut host, doc, wanted, InvokeMode::Apply).unwrap_err();
            assert_eq!(key(&err), why, "{doc} {wanted}");
        }
        assert_eq!(read(&host, "Dune.md"), note);
        assert_eq!(read(&host, "Rotta.md"), broken);
    }

    #[test]
    fn a_note_changed_since_it_was_read_is_not_written() {
        let mut host = vault(&[("Tipi/Libro.md", LIBRO), ("Dune.md", "testo\n")]);
        let err = PropertiesCommands
            .invoke(
                NOTES_TYPE_SET,
                serde_json::json!({ "doc": "Dune.md", "type": "Libro", "expected_revision": "vecchia" }),
                InvokeMode::Apply,
                &mut host,
            )
            .unwrap_err();
        assert_eq!(key(&err), E_NOTE_CHANGED);
        assert_eq!(read(&host, "Dune.md"), "testo\n");
    }

    fn notices(host: &MemoryHost, doc: &str) -> Vec<String> {
        let model = host.read_model(&DocId::new(doc)).unwrap();
        type_notices(host, &DocId::new(doc), &model)
            .unwrap()
            .into_iter()
            .map(|node| serde_json::to_string(&node).unwrap())
            .collect()
    }

    #[test]
    fn the_panel_says_when_the_type_is_missing_and_the_note_stays() {
        let source = "---\ntipo: \"[[Tipi/Quadro]]\"\nautore: x\n---\n";
        let host = vault(&[("Tipi/Libro.md", LIBRO), ("Dune.md", source)]);
        let said = notices(&host, "Dune.md");
        assert_eq!(said.len(), 1);
        assert!(said[0].contains("note_type.s_missing"), "{}", said[0]);
        assert!(said[0].contains(TYPE_STATE), "{}", said[0]);
        assert_eq!(read(&host, "Dune.md"), source);
        // Un tipo che va non dice niente; una nota senza tipo nemmeno.
        let host = vault(&[
            ("Tipi/Libro.md", LIBRO),
            ("Dune.md", "---\ntipo: Libro\n---\n"),
            ("Libera.md", "testo\n"),
        ]);
        assert!(notices(&host, "Dune.md").is_empty());
        assert!(notices(&host, "Libera.md").is_empty());
    }

    #[test]
    fn the_page_of_a_type_says_what_does_not_read_and_where_the_registry_wins() {
        let registry = PropertyTypes {
            types: [("autore".to_string(), fub_abi::model::PropertyType::Number)].into(),
            ..PropertyTypes::default()
        };
        let host = vault(&[
            ("Tipi/Libro.md", LIBRO),
            ("Tipi/Rotto.md", "---\nproperties: [a\n---\n"),
        ])
        .with_value(
            fub_abi::settings::SettingSpec::new(
                TYPES_KEY,
                "tipi",
                fub_abi::settings::SettingKind::Text {
                    default: String::new(),
                },
            ),
            SettingValue::Text(serde_json::to_string(&registry).unwrap()),
        );
        let libro = notices(&host, "Tipi/Libro.md");
        assert_eq!(libro.len(), 1, "{libro:?}");
        assert!(
            libro[0].contains("note_type.s_conflict.number"),
            "{}",
            libro[0]
        );
        let rotto = notices(&host, "Tipi/Rotto.md");
        assert_eq!(rotto.len(), 1, "{rotto:?}");
        assert!(rotto[0].contains("note_type.e_yaml"), "{}", rotto[0]);
        assert!(rotto[0].contains(TYPE_PAGE), "{}", rotto[0]);
    }

    #[test]
    fn the_panel_draws_the_notice_above_the_properties() {
        let host = vault(&[("Dune.md", "---\ntipo: Quadro\nautore: x\n---\n")]);
        host.set_active(Some("Dune.md"));
        let tree = PropertiesView
            .render_view(
                &ViewInstance::new(PROPERTIES_VIEW, "main", serde_json::json!({})),
                &host,
            )
            .unwrap();
        let drawn = serde_json::to_string(&tree).unwrap();
        let notice = drawn.find("note_type.s_missing").expect("l'avviso c'è");
        let row = drawn.find("autore").expect("la proprietà c'è");
        assert!(notice < row);
    }
}
