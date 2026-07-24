// Evita una seconda console su Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    fubmd_app_lib::run();
}
