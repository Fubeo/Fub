//! Test del versioning: gli aiuti comuni, poi un file per area.

use fub_sdk::testing::MemoryHost;

use super::*;
use fub_abi::edit::WriteBase;
use fub_abi::traits::{DataRead, DataWrite, EntryKind, HostEnv, VaultWrite};

fn id(s: &str) -> DocId {
    DocId::new(s)
}

mod history;
mod recovery;
mod retention;
