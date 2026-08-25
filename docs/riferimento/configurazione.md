# Configurazione

## Configurazione di build

| File | Scopo |
|---|---|
| `Cargo.toml` | membri del workspace, versioni comuni, MSRV e profili |
| `crates/fub-app/tauri.conf.json` | finestra, CSP, comandi frontend e bundling Tauri |
| `frontend/package.json` | dipendenze e comandi della shell |
| `frontend/package-lock.json` | risoluzione riproducibile delle dipendenze npm |
| `deny.toml` | licenze, advisory e provenienza delle dipendenze Rust |
| `.github/workflows/ci.yml` | piattaforme e verifiche eseguite dal progetto |

## Variabile applicativa documentata

### `FUB_VAULT`

Percorso assoluto del vault da aprire all'avvio in sviluppo.

```bash
FUB_VAULT="/percorso/del/vault" \
  cargo tauri dev --config crates/fub-app/tauri.conf.json
```

Non è un formato di configurazione persistente e non sostituisce il registro dei vault.

## Variabili di test

Le variabili `FUB_FUZZ_*` citate in [`CONTRIBUTING.md`](../CONTRIBUTING.md) aumentano il numero di casi dei test. Non configurano l'applicazione.

## Impostazioni persistenti

Le impostazioni del programma e del vault passano attraverso i tipi e gli store del kernel. Non modificare manualmente i file sotto `.fub/` senza una copia completa: sono versionati e possono contenere stato non ricostruibile.

## Segreti

Il repository non richiede token o account per usare l'applicazione locale. Segreti di sviluppo non devono essere inseriti nei manifest, nei documenti o nel vault di esempio.