from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


def rust_block_end(text: str, start: int) -> int:
    brace = text.find("{", start)
    if brace < 0:
        raise SystemExit("opening brace not found")
    depth = 0
    i = brace
    state = "code"
    block_depth = 0
    while i < len(text):
        c = text[i]
        n = text[i + 1] if i + 1 < len(text) else ""
        if state == "code":
            if c == "/" and n == "/":
                state = "line"; i += 2; continue
            if c == "/" and n == "*":
                state = "block"; block_depth = 1; i += 2; continue
            if c == '"':
                state = "string"; i += 1; continue
            if c == "{": depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0: return i + 1
            i += 1; continue
        if state == "line":
            if c == "\n": state = "code"
            i += 1; continue
        if state == "block":
            if c == "/" and n == "*": block_depth += 1; i += 2; continue
            if c == "*" and n == "/":
                block_depth -= 1; i += 2
                if block_depth == 0: state = "code"
                continue
            i += 1; continue
        if state == "string":
            if c == "\\": i += 2; continue
            if c == '"': state = "code"
            i += 1; continue
    raise SystemExit("unterminated Rust block")


def replace_function(text: str, marker: str, replacement: str, label: str) -> str:
    count = text.count(marker)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one marker, found {count}")
    start = text.index(marker)
    end = rust_block_end(text, start)
    return text[:start] + replacement + text[end:]


def insert_after_impl(text: str, marker: str, insertion: str, label: str) -> str:
    count = text.count(marker)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one marker, found {count}")
    start = text.index(marker)
    end = rust_block_end(text, start)
    return text[:end] + insertion + text[end:]


# Format registry: cache the descriptor at registration time and share the
# provider itself. Preparing a parse must be pure metadata lookup, not a call
# into provider code while Custody<Workspace> is held.
path = Path("crates/fub-kernel/src/registry.rs")
text = path.read_text()
text = replace_once(text, "use std::collections::HashMap;", "use std::collections::HashMap;\nuse std::sync::Arc;", "registry Arc import")
text = replace_once(text, "use fub_abi::FormatProvider;", "use fub_abi::format::FormatDescriptor;\nuse fub_abi::FormatProvider;", "registry descriptor import")
text = replace_once(
    text,
    "#[derive(Default)]\npub struct FormatRegistry {\n    providers: Vec<Box<dyn FormatProvider>>,",
    "struct RegisteredFormat {\n    descriptor: FormatDescriptor,\n    provider: Arc<dyn FormatProvider>,\n}\n\n#[derive(Default)]\npub struct FormatRegistry {\n    providers: Vec<RegisteredFormat>,",
    "registered format storage",
)
text = replace_once(text, "incumbent: self.providers[at].descriptor().id,", "incumbent: self.providers[at].descriptor.id.clone(),", "registry incumbent")
text = replace_once(text, "        self.insert_normalized(provider, extensions);", "        self.insert_normalized(provider, descriptor, extensions);", "registry register insert")
text = replace_once(
    text,
    "    pub fn replace(&mut self, provider: Box<dyn FormatProvider>) {\n        let extensions = provider.descriptor().extensions;\n        self.insert(provider, &extensions);\n    }",
    "    pub fn replace(&mut self, provider: Box<dyn FormatProvider>) {\n        let descriptor = provider.descriptor();\n        let extensions = descriptor.extensions.clone();\n        self.insert_normalized(\n            provider,\n            descriptor,\n            extensions.into_iter().map(|ext| ext.to_lowercase()).collect(),\n        );\n    }",
    "registry replace",
)
start = text.index("    fn insert(&mut self, provider: Box<dyn FormatProvider>, extensions: &[String])")
end = rust_block_end(text, start)
# include the following insert_normalized function too
next_start = text.index("    fn insert_normalized(", end)
next_end = rust_block_end(text, next_start)
replacement = '''    fn insert_normalized(\n        &mut self,\n        provider: Box<dyn FormatProvider>,\n        descriptor: FormatDescriptor,\n        extensions: Vec<String>,\n    ) {\n        let idx = self.providers.len();\n        for ext in extensions {\n            self.by_ext.insert(ext, idx);\n        }\n        self.providers.push(RegisteredFormat {\n            descriptor,\n            provider: Arc::from(provider),\n        });\n    }'''
text = text[:start] + replacement + text[next_end:]
text = replace_once(
    text,
    "            return Some(self.providers[at].as_ref());",
    "            return Some(self.providers[at].provider.as_ref());",
    "registry direct provider lookup",
)
text = replace_once(
    text,
    ".map(|&at| self.providers[at].as_ref())",
    ".map(|&at| self.providers[at].provider.as_ref())",
    "registry normalized provider lookup",
)
provider_arc = r'''

    /// Lo stesso lookup di `provider_for_ext`, ma con ownership condivisa: chi
    /// prepara una callback clona l'`Arc` sotto lock e poi può eseguirla dopo
    /// aver rilasciato il workspace.
    pub(crate) fn provider_arc_for_ext(&self, ext: &str) -> Option<Arc<dyn FormatProvider>> {
        let at = self
            .by_ext
            .get(ext)
            .copied()
            .or_else(|| self.by_ext.get(&ext.to_lowercase()).copied())?;
        Some(Arc::clone(&self.providers[at].provider))
    }

    /// Descriptor congelato al momento della registrazione. Consultarlo non è
    /// una callback del provider.
    pub(crate) fn descriptor_for_ext(&self, ext: &str) -> Option<&FormatDescriptor> {
        let at = self
            .by_ext
            .get(ext)
            .copied()
            .or_else(|| self.by_ext.get(&ext.to_lowercase()).copied())?;
        Some(&self.providers[at].descriptor)
    }
'''
text = insert_after_impl(text, "    pub fn provider_for_ext(&self, ext: &str)", provider_arc, "provider_for_ext")
text = replace_once(
    text,
    "        self.providers\n            .first()?\n            .descriptor()\n            .extensions\n            .first()",
    "        self.providers\n            .first()?\n            .descriptor\n            .extensions\n            .first()",
    "registry default extension",
)
path.write_text(text)


