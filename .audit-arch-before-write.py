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


# Kernel prepared write now carries the already-cloneable hook. The hook itself
# can run through a per-capability HostApi while the Workspace RwLock is absent.
path = Path("crates/fub-kernel/src/workspace.rs")
text = path.read_text()
text = replace_once(
    text,
    "    expected_source: Option<String>,\n    parser: PreparedParse,\n}",
    "    expected_source: Option<String>,\n    parser: PreparedParse,\n    before_write: Option<(String, BeforeWriteHook)>,\n}",
    "prepared write hook field",
)
text = replace_once(
    text,
    '''    pub fn parse(&self, source: &str) -> Result<DocumentModel> {\n        self.parser.invoke(DocumentSource::Text(source.to_string()))\n    }\n}''',
    '''    pub fn parse(&self, source: &str) -> Result<DocumentModel> {\n        self.parser.invoke(DocumentSource::Text(source.to_string()))\n    }\n\n    pub fn before_write_owner(&self) -> Option<&str> {\n        self.before_write.as_ref().map(|(owner, _)| owner.as_str())\n    }\n\n    /// Esegue soltanto il gancio esterno fra parse e disco. Il chiamante host\n    /// gli fornisce un proxy che riacquisisce capacità strette una per volta.\n    pub fn invoke_before_write(\n        &self,\n        host: &mut dyn HostApi,\n    ) -> std::result::Result<(), PluginError> {\n        match &self.before_write {\n            Some((_, hook)) => hook(host, &self.id),\n            None => Ok(()),\n        }\n    }\n}''',
    "prepared write methods",
)
text = replace_once(
    text,
    "            expected_source,\n            parser,\n        })",
    "            expected_source,\n            parser,\n            before_write: self.before_write.clone(),\n        })",
    "prepared write construction",
)

finish = r'''    /// Finalizza una scrittura già parsata e con il gancio già tornato. La CAS
    /// resta qui, sotto il writer turn: nessun writer Fub può infilarsi fra la
    /// base preparata e la sostituzione, mentre il provider gira senza RwLock.
    pub fn finish_document_write(
        &mut self,
        prepared: PreparedDocumentWrite,
        source: &str,
        model: DocumentModel,
        before_write: std::result::Result<(), PluginError>,
    ) -> Result<Revision> {
        let PreparedDocumentWrite {
            id,
            existed,
            from,
            expected_source,
            ..
        } = prepared;
        if let Err(and) = before_write {
            return Err(Self::before_write_error(&id, and));
        }
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
    }'''
text = replace_function(text, "    pub fn finish_document_write(\n", finish, "finish_document_write")

compat = r'''    pub fn write_document(
        &mut self,
        id: &DocId,
        source: &str,
        base: WriteBase,
    ) -> Result<Revision> {
        let prepared = self.prepare_document_write(id, base)?;
        let model = prepared.parse(source)?;
        let before_write = if let Some(owner) = prepared.before_write_owner().map(str::to_owned) {
            let mut host = self.host_for(&owner, InvokeMode::Apply);
            prepared.invoke_before_write(&mut host)
        } else {
            Ok(())
        };
        self.finish_document_write(prepared, source, model, before_write)
    }'''
text = replace_function(text, "    pub fn write_document(\n", compat, "Workspace::write_document")

write_source = r'''    fn write_source(
        &mut self,
        id: &DocId,
        source: &str,
        expected_source: Option<&str>,
    ) -> Result<Revision> {
        let model = self.docs.parse(id, source)?;
        if let Some((plugin, hook)) = self.before_write.clone() {
            let mut host = self.host_for(&plugin, InvokeMode::Apply);
            if let Err(and) = hook(&mut host, id) {
                return Err(Self::before_write_error(id, and));
            }
        }
        self.write_source_parsed(id, source, expected_source, model)
    }'''
text = replace_function(text, "    fn write_source(\n", write_source, "Workspace::write_source")

parsed = r'''    /// Seconda metà di `write_source`: parse e gancio sono già tornati. Da qui
    /// in poi restano soltanto storage/CAS, ingestione ed eventi.
    fn write_source_parsed(
        &mut self,
        id: &DocId,
        source: &str,
        expected_source: Option<&str>,
        model: DocumentModel,
    ) -> Result<Revision> {
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
    }'''
