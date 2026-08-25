# Documentazione di Fub

Questa cartella ha una sola porta d'ingresso e separa nettamente comportamento corrente, riferimento tecnico, specifiche future e storia del progetto.

## Inizia qui

- [Leggimi prima](leggimi-prima.md): come interpretare i documenti.
- [Stato del progetto](STATO.md): cosa è verificato nel codice e cosa non lo è.
- [Guida pratica](guida/README.md): installazione, avvio, uso e recupero.

## Capire il sistema

- [Architettura](architecture/README.md)
- [Contratto](06-contratto/README.md)
- [Frontend e shell](frontend/README.md)
- [Riferimento tecnico](riferimento/README.md)
- [Grafo dei crate verificato](03-uml/README.md)

## Prodotto e pianificazione

- [Specifiche delle funzionalità](features/README.md)
- [Microfunzionalità](microfeatures/README.md)
- [Personas](personas/README.md)
- [Milestone](milestones/README.md)
- [Roadmap](roadmap/README.md)
- [Piano del progetto](PIANO.md)

Queste sezioni non dimostrano da sole che una funzione sia disponibile. La fotografia corrente resta [`STATO.md`](STATO.md).

## Processo e storia

- [Contribuire](CONTRIBUTING.md)
- [Sicurezza](SECURITY.md)
- [Versionamento](versionamento.md)
- [Changelog](CHANGELOG.md)
- [Registro tecnico e voci aperte](todo.md)
- [Decisioni](decisions/README.md), inclusi i **dieci** buchi dichiarati <!-- [conta: buchi-dichiarati] -->
- [Codice di condotta](CODE_OF_CONDUCT.md)

## Regole della documentazione

1. Ogni argomento corrente ha una pagina canonica.
2. Gli altri documenti rimandano a quella pagina invece di riscriverla.
3. Una specifica descrive ciò che è richiesto; `STATO.md` descrive ciò che è verificato.
4. Un piano dichiara esplicitamente di non essere ancora comportamento disponibile.
5. I verbali conservano il contesto storico e non vengono corretti fingendo che siano stati scritti oggi.
6. I link, le affermazioni numeriche collegate ai sorgenti e le tabelle sono controllati dalla CI.

Prima di aggiungere un file nuovo, verifica che non basti aggiornare una pagina esistente.