# Syntax rules are immutable callbacks; share them so a prepared parse owns a
# coherent rule set after the Workspace lock is released.
path = Path("crates/fub-kernel/src/syntax.rs")
text = path.read_text()
text = replace_once(text, "struct Registered {\n    spec: SyntaxRuleSpec,\n    rule: Box<dyn SyntaxRule>,\n}", "#[derive(Clone)]\nstruct Registered {\n    spec: SyntaxRuleSpec,\n    rule: Arc<dyn SyntaxRule>,\n}", "syntax registered Arc")
text = replace_once(text, "#[derive(Default)]\npub struct SyntaxRegistry {", "#[derive(Clone, Default)]\npub struct SyntaxRegistry {", "syntax registry clone")
text = replace_once(text, "        self.rules.insert(at, Registered { spec, rule });", "        self.rules.insert(\n            at,\n            Registered {\n                spec,\n                rule: Arc::from(rule),\n            },\n        );", "syntax register Arc")
path.write_text(text)


# DocumentStore: a prepared parser contains every external callback needed by
# one parse. Its invocation is independent from Workspace.
path = Path("crates/fub-kernel/src/documents.rs")
text = path.read_text()
prepared_parse = r'''

/// Parser risolto senza eseguire codice esterno. Provider, descriptor e regole
/// sono una fotografia coerente che può attraversare il confine del lock.
pub(crate) struct PreparedParse {
    id: DocId,
    descriptor: DocumentFormat,
    provider: Arc<dyn fub_abi::FormatProvider>,
    syntax: SyntaxRegistry,
}

impl PreparedParse {
    pub(crate) fn invoke(&self, source: DocumentSource) -> Result<DocumentModel> {
        let ctx = ParseContext::obsidian(self.id.as_str());
        let mut model = crate::safety::caught(
            &self.descriptor.descriptor.id,
            crate::safety::Gate::FormatParse,
            self.id.as_str(),
            fub_abi::error::FormatError::Parse,
            || self.provider.parse(&source, &ctx),
        )?;
        ensure_model_identity(&self.id, &model.id)?;
        self.syntax
            .apply(&mut model, &ctx, &self.descriptor.descriptor.id);
        Ok(model)
    }
}
'''
# We need SyntaxRegistry imported explicitly.
text = replace_once(text, "use crate::registry::FormatRegistry;", "use crate::registry::FormatRegistry;\nuse crate::syntax::SyntaxRegistry;", "documents syntax import")
# Insert before DocumentStore.
anchor = "pub struct DocumentStore {"
if text.count(anchor) != 1:
    raise SystemExit("DocumentStore anchor not unique")
