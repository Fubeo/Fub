# 0200 — L'inventario installato è distinto dal runtime e dai dati plugin

- **Stato:** accolta
- **Data:** 2026-09-09
- **Ambito:** host, storage, sicurezza
- **Sostituisce:** —
- **Sostituita da:** —

## Contesto

Un componente copiato su disco non è necessariamente valido, approvato,
abilitato o montato. La scansione di una directory non conserva queste
quattro distinzioni al riavvio. Una copia interrotta o una seconda versione
omonima non devono diventare un componente selezionato implicitamente.

Lo storage `.fub/plugins/<id>/` può contenere dati autorevoli. Usarlo per gli
eseguibili renderebbe ambigua la rimozione di un plugin e permetterebbe a un
vault di trasportare componenti attivabili dalla macchina che lo apre.

## Decisione

La shell sceglie la configurazione della macchina. `InstalledPluginStore`
usato dagli host nativi conserva i componenti in `wasm-plugins/` sotto quella
configurazione. Il bootstrap apre una capability; le operazioni successive
non riaprono la root tramite il nome ambientale.

L'inventario JSON ha schema indipendente, versione 1. Conserva manifest,
digest SHA-256, identità monotona dell'installazione, scelta enabled e
consenso all'esecuzione. Contatore e identità sono stringhe decimali.
La fiducia non si deserializza: ogni componente riceve `Trust::Community`.

Il consenso riguarda gli esatti byte installati. Non è una seconda mappa di
capability: le impostazioni macchina dei permessi e il `Guard` rimangono
l'unica autorità delle operazioni host. Il consenso da solo non concede un
permesso, e enabled da solo non implica un'istanza montata.

L'installazione valida i byte, il manifest e l'ABI prima di scrivere. Pubblica
prima il blob immutabile e poi l'inventario tramite CAS cooperativa. Solo le
voci dell'inventario sono installazioni visibili; temporanei e blob orfani
non vengono scoperti o montati. Un errore o conflitto nella seconda scrittura
preserva l'inventario precedente. Non ci sono retry impliciti.

La rimozione ritira prima la voce e poi elimina il blob di quell'identità.
Un errore di cleanup è restituito separatamente dal commit riuscito. Il
contatore non viene riusato: una reinstallazione non può essere eliminata da
un vecchio cleanup e richiede nuovo consenso. I dati del vault restano intatti.
Il chiamante deve completare il teardown prima della rimozione.

## Conseguenze

### Positive

- Un crash non espone un componente parziale come installato.
- Scelte stale non sovrascrivono decisioni concorrenti.
- Digest e manifest vengono ricontrollati sugli esatti byte prima del load.
- La rimozione dell'eseguibile non equivale alla cancellazione dei dati.

### Negative

- Un crash può lasciare un blob orfano, che non viene cancellato automaticamente.
- Lo store rifiuta un id già presente, anche con una versione diversa;
  l'aggiornamento richiede un percorso esplicito ulteriore.
- Lo store non coordina le istanze: composition root e lifecycle devono
  verificare ancora consenso, enabled, permessi e validità del mount.

## Alternative scartate

### Scansione degli eseguibili come inventario autorevole

Non rappresenta decisioni persistenti, transazioni interrotte o collisioni.
La discovery libera resta un banco di sviluppo, non la fonte di questo store.

### Componente e dati nella stessa directory del vault

Confonde eseguibili e dati autorevoli e trasferisce al vault una decisione
che appartiene alla macchina.

### Sovrascrittura di una versione omonima

Trasferirebbe implicitamente consenso e stato enabled a byte diversi e
renderebbe ambiguo il cleanup di un'istanza precedente.

## Verifica

`crates/fub-wasm-host/tests/installed_inventory.rs` usa componenti compilati
dai sorgenti, due istanze indipendenti dello store e guasti reali filesystem.
Verifica riavvio, concorrenza, pubblicazione interrotta, corruzione, versioni,
consenso, disabilitazione e preservazione dei dati alla rimozione.
