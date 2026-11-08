//! Private regression suites that intentionally exercise lock ownership.
//!
//! Keeping these modules inside the crate lets the release API expose typed
//! host operations without exposing the generic custody primitive.

mod backup_restore_drill;
mod command_service_lock;
mod concurrency;
mod event_handler_lock;
mod flush_is_its_own_phase;
mod format_source;
mod headless;
mod host_public_lock;
mod index_feed_lock;
mod index_removal_lock;
mod job_callback_lock;
mod keys_from_outside;
mod lifecycle_teardown_drop;
mod lifecycle_teardown_events;
mod lifecycle_teardown_lock;
mod lifecycle_teardown_missing_owner;
mod long_running;
mod machine_without_vault;
mod mounting;
mod one_lock_only;
mod phased_opening;
mod projection_lock;
mod query_index_lock;
mod race_stop;
mod read_model_lock;
mod registration_lock;
mod runtime_index_flush_lock;
mod switches;
mod the_bridge;
mod the_first_plugin;
mod the_runner;
mod the_turn_yields;
mod the_watcher_batch;
mod the_watcher_window;
mod unlinked_mentions;
mod view_provider_stale;
mod watcher_factory_lock;

use std::sync::RwLockReadGuard;
use std::time::{Duration, Instant};

use crate::custody::Hold;
use crate::Custody;

/// Quanto si aspetta che una custodia torni libera prima di dire che qualcuno
/// la trattiene.
pub(crate) const FREE_WITHIN: Duration = Duration::from_secs(5);

/// Il prestito condiviso, riprovato fino a `within`.
///
/// `try_read` è una fotografia di un istante. Un host aperto ha i suoi thread
/// `fub-job-*`, che prendono il workspace per un attimo quando vogliono: un
/// `None` singolo confonde «trattenuto da chi si sta provando» con «preso un
/// istante da un lavoro indipendente» (#98, #70, #270, #292). Il primo resta
/// preso fino alla scadenza, e la prova cade lo stesso; il secondo si libera.
pub(crate) fn try_read_within<T>(
    custody: &Custody<T>,
    within: Duration,
) -> Option<RwLockReadGuard<'_, T>> {
    retry_within(within, || custody.try_read())
}

/// Il prestito esclusivo, riprovato fino a `within`: vedi [`try_read_within`].
pub(crate) fn try_write_within<T>(custody: &Custody<T>, within: Duration) -> Option<Hold<'_, T>> {
    retry_within(within, || custody.try_write())
}

/// Lettura e scrittura si possono avere entro `within`, ognuna per conto suo.
pub(crate) fn comes_free<T>(custody: &Custody<T>, within: Duration) -> bool {
    let deadline = Instant::now() + within;
    try_read_within(custody, within).is_some()
        && try_write_within(custody, deadline.saturating_duration_since(Instant::now())).is_some()
}

fn retry_within<G>(within: Duration, mut attempt: impl FnMut() -> Option<G>) -> Option<G> {
    let deadline = Instant::now() + within;
    loop {
        if let Some(guard) = attempt() {
            return Some(guard);
        }
        if Instant::now() >= deadline {
            return None;
        }
        std::thread::sleep(Duration::from_millis(1));
    }
}