text = text.replace(anchor, prepared_parse + "\n" + anchor, 1)
# Prepare parse method before parse().
prepare_method = r'''

    /// Risolve il parser senza eseguire callback. Il descriptor viene dalla
    /// cache del registro, le regole sono una fotografia condivisa.
    pub(crate) fn prepare_parse(&self, id: &DocId) -> Result<PreparedParse> {
        let ext = extension_of(id).unwrap_or_default();
        let provider = self
            .registry
            .provider_arc_for_ext(&ext)
            .ok_or_else(|| KernelError::NoProvider(ext.clone()))?;
        let descriptor = self
            .registry
            .descriptor_for_ext(&ext)
            .cloned()
            .ok_or_else(|| KernelError::NoProvider(ext.clone()))?;
        let grafted = self.syntax.grafted_syntax(&descriptor.id);
        let capabilities = fub_abi::format::FormatCapabilities {
            syntax: grafted.overlay(&provider.capabilities().syntax),
        };
        Ok(PreparedParse {
            id: id.clone(),
            descriptor: DocumentFormat {
                descriptor,
                capabilities,
            },
            provider,
            syntax: self.syntax.clone(),
        })
    }
'''
# WARNING capabilities() is provider callback; do not execute it under prepare.
# Replace the above with a descriptor-only holder before writing.
prepare_method = r'''

    /// Risolve il parser senza eseguire callback. Il descriptor viene dalla
    /// cache del registro, le regole sono una fotografia condivisa.
    pub(crate) fn prepare_parse(&self, id: &DocId) -> Result<PreparedParse> {
        let ext = extension_of(id).unwrap_or_default();
        let provider = self
            .registry
            .provider_arc_for_ext(&ext)
            .ok_or_else(|| KernelError::NoProvider(ext.clone()))?;
        let descriptor = self
            .registry
            .descriptor_for_ext(&ext)
            .cloned()
            .ok_or_else(|| KernelError::NoProvider(ext.clone()))?;
        Ok(PreparedParse {
            id: id.clone(),
            descriptor: DocumentFormat {
                descriptor,
                capabilities: fub_abi::format::FormatCapabilities::default(),
            },
            provider,
            syntax: self.syntax.clone(),
        })
    }
'''
text = insert_after_impl(text, "    pub(crate) fn has_provider_for(&self, id: &DocId)", prepare_method, "has_provider_for")
# Source kind lookup no longer executes descriptor().
text = replace_once(
    text,
    "        Ok(match self.provider_for(id)?.descriptor().source {",
    "        let ext = extension_of(id).unwrap_or_default();\n        let descriptor = self\n            .registry\n            .descriptor_for_ext(&ext)\n            .ok_or_else(|| KernelError::NoProvider(ext.clone()))?;\n        Ok(match descriptor.source {",
    "source_from_disk descriptor cache",
)
parse_source_replacement = r'''    pub(crate) fn parse_source(&self, id: &DocId, source: DocumentSource) -> Result<DocumentModel> {
        self.prepare_parse(id)?.invoke(source)
    }'''
text = replace_function(text, "    pub(crate) fn parse_source(&self, id: &DocId, source: DocumentSource)", parse_source_replacement, "DocumentStore::parse_source")
path.write_text(text)


