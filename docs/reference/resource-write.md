# Depositare un file

> **Ambito:** il comando `resource_write`, con cui la shell deposita un file
> nel vault: il corpo, la testata, il riuso di un file con lo stesso
> contenuto, la ricevuta e gli errori.
> **Fonti autorevoli:** `crates/fub-app/src/resources.rs`
> (`resource_write_body`) e `crates/fub-app/src/lib.rs` (`resource_write`);
> lato shell `writeResource` in `apps/client/src/host/ipc.ts`; lo scenario
> `apps/client/src/__fixtures__/resource-write-scenario.json`.

Il resto del canale fra la shell e l'host sta in
[Il contratto IPC](ipc-contract.md).

## Il comando

`resource_write` deposita byte grezzi: il corpo sono i byte (`Uint8Array`, mai
JSON o base64), i parametri stanno nella testata `x-fub-resource-write` (JSON
in `encodeURIComponent`, al più 16 KiB): `id`, `vault` (`null` = il corrente),
`expected` obbligatorio (`null` crea soltanto, una stringa è il CAS sulla
revisione) e `reuse`, facoltativo. Un campo in più, un tipo sbagliato o un
`reuse` diverso da `"same-content"` è `bad_args` prima del disco; `reuse` con
`expected` dato pure. Senza `reuse` il deposito è quello di sempre.

Con `reuse: "same-content"` l'host cerca un file del vault con la stessa
estensione di `id` ed esattamente questi byte, mai per un contenuto vuoto
([Lo stesso contenuto](../architecture/storage-and-identity.md)), e
ricontrolla che ci sia ancora: allora non scrive niente. Se non c'è, o se non
sa rispondere, scrive: nel dubbio si deposita. La lavagna (`depositOrReuse`)
chiede il riuso solo col primo nome; dopo un `already_exists` i nomi seguenti
sono scritture semplici, senza rifare la ricerca. La ricevuta
(`ResourceWriteReceipt`) porta `id` e `revision` del file scritto, o di quello
che c'era, e `reused` (vero solo se non si è scritto; assente in una ricevuta
di prima = `false`). Gli errori sono quelli di una scrittura (`already_exists`,
`conflict`, `permission_denied`, `host.xlsx.readonly`); oltre 64 MiB è `io`,
prima di leggere la testata, e 64 MiB esatti passano. Un host di prima
rifiuta `reuse` con `bad_args`: `writeResource` lo prende come «non so» e
deposita senza. Lo scenario `__fixtures__/resource-write-scenario.json`,
registrato sull'host vero, lega l'host finto alle stesse risposte.
