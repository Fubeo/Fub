//! I comandi del versioning: ripristinare una versione e svuotare la
//! cronologia (`VersioningCommands`).

use super::*;

/// Il comando del registro che riporta una nota a una sua versione.
///
/// Era `restore_version`, un comando Tauri: la §16.6 lo aveva già classificato —
/// *fa accadere qualcosa e risponde con un messaggio*, quindi è un comando del
/// registro — e il pannello cronologia era il suo unico chiamante. Migrandolo
/// col pannello, la palette lo eredita gratis.
///
/// Il ripristino non ha bisogno dello store: scrive la nota, e la fotografia
/// la fa il gancio. Lo svuotamento invece sì — togliere la storia da sotto
/// l'esemplare in memoria lo lascerebbe a nominare contenuti spariti, e il
/// salvataggio dopo riscriverebbe l'indice vecchio — quindi
/// [`VERSION_CLEAR`] c'è soltanto nei comandi costruiti con
/// [`VersioningCommands::over`], cioè da chi ha aperto lo store.
#[derive(Clone, Default)]
pub struct VersioningCommands {
    store: Option<VersionStore>,
}

impl VersioningCommands {
    /// I comandi con lo store di chi monta: anche [`VERSION_CLEAR`].
    pub fn over(store: VersionStore) -> Self {
        VersioningCommands { store: Some(store) }
    }

    fn clear(
        &self,
        mode: InvokeMode,
        host: &mut dyn HostApi,
    ) -> Result<CommandOutcome, PluginError> {
        let Some(store) = &self.store else {
            return Err(PluginError::UnknownCommand(
                VERSION_CLEAR.to_string().into(),
            ));
        };
        let counted = |key: &str, (notes, versions): (usize, usize)| {
            Text::message(
                key,
                vec![
                    Arg::int(VERSIONS, versions as i64),
                    Arg::int(NOTES, notes as i64),
                ],
            )
        };
        if mode.is_dry_run() {
            let plan = CommandPlan::of_edits(counted(PLAN_CLEAR, store.census()), Vec::new());
            return Ok(CommandOutcome::done().with_effect(CommandEffect::Plan(plan)));
        }
        let cleared = store.clear(host)?;
        Ok(CommandOutcome::notify(counted(DONE_CLEAR, cleared)))
    }
}

impl CommandProvider for VersioningCommands {
    fn commands(&self) -> Vec<CommandSpec> {
        let mut commands = vec![CommandSpec::new(VERSION_RESTORE, Text::key(RESTORE_TITLE))
            .describing(Text::key(RESTORE_DESC))
            .with_param(
                ParamSpec::new(DOC, Text::key(RESTORE_DOC_TITLE), ParamKind::Document)
                    .describing(Text::key(RESTORE_DOC_DESC)),
            )
            .with_param(
                ParamSpec::new(TS, Text::key(RESTORE_TS_TITLE), ParamKind::Number)
                    .describing(Text::key(RESTORE_TS_DESC))
                    .required(),
            )
            // Reversibile, e non per ottimismo: il ripristino è a sua volta una
            // scrittura, quindi una versione (D8), quindi c'è una versione a cui
            // tornare. L'`Undo` qui sotto la nomina.
            .with_scope(CommandScope::writing(CommandReach::Document))];
        if self.store.is_some() {
            commands.push(
                CommandSpec::new(VERSION_CLEAR, Text::key(CLEAR_TITLE))
                    .describing(Text::key(CLEAR_DESC))
                    // Scrive lo spazio dati, non le note; ma è la storia di
                    // tutto il vault, e non si torna indietro: la conferma
                    // rafforzata è la sua.
                    .with_scope(CommandScope::writing(CommandReach::Vault).irreversible()),
            );
        }
        commands
    }

    fn invoke(
        &self,
        command: &str,
        args: serde_json::Value,
        mode: InvokeMode,
        host: &mut dyn HostApi,
    ) -> Result<CommandOutcome, PluginError> {
        if command == VERSION_CLEAR {
            return self.clear(mode, host);
        }
        if command != VERSION_RESTORE {
            return Err(PluginError::UnknownCommand(command.to_string().into()));
        }
        let args = Args::new(&args);
        let doc = args
            .document(DOC)
            .or_else(|| host.active_context().and_then(|c| c.doc))
            .ok_or_else(|| PluginError::BadArgs(Text::key(AND_NO_NOTES_GIVEN)))?;
        let ts = args
            .number(TS)
            .ok_or_else(|| PluginError::BadArgs(Text::key(E_NO_TS_GIVEN)))? as u64;

        let when_for = |key: &str, when: u64| {
            Text::message(
                key,
                vec![Arg::text(DOC, doc.as_str()), Arg::timestamp(WHEN, when)],
            )
        };

        if mode.is_dry_run() {
            let plan =
                CommandPlan::of_edits(when_for(PLAN_RESTORE, ts), Vec::new()).with_doc(doc.clone());
            return Ok(CommandOutcome::done().with_effect(CommandEffect::Plan(plan)));
        }

        // L'inverso deve nominare la preimmagine catturata dal gancio, anche
        // quando un writer esterno ha preceduto il comando senza un evento.
        // `document_revision` è la base del CAS reale di `write_document_bytes`:
        // catturarla prima di leggere lo snapshot fa fallire il ripristino se
        // il documento cambia durante quella lettura, senza sovrascrivere la
        // modifica concorrente.
        {
            let docs = read_index(host)?;
            let entry = docs.get(doc.as_str()).ok_or_else(|| {
                PluginError::NotFound(Text::message(
                    NO_VERSIONS,
                    vec![Arg::text(DOC, doc.as_str())],
                ))
            })?;
            let base = host.document_revision(&doc)?;
            // Il gancio non fotografa un file oltre il tetto, e il ripristino
            // lo sostituirebbe senza lasciarne traccia. Si chiede dopo la base:
            // se il file cresce dopo, il CAS rifiuta la scrittura.
            if over_the_cap(&doc, None, host)? {
                return Err(PluginError::Unserved(Text::message(
                    RESTORE_TOO_LARGE,
                    vec![Arg::text(DOC, doc.as_str()), cap_in_mib()],
                )));
            }
            let source = version_source_doc(entry, &doc, ts, host)?;
            host.write_document_bytes(&doc, &source, Some(base))?;
        }
        // Gli eventi restano accodati fino all'uscita del comando: lo snapshot
        // del risultato non è ancora stato creato, l'ultimo è la preimmagine.
        // Un errore di lettura qui non può trasformare una scrittura riuscita
        // in un fallimento: segnala il problema e non promette l'annullamento.
        let before = match read_index(host) {
            Ok(history) => history
                .get(doc.as_str())
                .and_then(|entry| entry.versions.last())
                .map(|version| version.ts),
            Err(error) => {
                host.emit(Event::Trouble {
                    severity: Severity::Warning,
                    subject: Some(doc.clone()),
                    error,
                    gate: None,
                });
                None
            }
        };

        let result = CommandOutcome::notify(when_for(DONE_RESTORE, ts));
        Ok(match before {
            Some(before) => result.undoable(fub_abi::command::Undo::by_command(
                when_for(UNDO_RESTORE, before),
                VERSION_RESTORE,
                serde_json::json!({ DOC: doc.as_str(), TS: before }),
            )),
            // Nessuna preimmagine leggibile: il ripristino è comunque riuscito.
            None => result,
        })
    }
}