# Workspace: split the write into prepare -> parse -> finish. The prepared value
# carries the CAS base and journal classification; writer-turn serializes Fub
# writers while the parse callback runs without the RwLock.
path = Path("crates/fub-kernel/src/workspace.rs")
text = path.read_text()
text = replace_once(text, "use crate::documents::{extension_of, DocumentStore};", "use crate::documents::{extension_of, DocumentStore, PreparedParse};", "workspace prepared parse import")
prepared_write = r'''

/// Scrittura risolta fino al confine del codice esterno. Non porta guardie del
/// workspace: può essere parsata mentre `Custody<Workspace>` è rilasciato.
pub struct PreparedDocumentWrite {
    id: DocId,
    existed: bool,
    from: Option<Revision>,
    expected_source: Option<String>,
    parser: PreparedParse,
}

impl PreparedDocumentWrite {
    /// Esegue `FormatProvider::parse` e tutte le `SyntaxRule`, e nient'altro.
    pub fn parse(&self, source: &str) -> Result<DocumentModel> {
        self.parser
            .invoke(DocumentSource::Text(source.to_string()))
    }
}
'''
text = insert_after_impl(text, "impl PreparedViewAction {", prepared_write, "PreparedViewAction")

# Extract the existing selection logic from write_document into prepare, then
# preserve write_document as compatibility wrapper for direct Workspace callers.
write_replacement = r'''    pub fn prepare_document_write(
        &self,
        id: &DocId,
        base: WriteBase,
    ) -> Result<PreparedDocumentWrite> {
        let (id, existed, from, expected_source) = match base {
            WriteBase::DescendsFrom(expected) => {
                let current = crate::error::optional(self.docs.vault.read(id))?;
                let now = current.as_ref().map(|s| Revision::of(s));
                if !current
                    .as_deref()
                    .is_some_and(|source| expected.matches(source))
                {
                    return Err(KernelError::Stale(id.to_string()));
                }
                (id.clone(), true, now, current)
            }
            WriteBase::Dictated => {
                let in_store = self.indexes.core.entries.get(id);
                let candidate = new_doc_id(id.as_str());
                let unchanged_portable =
                    in_store.is_some() && candidate.as_ref().is_ok_and(|candidate| candidate == id);
                let normalized_exists = !unchanged_portable
                    && candidate.as_ref().is_ok_and(|candidate| {
                        candidate != id && self.docs.vault.stat(candidate).is_some()
                    });
                let raw_exists = !unchanged_portable && self.docs.vault.stat(id).is_some();
                let normalized_aliases_raw = normalized_exists
                    && raw_exists
                    && candidate
                        .as_ref()
                        .is_ok_and(|candidate| self.docs.vault.same_file(id, candidate));
                let use_normalized = normalized_exists && (!raw_exists || normalized_aliases_raw);
                let existed = unchanged_portable || normalized_exists || raw_exists;
                if existed {
                    let id = if use_normalized {
                        candidate
                            .as_ref()
                            .expect("a normalized existing target")
                            .clone()
                    } else {
                        id.clone()
                    };
                    let in_store = self.indexes.core.entries.get(&id);
                    let fingerprint = in_store.and_then(|and| and.fingerprint.clone());
                    (id, true, fingerprint, None)
                } else {
                    let id = candidate?;
                    let in_store = self.indexes.core.entries.get(&id);
                    let fingerprint = in_store.and_then(|and| and.fingerprint.clone());
                    let existed = self.docs.vault.stat(&id).is_some();
                    (
                        id,
                        existed,
                        existed.then_some(fingerprint).flatten(),
                        None,
                    )
                }
            }
        };
        let parser = self.docs.prepare_parse(&id)?;
        Ok(PreparedDocumentWrite {
            id,
            existed,
            from,
            expected_source,
            parser,
        })
    }

    /// Finalizza una scrittura già parsata. La CAS resta qui, sotto il writer
    /// turn, quindi il tempo passato nel provider non allarga la finestra fra
    /// expected e write per gli altri writer Fub.
    pub fn finish_document_write(
        &mut self,
        prepared: PreparedDocumentWrite,
        source: &str,
        model: DocumentModel,
    ) -> Result<Revision> {
        let PreparedDocumentWrite {
            id,
            existed,
            from,
            expected_source,
            ..
        } = prepared;
        let to = self.write_source_parsed(&id, source, expected_source.as_deref(), model)?;
        self.record(if existed {
            JournalOp::Written {
                doc: id.clone(),
                from,
                to: to.clone(),
            }
        } else {
            JournalOp::Created {
                doc: id.clone(),
                to: to.clone(),
            }
        });
        Ok(to)
    }

    pub fn write_document(
        &mut self,
        id: &DocId,
        source: &str,
        base: WriteBase,
    ) -> Result<Revision> {
        let prepared = self.prepare_document_write(id, base)?;
        let model = prepared.parse(source)?;
        self.finish_document_write(prepared, source, model)
    }'''
