//! Il planner del canale dati eseguito fuori da `Custody<Workspace>`.
//!
//! Il kernel congela routing e handle, questo composition root presta il core
//! con acquisizioni brevi. La divisione è intenzionale: il kernel non conosce
//! il lock, l'host non ricopia la semantica del planner.

use fub_abi::model::DocId;
use fub_abi::query::{Matches, QueryPredicate};
use fub_abi::traits::{
    DocumentMatch, IndexQuery, IndexResult, Page, Paged, PropertySelect, PropertySort,
};
use fub_abi::PluginError;
use fub_kernel::index::plan::QueryCore;
use fub_kernel::Workspace;

use crate::custody::Custody;

impl QueryCore for Custody<Workspace> {
    fn query_core(&self, query: IndexQuery) -> Result<IndexResult, PluginError> {
        let workspace = self.read()?;
        QueryCore::query_core(&*workspace, query)
    }

    fn core_documents(&self) -> Result<Vec<DocId>, PluginError> {
        let workspace = self.read()?;
        QueryCore::core_documents(&*workspace)
    }

    fn core_predicate(&self, predicate: &QueryPredicate) -> Result<Matches, PluginError> {
        let workspace = self.read()?;
        QueryCore::core_predicate(&*workspace, predicate)
    }

    fn finish_core_documents(
        &self,
        matches: Matches,
        sort: Option<&PropertySort>,
        select: &PropertySelect,
        page: Option<Page>,
    ) -> Result<Paged<DocumentMatch>, PluginError> {
        let workspace = self.read()?;
        QueryCore::finish_core_documents(&*workspace, matches, sort, select, page)
    }
}

/// Prepara sotto una lettura breve, esegue gli indici esterni senza guardia e
/// valida/localizza il risultato sotto una nuova lettura breve.
pub(crate) fn query_workspace(
    workspace: &Custody<Workspace>,
    query: IndexQuery,
) -> Result<IndexResult, PluginError> {
    let local = {
        let workspace = workspace.read()?;
        workspace.prepare_local_index_projection(&query)?
    };
    if let Some(prepared) = local {
        let completed = prepared.invoke()?;
        let workspace = workspace.read()?;
        return workspace.finish_local_index_projection(completed);
    }

    let prepared = workspace.read()?.prepare_detached_index_query(&query);
    let Some(prepared) = prepared else {
        return workspace.read()?.query_index(query);
    };

    let result = prepared.query(workspace, query.clone())?;
    let workspace = workspace.read()?;
    workspace.finish_detached_index_query(&prepared, &query, result)
}
