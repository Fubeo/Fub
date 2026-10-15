# 0203 — Un tema dichiara il proprio motore e, da `theme-2`, le proprie impostazioni

- **Stato:** accolta
- **Data:** 2026-10-12
- **Ambito:** contratto
- **Sostituisce:** —
- **Sostituita da:** —

## Contesto

`theme-1` è un contratto congelato fra una pelle e una shell: nomina
un'anatomia di hook e un vocabolario CSS. Una shell con un'altra anatomia non
può essere vestita da una pelle `theme-1`, e allargare `theme-1` per adattarlo
romperebbe i temi che lo rispettano.

Un tema era inoltre una pelle senza scelte: chi lo scriveva non poteva lasciare
a chi lo usa una variante, e l'unico modo per offrirne una era pubblicare un
secondo tema.

## Decisione

`ThemeEngine` conosce due motori, `theme-1` e `theme-2`. `theme-1` non cambia.

L'host **trasporta** ogni motore conosciuto: installa, elenca, legge e
distribuisce dal catalogo i temi di entrambi. Un motore sconosciuto è respinto
per nome prima di toccare il disco. Una voce del catalogo deve dichiarare lo
stesso motore del manifest che consegna.

Quale motore si possa **vestire** lo decide la shell, che è l'unica ad avere
un'anatomia: la serie che dichiara porta un profilo, e il loader rifiuta con una
diagnosi un tema di un altro motore e ricade sulla serie. Un tema `theme-1` non
viene convertito.

Da `theme-2` il manifest può dichiarare `settings`: al massimo 32 voci, ciascuna
con un nome (`a-z`, `0-9`, `-`), un'etichetta in prosa e una specie fra
interruttore, numero e scelta. Un numero dichiara minimo e massimo: chi usa il
tema lo regola con un cursore. L'host le valida alla lettura del manifest; un
tema che dichiara male non si installa.

Le impostazioni di un tema non hanno una porta propria. Il bundle del tema le
porta nel proprio `PluginManifest`, e l'host aggiunge ciò che l'autore non
decide: la chiave `<id>:<nome>`, il livello macchina, il gruppo col nome del
tema, il divieto di scrittura da programma. Da lì sono impostazioni come le
altre: stessa lettura, stessa scrittura, stesso evento.

Il client scrive il valore corrente sulla radice del documento: `data-opt-<nome>`
per ogni voce e, per i numeri, anche la proprietà `--opt-<nome>`. Cambiato tema
non resta niente del precedente.

Un manifest senza impostazioni non serializza il campo: la forma sul filo dei
temi esistenti resta identica.

## Conseguenze

### Positive

- `theme-1` e i temi che lo rispettano restano validi al byte.
- Le impostazioni dei temi riusano registro, schema, evento e IPC esistenti.
- Un tema non può nominare una chiave fuori dal proprio id né scegliere il
  livello in cui vive il valore.

### Negative

- I bundle si montano dentro una sessione di vault: senza vault aperto le
  impostazioni di un tema valgono il default e non si possono scrivere.
- Un tema `theme-1` non veste una shell che dichiara `theme-2`, e viceversa.
- Il valore scelto resta nelle impostazioni della macchina anche dopo la
  disinstallazione del tema; senza schema non viene letto.

## Alternative scartate

### Allargare `theme-1`

Avrebbe evitato un secondo motore. È stata scartata perché anatomia e
vocabolario sono il contratto: cambiarli sotto lo stesso nome rende invalidi
temi che passano il gate.

### Una porta IPC per le impostazioni dei temi

Avrebbe permesso di leggerle senza vault. È stata scartata perché duplica
schema, validazione, persistenza ed evento del registro delle impostazioni.

### `SettingSpec` nel manifest così com'è

Avrebbe evitato un tipo. È stata scartata perché lascerebbe all'autore chiave,
livello e scrivibilità da programma, cioè tre campi che l'host deve comunque
rifiutare o riscrivere.

### Convertire i temi `theme-1`

Una pelle nomina hook che nell'altra anatomia non esistono: una conversione
automatica produrrebbe un tema che passa il gate e veste male.

## Verifica

- `crates/fub-abi/src/theme.rs` fissa i nomi dei motori e la forma sul filo.
- `crates/fub-host/tests/themes.rs` prova motore sconosciuto, `theme-2`,
  impostazioni come righe del registro e manifest non dichiarabili.
- `crates/fub-wasm-host/tests/catalog_signed.rs` prova la coerenza fra voce e
  manifest.
- `apps/client/src/theme/options.test.ts` e `runtime.test.ts` provano la
  risoluzione dei valori e la scrittura sulla radice.
