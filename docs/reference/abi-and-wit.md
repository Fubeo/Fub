# ABI e WIT

> **Ambito:** contratto condiviso fra core, provider nativi, componenti WASM e
> proiezioni IPC.
> **Fonte autorevole:** `crates/fub-abi/`.

## Sorgenti

| Forma | Percorso | Ruolo |
|---|---|---|
| Rust | `crates/fub-abi/src/` | tipi e trait usati dai crate |
| WIT vivo | `crates/fub-abi/wit/fub/abi.wit` | component model |
| WIT congelato | `crates/fub-abi/wit/frozen/` | baseline di compatibilità |
| TypeScript | `frontend/src/host/contract.ts` | forma serializzata verso la shell |
| enum TS | `frontend/src/host/enums.generated.ts` | derivato dai tipi Rust |

Il package WIT corrente è:

```wit
package fub:abi@0.1.1;
```

## Superficie Rust

`fub-abi` espone famiglie per:

- modello, sorgente, parsing e rendering;
- comandi e undo;
- query e indici;
- view e UI dichiarativa;
- eventi e job;
- import ed export;
- sessione;
- impostazioni, locale e tema;
- servizi host;
- errori, regole e schema;
- capability e manifest.

La radice del crate ri-esporta la superficie pubblica. Un test confronta i tipi
pubblici con l'elenco per impedire esportazioni accidentali o dimenticate.

## Mappatura

| Rust | WIT | TypeScript |
|---|---|---|
| `String` | `string` | `string` |
| `Vec<T>` | `list<T>` | `T[]` |
| `Option<T>` | `option<T>` | `T \| null` quando serializzato |
| struct | `record` | `interface` |
| enum con payload | `variant` | union discriminata |
| enum senza payload | `enum` | union di stringhe generata |
| `BTreeMap<String, Value>` | lista di entry o JSON | `Record<string, unknown>` |
| `usize` di uno span | `u64` | numero controllato o forma IPC dedicata |
| `u64` identità/hash IPC | `u64` nel WIT | stringa via JSON |

La forma TypeScript dipende dalla serializzazione Tauri, non è una trascrizione
meccanica di ogni tipo WIT.

## JSON come escape hatch

WIT non ha una forma JSON libera. Frontmatter, attributi estensibili, argomenti
e storage attraversano alcune interfacce come stringa JSON.

La stringa non autorizza a evitare un tipo stabile. Si usa quando la coda del
dominio è deliberatamente aperta o il valore appartiene al plugin.

## Alberi ricorsivi

WIT non ammette ricorsione diretta. `Block`, `Inline` e `UiNode` diventano
arena:

- lista piatta dei nodi;
- riferimenti `u32`;
- radici esplicite;
- conversione controllata;
- limite di profondità;
- errore su indici fuori range.

La conversione canonica è `fub_abi::arena`.

## Host API

Il world importa le famiglie `host-api`. Un metodo Rust che riceve
`&mut dyn HostApi` non serializza l'oggetto come parametro: il guest usa le
funzioni importate.

Le famiglie vengono linkate in base ai servizi disponibili. Nessuna funzione
host implica accesso diretto a filesystem, rete o orologio.

## Errori

`PluginError` conserva una specie e un messaggio. Le famiglie comprendono
errori come:

- comando o view sconosciuti;
- argomenti errati;
- permesso negato;
- conflitto;
- servizio non disponibile;
- cancellazione;
- non trovato;
- già esistente;
- I/O;
- errore interno.

Un adattatore non stringifica un errore perdendo la variante.

## Compatibilità

L'host accetta:

- stessa major;
- minor del plugin non superiore a quella dell'host.

Gli snapshot congelati rendono meccanica l'additività. Sono incompatibili:

- rimozione o rinomina;
- cambio di tipo;
- cambio d'ordine di campi o casi pubblicati;
- inserimento nel mezzo di una forma congelata;
- spostamento fra interfacce;
- modifica della firma.

Sono compatibili, quando aggiunte in coda o in una nuova superficie:

- nuovo record o alias;
- nuovo caso;
- nuovo campo;
- nuova funzione;
- nuova interfaccia.

La patch non cambia la superficie.

## Verifica

I test pertinenti sono in `crates/fub-abi/tests/` e nei crate che proiettano il
contratto. Una modifica completa verifica:

1. compilazione Rust;
2. conformità WIT;
3. additività frozen;
4. round-trip delle arena;
5. fixture TypeScript;
6. componente WASM reale quando la firma viene eseguita;
7. documentazione e ADR, se la decisione è architetturale.

## Regole di modifica

- definire una volta il tipo condiviso;
- non generare una forma da una sorgente che non può esprimere la stessa
  semantica;
- non aggiornare frozen WIT per far passare una rottura;
- non aggiungere un booleano per ogni futura capacità: usare mappe namespaced
  quando il dominio è aperto;
- mantenere il contratto indipendente da Tauri, Wasmtime e Markdown.
