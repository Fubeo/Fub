# Trait del contratto

I trait Rust canonici vivono in `crates/fub-abi/src/`. Questa pagina è il punto d'ingresso architetturale; la descrizione completa è in [`06-contratto/01-i-trait-in-rust.md`](../06-contratto/01-i-trait-in-rust.md).

Le regole da ricordare sono:

- un trait descrive una capacità del provider, non una tecnologia concreta;
- i tipi che attraversano il confine devono avere una rappresentazione IPC e WIT coerente;
- il kernel dipende dai trait, non dai provider concreti;
- `HostApi` è il varco controllato verso i servizi dell'host;
- aggiungere o cambiare una firma richiede aggiornare Rust, WIT, mirror e test di conformità nello stesso cambiamento.

Il test `crates/fub-abi/tests/wit_conformance.rs` verifica che il contratto Rust e quello WIT continuino a descrivere la stessa superficie.