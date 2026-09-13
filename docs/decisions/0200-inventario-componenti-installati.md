# 0200 — L'inventario installato è distinto dal runtime e dai dati plugin

- **Stato:** accolta
- **Data:** 2026-09-09
- **Ambito:** storage
- **Sostituisce:** —
- **Sostituita da:** —

## Contesto

Un componente copiato su disco non è necessariamente valido, approvato,
abilitato o montato. La scansione di una directory non conserva queste quattro
distinzioni al riavvio. Una copia interrotta o una seconda versione omonima non
devono diventare un componente selezionato implicitamente.

Lo storage `.fub/plugins/<id>/` può contenere dati autorevoli. Usarlo per gli
eseguibili renderebbe ambigua la rimozione di un plugin e permetterebbe a un
vault di trasportare componenti attivabili dalla macchina che lo apre.

## Decisione

`InstalledPluginStore`, usato dagli host nativi, conserva i componenti in
`wasm-plugins/` sotto la configurazione della macchina passata esplicitamente a
`open`. Le operazioni successive usano la capability aperta e non deducono la
root dal manifest o dai dati del vault.

L'inventario JSON ha schema indipendente, versione 1. Conserva manifest, digest
SHA-256, identità monotona dell'installazione, scelta enabled e consenso
all'esecuzione. Contatore e identità sono stringhe decimali. La fiducia non si
deserializza: ogni componente viene caricato con `Trust::Community`.

Il consenso riguarda gli esatti byte installati. Non è una seconda mappa di
capability: le impostazioni macchina dei permessi e il `Guard` rimangono
l'unica autorità delle operazioni host. Il consenso da solo non concede un
permesso, e enabled da solo non implica un'istanza montata.

L'installazione valida byte, manifest e ABI prima di scrivere. Listing e load
leggono soltanto inventario e blob e verificano il digest; non compilano,
istanziano o chiamano il guest. La validazione attiva resta un'operazione
esplicita e ricontrolla il manifest sugli esatti byte. Lo store pubblica prima
il blob identificato dal contenuto e poi l'inventario tramite compare-and-swap
(CAS) cooperativa. Solo le voci dell'inventario sono installazioni visibili;
temporanei e blob orfani non vengono scoperti o montati. Un errore o conflitto
nella seconda scrittura preserva l'inventario precedente. Non ci sono retry
impliciti.

La rimozione ritira prima la voce e poi elimina il blob di quell'identità. Un
errore di cleanup è restituito separatamente dal commit riuscito. Il contatore
non viene riusato: una reinstallazione non può essere eliminata da un vecchio
cleanup e richiede nuovo consenso. `InstalledPluginStore` non salva né scopre
componenti installati in `.fub/plugins/<id>/` e non cancella quella directory.

`InstalledPluginStore` non possiede né monta istanze. Il chiamante completa il
teardown prima della rimozione e compone il `WasmBundle` attraverso il
`BundleMount` comune; un solo `Guard` applica capability e scope.

## Conseguenze

### Positive

- Un crash non espone un componente parziale come installato.
- Scelte stale non sovrascrivono decisioni concorrenti.
- Il load ricontrolla il digest; la validazione esplicita ricontrolla il manifest.
- La rimozione dell'eseguibile non equivale alla cancellazione dei dati.

### Negative

- Un crash può lasciare un blob orfano, che non viene cancellato
  automaticamente.
- Lo store rifiuta un id già presente, anche con una versione diversa;
  l'aggiornamento richiede un percorso esplicito ulteriore.
- Lo store non coordina le istanze: composition root e lifecycle sono
  responsabili di verificare consenso, enabled, permessi e validità del mount.

## Alternative scartate

### Scansione degli eseguibili come inventario autorevole

Non rappresenta decisioni persistenti, transazioni interrotte o collisioni. La
discovery libera resta un banco di sviluppo, non la fonte di questo store.

### Componente e dati nella stessa directory del vault

Confonde eseguibili e dati autorevoli e trasferisce al vault una decisione che
appartiene alla macchina.

### Sovrascrittura di una versione omonima

Trasferirebbe implicitamente consenso e stato enabled a byte diversi e
renderebbe ambiguo il cleanup di un'istanza precedente.

## Verifica

`crates/fub-wasm-host/tests/installed_inventory.rs` verifica riavvio,
concorrenza, pubblicazione interrotta, corruzione, versioni, consenso,
disabilitazione, rilevamento dei blob alterati e preservazione dei dati alla
rimozione.