text = replace_function(text, "    pub fn write_document(\n", write_replacement, "Workspace::write_document")

write_source_replacement = r'''    fn write_source(
        &mut self,
        id: &DocId,
        source: &str,
        expected_source: Option<&str>,
    ) -> Result<Revision> {
        let model = self.docs.parse(id, source)?;
        self.write_source_parsed(id, source, expected_source, model)
    }'''
text = replace_function(text, "    fn write_source(\n", write_source_replacement, "Workspace::write_source")

parsed_helper = r'''

    /// Seconda metà di `write_source`: da qui in poi il modello è già stato
    /// prodotto. Restano hook, storage/CAS, ingestione ed eventi.
    fn write_source_parsed(
        &mut self,
        id: &DocId,
        source: &str,
        expected_source: Option<&str>,
        model: DocumentModel,
    ) -> Result<Revision> {
        if let Some((plugin, hook)) = &self.before_write {
            let plugin = plugin.clone();
            let hook = hook.clone();
            let mut host = self.host_for(&plugin, InvokeMode::Apply);
            if let Err(and) = hook(&mut host, id) {
                return Err(match and {
                    PluginError::Io(why) => KernelError::Io {
                        path: id.to_string().into(),
                        source: std::io::Error::other(why.to_string()),
                    },
                    other => KernelError::BadEdit {
                        doc: id.to_string(),
                        why: other.to_string(),
                    },
                });
            }
        }
        let placed = if let Some(expected) = expected_source {
            self.docs
                .vault
                .write_if_unchanged(id, expected, source)?
                .ok_or_else(|| KernelError::Stale(id.to_string()))?
        } else {
            self.docs.vault.write(id, source)?
        };
        let revision = Revision::of(source);
        self.ingest_model(id, model, revision.clone(), Some(placed));
        self.dispatch_pending();
        Ok(revision)
    }
'''
text = insert_after_impl(text, "    fn write_source(\n", parsed_helper, "write_source")
path.write_text(text)


# Host production path: keep the logical writer turn, but release the Workspace
# RwLock for the parser callback.
path = Path("crates/fub-host/src/session.rs")
text = path.read_text()
host_write = r'''    pub fn write_document(
        &self,
        vault: Option<&str>,
        id: &DocId,
        source: &str,
        base: WriteBase,
    ) -> Result<Revision, PluginError> {
        let workspace = self.with_session(vault, |session| session.workspace.clone())?;
        let _turn = workspace.write_turn();
        let prepared = {
            let ws = workspace.read()?;
            ws.prepare_document_write(id, base)
                .map_err(PluginError::from)?
        };
        let model = prepared.parse(source).map_err(PluginError::from)?;
        let mut ws = workspace.write()?;
        ws.finish_document_write(prepared, source, model)
            .map_err(PluginError::from)
    }'''
text = replace_function(text, "    pub fn write_document(\n", host_write, "Host::write_document")
path.write_text(text)


