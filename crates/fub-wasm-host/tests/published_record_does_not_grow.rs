//! Un record pubblicato non cresce (ADR 0235).
//!
//! Il guest `esempi/manifest-prima-di-k1` è un plugin compilato contro
//! `fub:abi@0.2.0` com'era prima della #285: il suo `plugin-manifest` ha undici
//! campi, quello dell'host ne ha sedici, con i cinque di K1 in coda. Nel
//! component model il tipo di un record si controlla campo per campo, e un
//! campo in coda non è additivo: l'host non istanzia il componente.
//!
//! È il comportamento voluto finché 0.2.0 non è pubblicata, quando il manifest
//! poteva ancora crescere senza rompere nessuno. Dal primo rilascio la regola è
//! quella dell'ADR 0235: i record di una versione pubblicata restano fermi, e
//! le novità arrivano con interfacce nuove. Se questo test diventa verde nel
//! senso opposto, cioè il guest si carica, l'ADR va riletta prima del test.

mod common;

use fub_kernel::Trust;
use fub_wasm_host::WasmBundle;

#[test]
fn a_plugin_built_before_k1_is_refused_because_the_manifest_grew() {
    let wasm = common::component("manifest-prima-di-k1", "manifest_prima_di_k1", "");
    let error = WasmBundle::from_file(&wasm, Trust::Community)
        .expect_err("il manifest a undici campi non è più quello dell'host");
    let message = format!("{error:?} {error}");
    assert!(
        message.contains("expected record of 16 fields, found 11 fields"),
        "il rifiuto nomina il record cresciuto, non un altro guasto: {message}"
    );
}