text = replace_function(text, "    fn write_source_parsed(\n", parsed, "write_source_parsed")

# Centralize the exact old error mapping, so detached Host writes and legacy
# direct Workspace writes report the same errors.
marker = "    fn write_source_parsed(\n"
start = text.index(marker)
helper = r'''    fn before_write_error(id: &DocId, and: PluginError) -> KernelError {
        match and {
            PluginError::Io(why) => KernelError::Io {
                path: id.to_string().into(),
                source: std::io::Error::other(why.to_string()),
            },
            other => KernelError::BadEdit {
                doc: id.to_string(),
                why: other.to_string(),
            },
        }
    }

'''
text = text[:start] + helper + text[start:]
path.write_text(text)


# Production host: keep the writer turn, but run the hook through JobHost after
# parse and before reacquiring Workspace for CAS/storage/finalize.
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
        let before_write = if let Some(owner) = prepared.before_write_owner().map(str::to_owned) {
            let mut detached = JobHost::new(workspace.clone(), owner);
            prepared.invoke_before_write(&mut detached)
        } else {
            Ok(())
        };
        let mut ws = workspace.write()?;
        ws.finish_document_write(prepared, source, model, before_write)
            .map_err(PluginError::from)
    }'''
text = replace_function(text, "    pub fn write_document(\n", host_write, "Host::write_document")
path.write_text(text)


# Deterministic regression. The hook performs a real HostApi read, then blocks.
# A separate reader must acquire the workspace while the hook is still open.
path = Path("crates/fub-host/tests/concurrency.rs")
text = path.read_text()
anchor = 'const PARSE_LOCK_PLUGIN: &str = "com.fub.auditparse";'
if text.count(anchor) != 1:
    raise SystemExit("before-write test anchor not unique")
probe = r'''const BEFORE_WRITE_LOCK_PLUGIN: &str = "fub.audit-before-write";

#[test]
fn the_before_write_hook_runs_without_holding_the_workspace_lock() {
    let _turn = bench_turn();
    let v = vault(4);
    let host = open(&v);
    let ws = host.debug_workspace(None).expect("debug custody");
    let (entered_tx, entered_rx) = std::sync::mpsc::sync_channel(1);
    let (release_tx, release_rx) = std::sync::mpsc::sync_channel(1);
    {
        let mut w = ws.write().expect("the vault is alive");
        w.register_core_feature(BEFORE_WRITE_LOCK_PLUGIN, "Audit detached before-write")
            .expect("hook owner declares");
        w.set_before_write_hook(Some((
            BEFORE_WRITE_LOCK_PLUGIN.to_string(),
            Arc::new(move |host, id| {
                let old = host.read_document(id)?;
                if !old.contains("Note 0") {
                    return Err(PluginError::Internal(
                        "before-write re-entry returned the wrong note".into(),
                    ));
                }
                entered_tx.send(()).map_err(|_| {
                    PluginError::Internal("before-write probe receiver disappeared".into())
                })?;
                release_rx
                    .recv_timeout(Duration::from_secs(10))
                    .map_err(|_| PluginError::Internal("before-write probe was not released".into()))?;
                Ok(())
            }),
        )));
    }

    let call = std::thread::spawn(move || {
        host.write_document(
            None,
            &DocId::new("Note 0.md"),
            "# Note 0\nchanged by before-write probe\n",
            WriteBase::Dictated,
        )
    });
    entered_rx
        .recv_timeout(Duration::from_secs(10))
        .expect("before-write hook entered after a real HostApi read");
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
    release_tx.send(()).expect("release before-write hook");
    reader.join().expect("reader probe finishes");
    let outcome = call.join().expect("write thread does not panic");

    assert!(
        reader_progressed,
        "Host::write_document held Custody<Workspace> across the before-write hook"
    );
    outcome.expect("write completes after detached before-write hook");
}

'''
path.write_text(text.replace(anchor, probe + anchor, 1))
