//! Ponte `fub:abi@0.1.2`: adattatori presenti, caricatore non cablato.
//!
//! Il guest dedicato (`esempi/legacy-format-0_1`) resta il caso di prova, ma
//! `Component::load` cerca solo gli export `fub:abi/<famiglia>@0.2.0`: il
//! caricamento cade con `NotAPlugin("no exported instance named
//! `fub:abi/plugin@0.2.0`")` e l'installazione non parte. Questi test lo
//! fissano come comportamento osservato, finché il ponte non verrà cablato
//! nel caricatore. Il manifest futuro (`99.0.0`, via feature
//! `abi-incompatibile` esistente) resta rifiutato `Abi`.

mod common;

use camino::Utf8PathBuf;

use fub_kernel::Trust;
use fub_wasm_host::WasmBundle;
/// Il guest dedicato pinnato a `0.1.2`, compilato adesso come ogni altro
/// esempio: `artifact` è il nome del `cdylib` (`legacy_format_0_1`).
fn legacy_component() -> Utf8PathBuf {
    common::component("legacy-format-0_1", "legacy_format_0_1", "")
}

#[test]
fn legacy_guest_stays_unloaded_until_loader_probes_compat_exports() {
    let wasm = legacy_component();
    let error = WasmBundle::from_file(&wasm, Trust::Community)
        .expect_err("il guest 0.1.2 non passa il caricatore 0.2.0");
    assert!(
        matches!(error, fub_wasm_host::LoadError::NotAPlugin(_)),
        "il rifiuto è NotAPlugin, non Abi: {error:?}"
    );
    assert!(
        error.to_string().contains("fub:abi/plugin@0.2.0"),
        "il messaggio nomina l'export cercato e assente: {error}"
    );
}

#[test]
fn legacy_install_never_starts_without_a_loaded_bundle() {
    let wasm = legacy_component();
    assert!(
        WasmBundle::from_file(&wasm, Trust::Community).is_err(),
        "senza bundle caricato non esiste manifest, provider né installazione"
    );
}

#[test]
fn legacy_format_routes_stay_unserved_without_a_loaded_provider() {
    let wasm = legacy_component();
    assert!(
        WasmBundle::from_file(&wasm, Trust::Community).is_err(),
        "parse/render/serialize e format-links restano non serviti finché il caricatore non fa probing compat"
    );
}

#[test]
fn future_manifest_stays_rejected_as_abi() {
    let dir = tempfile::tempdir().unwrap();
    let config = camino::Utf8Path::from_path(dir.path()).unwrap();
    let store = fub_wasm_host::installed::InstalledPluginStore::open(config).unwrap();
    assert!(matches!(
        store.install(
            &store.snapshot().unwrap(),
            &common::component("ping-wasm", "ping_wasm", "abi-incompatibile"),
        ),
        Err(fub_wasm_host::installed::InstallError::Abi(_))
    ));
}
