//! Doppio minimale del protocollo grid per i test host/kernel.
//!
//! Questo harness non parsa sorgenti, non valuta formule e non conserva un
//! secondo `SheetSession`: riceve finestre e commit preparati dal test e si
//! limita a verificare il confine, la revisione e il lifecycle.

use std::collections::BTreeMap;

use fub_abi::edit::Revision;
use fub_abi::grid::{
    validate_grid_source, GridApplyRequest, GridCommit, GridProvider, GridSession, GridSurfaceSpec,
    GridWindow, GridWindowRequest,
};
use fub_abi::PluginError;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum GridCall {
    Open { surface: String, revision: Revision },
    Window { instance: String, request: GridWindowRequest },
    Apply { instance: String, request: GridApplyRequest },
    Reload { instance: String, revision: Revision },
    Close { instance: String },
    Shutdown,
}

/// Provider scriptabile per testare il contratto senza introdurre un motore di
/// formule nel banco host.
#[derive(Default)]
pub struct GridHarness {
    surfaces: Vec<GridSurfaceSpec>,
    sessions: BTreeMap<String, GridSession>,
    windows: BTreeMap<(String, String), GridWindow>,
    commits: BTreeMap<String, GridCommit>,
    calls: Vec<GridCall>,
    next_instance: u64,
}

impl GridHarness {
    pub fn new(surfaces: Vec<GridSurfaceSpec>) -> Self {
        Self {
            surfaces,
            ..Self::default()
        }
    }

    pub fn with_window(mut self, instance: impl Into<String>, window: GridWindow) -> Self {
        let instance = instance.into();
        self.windows
            .insert((instance, window.sheet.clone()), window);
        self
    }

    pub fn with_commit(mut self, instance: impl Into<String>, commit: GridCommit) -> Self {
        self.commits.insert(instance.into(), commit);
        self
    }

    pub fn calls(&self) -> &[GridCall] {
        &self.calls
    }

    pub fn session(&self, instance: &str) -> Option<&GridSession> {
        self.sessions.get(instance)
    }

    fn surface_known(&self, id: &str) -> bool {
        self.surfaces.iter().any(|surface| surface.id == id)
    }

    fn missing(message: &'static str) -> PluginError {
        PluginError::Unserved(message.into())
    }

    fn bad(message: &'static str) -> PluginError {
        PluginError::BadArgs(message.into())
    }
}

impl GridProvider for GridHarness {
    fn surfaces(&self) -> Vec<GridSurfaceSpec> {
        self.surfaces.clone()
    }

    fn open(
        &mut self,
        surface: &str,
        source: &str,
        revision: Revision,
    ) -> Result<GridSession, PluginError> {
        validate_grid_source(source)?;
        if !self.surface_known(surface) {
            return Err(Self::missing("grid surface is not mounted"));
        }
        if revision.0.is_empty() {
            return Err(Self::bad("grid open has an empty revision"));
        }
        self.next_instance = self.next_instance.saturating_add(1);
        let instance = format!("grid-test-{}", self.next_instance);
        let session = GridSession {
            instance: instance.clone(),
            revision,
            sheets: Vec::new(),
        };
        session.validate()?;
        self.calls.push(GridCall::Open {
            surface: surface.to_owned(),
            revision: session.revision.clone(),
        });
        self.sessions.insert(instance, session.clone());
        Ok(session)
    }

    fn window(
        &mut self,
        instance: &str,
        request: GridWindowRequest,
    ) -> Result<GridWindow, PluginError> {
        request.validate()?;
        let session = self
            .sessions
            .get(instance)
            .ok_or_else(|| Self::missing("grid session is not open"))?;
        if session.revision != request.revision {
            return Err(PluginError::Conflict("grid session revision changed".into()));
        }
        self.calls.push(GridCall::Window {
            instance: instance.to_owned(),
            request: request.clone(),
        });
        let window = self
            .windows
            .get(&(instance.to_owned(), request.sheet.clone()))
            .cloned()
            .ok_or_else(|| Self::missing("grid window is not scripted"))?;
        if window.revision != request.revision {
            return Err(PluginError::Conflict("grid window revision changed".into()));
        }
        window.validate()?;
        Ok(window)
    }

