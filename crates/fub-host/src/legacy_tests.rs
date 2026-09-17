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
mod the_watcher_batch;
mod the_watcher_window;
mod view_provider_stale;
mod watcher_factory_lock;