# Deterministic regression on the real Host path: a hot SyntaxRule (external
# provider code in the parse phase) blocks after it is called. A reader must
# still acquire the workspace before the rule is released.
path = Path("crates/fub-host/tests/concurrency.rs")
text = path.read_text()
text = replace_once(
    text,
    "use fub_abi::command::{CommandOutcome, CommandReach, CommandScope, CommandSpec, InvokeMode};",
    "use fub_abi::command::{CommandOutcome, CommandReach, CommandScope, CommandSpec, InvokeMode};\nuse fub_abi::custom::{SyntaxMatch, SyntaxProduct, SyntaxRule, SyntaxRuleSpec, SyntaxTrigger};\nuse fub_abi::error::FormatError;\nuse fub_abi::format::ParseContext;",
    "concurrency syntax imports",
)
anchor = "const VIEW_RENDER_LOCK_PLUGIN: &str = \"fub.audit-view-render\";"
if text.count(anchor) != 1:
    raise SystemExit("parse test anchor not unique")
probe = r'''const PARSE_LOCK_PLUGIN: &str = "com.fub.auditparse";

struct ParseLockRule {
    entered: std::sync::mpsc::SyncSender<()>,
    release: Mutex<std::sync::mpsc::Receiver<()>>,
}

impl SyntaxRule for ParseLockRule {
    fn spec(&self) -> SyntaxRuleSpec {
        SyntaxRuleSpec {
            id: format!("{PARSE_LOCK_PLUGIN}:lock"),
            format: "markdown".into(),
            trigger: SyntaxTrigger::Fence {
                info: vec!["audit-lock".into()],
            },
            order: 0,
            option: None,
            produces: vec![format!("{PARSE_LOCK_PLUGIN}:block")],
        }
    }

    fn apply(
        &self,
        _: &SyntaxMatch,
        _: &ParseContext,
    ) -> Result<Option<SyntaxProduct>, FormatError> {
        self.entered
            .send(())
            .map_err(|_| FormatError::Parse("parse probe receiver disappeared".into()))?;
        self.release
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .recv_timeout(Duration::from_secs(10))
            .map_err(|_| FormatError::Parse("parse probe was not released".into()))?;
        Ok(None)
    }
}

#[test]
fn a_syntax_rule_during_host_write_runs_without_holding_the_workspace_lock() {
    let _turn = bench_turn();
    let v = vault(4);
    let host = open(&v);
    let ws = host.debug_workspace(None).expect("debug custody");
    let (entered_tx, entered_rx) = std::sync::mpsc::sync_channel(1);
    let (release_tx, release_rx) = std::sync::mpsc::sync_channel(1);
    {
        let mut w = ws.write().expect("the vault is alive");
        w.register_plugin(
            PluginManifest::new(PARSE_LOCK_PLUGIN, "Audit detached parse"),
            Trust::Community,
        )
        .expect("parse probe plugin registers");
        w.register_syntax_rule(
            PARSE_LOCK_PLUGIN,
            Box::new(ParseLockRule {
                entered: entered_tx,
                release: Mutex::new(release_rx),
            }),
        )
        .expect("parse probe rule registers");
    }

    let call = std::thread::spawn(move || {
        host.write_document(
            None,
            &DocId::new("ParseProbe.md"),
            "```audit-lock\npayload\n```\n",
            WriteBase::Dictated,
        )
    });
    entered_rx
        .recv_timeout(Duration::from_secs(10))
        .expect("syntax rule entered during the Host write");
    let (reader_tx, reader_rx) = std::sync::mpsc::sync_channel(1);
    let reader = {
        let ws = ws.clone();
        std::thread::spawn(move || {
            let acquired = ws.read().is_ok();
            let _ = reader_tx.send(acquired);
        })
    };
    let reader_progressed = reader_rx
        .recv_timeout(Duration::from_secs(2))
        .unwrap_or(false);
    release_tx.send(()).expect("release syntax rule");
    reader.join().expect("reader probe finishes");
    let outcome = call.join().expect("write thread does not panic");

    assert!(
        reader_progressed,
        "Host::write_document held Custody<Workspace> across the parse callbacks"
    );
    outcome.expect("write completes after the detached parse");
}

'''
text = text.replace(anchor, probe + anchor, 1)
path.write_text(text)
