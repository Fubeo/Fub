//! Staging pipeline re-export: [`crate::template`] owns preflight,
//! staging, manifest, preview, commit and cancel around the existing
//! transfer ports. This module is the P10 orchestra entry Main calls.

pub use crate::migration::{commit, commit_registered, rollback};
pub use crate::template::{
    preflight, ImportTemplate, StagingManifest, MANIFEST_PREFIX, STAGING_PREFIX, TEMPLATE_SCHEMA,
};