    fn apply(
        &mut self,
        instance: &str,
        request: GridApplyRequest,
    ) -> Result<GridCommit, PluginError> {
        request.validate()?;
        let session = self
            .sessions
            .get(instance)
            .ok_or_else(|| Self::missing("grid session is not open"))?;
        if session.revision != request.revision {
            return Err(PluginError::Conflict("grid session revision changed".into()));
        }
        self.calls.push(GridCall::Apply {
            instance: instance.to_owned(),
            request: request.clone(),
        });
        let commit = self
            .commits
            .get(instance)
            .cloned()
            .ok_or_else(|| Self::missing("grid commit is not scripted"))?;
        commit.validate()?;
        if commit.revision == request.revision {
            return Err(Self::bad("grid commit must advance its revision"));
        }
        if let Some(session) = self.sessions.get_mut(instance) {
            session.revision = commit.revision.clone();
        }
        Ok(commit)
    }

    fn reload(
        &mut self,
        instance: &str,
        expected: Revision,
        source: &str,
        revision: Revision,
    ) -> Result<GridSession, PluginError> {
        validate_grid_source(source)?;
        if revision.0.is_empty() {
            return Err(Self::bad("grid reload has an empty revision"));
        }
        let session = self
            .sessions
            .get_mut(instance)
            .ok_or_else(|| Self::missing("grid session is not open"))?;
        if session.revision != expected {
            return Err(PluginError::Conflict("grid session revision changed".into()));
        }
        session.revision = revision.clone();
        self.calls.push(GridCall::Reload {
            instance: instance.to_owned(),
            revision,
        });
        Ok(session.clone())
    }

    fn close(&mut self, instance: &str) -> Result<(), PluginError> {
        self.calls.push(GridCall::Close {
            instance: instance.to_owned(),
        });
        if self.sessions.remove(instance).is_none() {
            return Err(Self::missing("grid session is not open"));
        }
        self.windows.retain(|(owner, _), _| owner != instance);
        self.commits.remove(instance);
        Ok(())
    }

    fn shutdown(&mut self) -> Result<(), PluginError> {
        self.calls.push(GridCall::Shutdown);
        self.sessions.clear();
        self.windows.clear();
        self.commits.clear();
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use fub_abi::grid::{GridCellKey, GridInvalidation, GridSourceEdit};

    fn spec() -> GridSurfaceSpec {
        GridSurfaceSpec::new("test.grid", "fubsheet")
    }

    fn window(revision: &Revision) -> GridWindow {
        GridWindow {
            revision: revision.clone(),
            sheet: "s".into(),
            row_start: 0,
            column_start: 0,
            total_rows: 1,
            total_columns: 1,
            rows: Vec::new(),
            columns: Vec::new(),
            cells: Vec::new(),
        }
    }

    #[test]
    fn discovery_and_open_are_data_only_and_unknown_surface_is_unserved() {
        let mut harness = GridHarness::new(vec![spec()]);
        assert_eq!(harness.surfaces(), vec![spec()]);
        let revision = Revision::of("{}");
        let session = harness.open("test.grid", "{}", revision.clone()).unwrap();
        assert_eq!(session.revision, revision);
        assert!(matches!(
            harness.open("missing.grid", "{}", Revision::of("{}")),
            Err(PluginError::Unserved(_))
        ));
        assert!(harness.calls().iter().any(|call| matches!(call, GridCall::Open { .. })));
    }

    #[test]
    fn scripted_window_and_commit_preserve_revision_guards() {
        let revision = Revision::of("before");
        let next = Revision::of("after");
        let commit = GridCommit {
            revision: next.clone(),
            edit: GridSourceEdit {
                from: 0,
                to: 0,
                deleted: String::new(),
                inserted: "after".into(),
            },
            invalidation: GridInvalidation::Cells(vec![GridCellKey {
                sheet: "s".into(),
                row: "r".into(),
                column: "c".into(),
            }]),
        };
        let mut harness = GridHarness::new(vec![spec()])
            .with_window("grid-test-1", window(&revision))
            .with_commit("grid-test-1", commit);
        let session = harness.open("test.grid", "{}", revision.clone()).unwrap();
        let request = GridWindowRequest {
            revision: revision.clone(),
            sheet: "s".into(),
            row_start: 0,
            row_count: 1,
            column_start: 0,
            column_count: 1,
        };
        harness.window(&session.instance, request.clone()).unwrap();
        let commit = harness
            .apply(
                &session.instance,
                GridApplyRequest {
                    revision,
                    patches: vec![fub_abi::GridCellPatch {
                        cell: GridCellKey {
                            sheet: "s".into(),
                            row: "r".into(),
                            column: "c".into(),
                        },
                        before: Some("before".into()),
                        after: "after".into(),
                    }],
                },
            )
            .unwrap();
        assert_eq!(commit.revision, next);
        assert!(matches!(
            harness.window(&session.instance, request),
            Err(PluginError::Conflict(_))
        ));
    }
}
