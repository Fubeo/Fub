//! Il confronto, ultima parte: il world, cioè le famiglie importate e le
//! interfacce esportate.

use super::*;

pub(super) fn world(contract: &mut Wit) {
    // --- il world

    let (imports, exports) = contract
        .worlds
        .get("plugin-world")
        .cloned()
        .expect("world `plugin-world` assente dal WIT");
    // Le quattordici famiglie del §7.1. Il confronto è per contenimento e non
    // per uguaglianza perché fra gli import risolti compaiono anche le
    // interfacce di soli **tipi** che quelle usano (`model`, `errors`, `index`,
    // …): sono dipendenze del grafo, non capacità concesse.
    for family in [
        "host-vault-read",
        "host-vault-write",
        "host-vault-structure",
        "host-data-read",
        "host-data-write",
        "host-env",
        "host-events",
        "host-query",
        "host-commands",
        "host-services",
        "host-network",
        "host-settings-read",
        "host-settings-write",
        "host-view-state-read",
        "host-view-state-write",
        "host-transfer-read",
        "host-transfer-write",
    ] {
        assert!(
            imports.contains(family),
            "`plugin-world` deve importare `{family}`, importa {imports:?}"
        );
    }
    assert!(
        !imports.contains("host-api"),
        "`host-api` è stata divisa nelle quindici famiglie del §7.1: se riappare, \
         è tornata la superficie che si concede per intero o per niente"
    );
    let expected_exports: BTreeSet<String> = [
        "plugin",
        "format",
        "grid-bytes",
        // I due innesti del §3.1 e del §3.2: separati da `format` perché un
        // plugin può implementarne uno senza l'altro — ed è esattamente ciò che
        // «mezzo plugin» significa.
        "syntax",
        "renderer",
        "command",
        "view",
        "index",
        "event-handler",
        "service",
        "importer",
        "exporter",
        "format-links",
        "format-edits",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    assert_eq!(
        exports, expected_exports,
        "interfacce esportate da `plugin-world`"
    );
}
