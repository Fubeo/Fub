# 0235 — Un record pubblicato non cresce

- **Stato:** accolta
- **Data:** 2026-11-01
- **Ambito:** contratto
- **Sostituisce:** —
- **Sostituita da:** —

Precisa l'[ADR 0180](0180-compatibilita-wit-additiva.md), che resta in vigore.

## Contesto

L'ADR 0180 e il riferimento del contratto contavano un campo nuovo in coda a
un record fra le aggiunte compatibili, e l'ADR 0234 ha fatto crescere così
`plugin-manifest` (K1, da undici a sedici campi) nel WIT `0.2.0`.

La prova dice il contrario. L'esempio `ping-wasm` compilato contro il WIT di
prima della #285 (`d235d3f6`) e caricato con `WasmBundle::from_file`
nell'host di dopo non si istanzia: «failed to convert function to given type:
type mismatch with results: expected record of 16 fields, found 11 fields».
Nel component model il tipo di un record si controlla campo per campo, e un
campo in più, anche in coda, è un tipo diverso. Un plugin compilato prima
smette di caricarsi.

Fub non ha ancora un rilascio e non esistono plugin di terzi fuori dal
repository: per `0.2.0` non si rompe niente a nessuno. La regola però va
scritta giusta prima del primo rilascio, perché da lì in poi la promessa
dell'ADR 0180 («plugin più vecchi continuano a funzionare») deve essere vera.

## Decisione

1. **Prima del primo rilascio** `0.2.0` non è pubblicata, e la crescita di K1
   resta: i plugin compilati contro il WIT di prima vanno ricompilati, ed è il
   comportamento voluto.
2. **Da quel rilascio i record di una versione pubblicata sono fermi.** Un
   record che attraversa il confine non riceve campi nuovi, né in coda né
   altrove.
3. **Le novità nei plugin passano da interfacce nuove.** L'host cerca gli
   export una interfaccia alla volta; un plugin che non ha l'interfaccia nuova
   è un plugin vecchio, e l'host prende il default.
4. **Un nuovo caso o una nuova funzione in un'interfaccia esportata dal plugin
   valgono come un campo nuovo** finché un test non prova il contrario: l'host
   controlla con `GuestIndices` il tipo di ogni funzione dell'interfaccia
   esportata. Una funzione nuova in un'interfaccia che l'host offre resta
   compatibile, perché il guest importa solo ciò che usa.

## Conseguenze

### Positive

- la promessa dell'ADR 0180 regge davanti a un plugin compilato davvero, non
  solo davanti al confronto fra due file WIT;
- un plugin vecchio e uno nuovo si distinguono da ciò che esportano, senza
  leggere un numero di versione.

### Negative

- dopo il primo rilascio un dato in più nel manifest o in un altro record
  esportato costa un'interfaccia nuova e il suo default nell'host;
- la guardia `wit_additivity.rs` accetta ancora un campo in fondo a un record:
  finché non la si stringe, la regola sta nel test del componente vero e in
  questa decisione;
- i plugin compilati contro `0.2.0` prima della #285 vanno ricompilati.

## Alternative scartate

### Una versione nuova a ogni campo

Ogni campo farebbe una minor, e l'host dovrebbe servire tutte le forme del
record insieme. Moltiplica le versioni per un dato solo, e non risolve il
punto: il plugin vecchio continua a esportare il record vecchio.

### Un ponte di conversione per ogni versione

È la forma di `crates/fub-wasm-host/src/compat.rs` per `0.1.2`: adattatori
che leggono la forma vecchia e la portano alla nuova. Il caricatore però non
lo cabla, e ogni record cresciuto vorrebbe il suo ponte da scrivere, provare e
tenere per sempre. Un'interfaccia nuova con il default fa lo stesso lavoro
senza una seconda copia del contratto.

## Verifica

`crates/fub-wasm-host/tests/published_record_does_not_grow.rs` compila
`esempi/manifest-prima-di-k1`, un plugin con il manifest a undici campi
copiato dal WIT di `d235d3f6`, e controlla che l'host lo rifiuti nominando il
record («expected record of 16 fields, found 11 fields»).
