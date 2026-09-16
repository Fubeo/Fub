# Contratto IPC

> **Ambito:** confine JSON fra shell TypeScript e `fub-app`.
> **Fonti autorevoli:** `apps/client/src/host/contract.ts`,
> `apps/client/src/host/ipc.ts`, `crates/fub-app/src/lib.rs`.

## Principio

L'IPC adatta il contratto dell'host alla webview. Non è un secondo dominio e non
contiene policy.

Il frontend usa un'interfaccia host; l'implementazione reale chiama Tauri e i
test usano un fake.

## Famiglie di porte

| Famiglia | Esempi di responsabilità |
|---|---|
| lifecycle | aprire, elencare, selezionare e chiudere vault |
| documenti | leggere, scrivere, rinominare, cestinare e ripristinare |
| bozze | leggere, aggiornare e rimuovere |
| query | interrogare provider di indice |
| comandi | elencare, pianificare, eseguire e annullare |
| view | elencare, rendere, inviare azioni e stato |
| job | elencare, osservare e cancellare |
| impostazioni | schema, valori e scrittura |
| tema | manifest e artefatti della skin |
| eventi | ascolto del canale tipizzato |

Le operazioni offerte da provider passano da porte generiche. Una feature non
aggiunge una porta soltanto per evitare di usare il proprio registro.

## Valutazione del foglio pilota

La shell usa `IndexQuery::Custom` con namespace `fub.sheet`, non una porta Tauri
dedicata. Il payload privato è `{kind: "evaluate", version: 1, source: string}`:
versioni, specie o campi sconosciuti sono `BadArgs`. La risposta è
`IndexResult::Custom` con la forma `SheetEvaluation` del mirror TypeScript.

Il provider verifica il limite sorgente di 16 MiB e misura la risposta JSON,
compreso l'envelope, entro 8 MiB prima di materializzare il valore JSON.
Disabilitare il bundle ritira la route: la query restituisce `Unserved` e la
shell usa il fallback agli input grezzi. Il payload non è il futuro contratto
pubblico grid a finestre.

Le fonti sono `crates/fub-host/src/sheet/index.rs` e
`apps/client/src/host/sheet.ts`. La fixture
`apps/client/src/__fixtures__/sheet-query.json` è generata dal test host reale
e consumata dai test TypeScript. Nessun interprete formule vive nel fake host.

## Tipi principali

La shell riceve forme per:

- `VaultInfo` e `OpenVaults`;
- documenti, revisioni e report di edit;
- query e risultati paginati;
- specifiche ed esiti dei comandi;
- view, `UiNode` e azioni;
- plugin, fiducia, permessi e registrazioni;
- job e progresso;
- impostazioni;
- eventi;
- errori tipizzati.

Gli enum senza payload sono generati. Le union con payload mantengono un
discriminante stabile.

## `u64`

JSON usa numeri IEEE-754. Un `u64` che rappresenta identità, hash o revisione
attraversa il confine come stringa.

```text
Rust u64 -> stringa JSON -> TypeScript string
```

Non convertire quella stringa in `number` per comodità. Confrontala come
identità o usa una conversione controllata quando il dominio la consente.

Timestamp in millisecondi possono restare `number` perché il loro intervallo
utile è sotto il limite esatto e la shell li usa con `Date`.

## Errori

La forma conserva:

```text
kind + message
```

La shell decide il comportamento da `kind`. `message` è presentabile e può
essere localizzato, ma non viene analizzato con sottostringhe.

Un errore Rust non attraversa il confine come debug string o stack trace.

## Eventi

Gli eventi IPC sono fatti già accaduti. Contengono almeno:

- specie;
- origine;
- soggetto;
- batch, quando presente;
- payload tipizzato;
- severità per gli avvisi.

Una coda può compattare progresso o notifiche ripetute. Il risultato autorevole
di un'operazione resta nella sua risposta.

## View

Il protocollo di view usa:

- id della view;
- contesto e interessi;
- stato per istanza;
- `UiNode`;
- azioni con payload opaco;
- update completo o incrementale quando il contratto lo prevede.

La shell non interpreta il payload di un'azione. Lo rimanda al provider
proprietario.

## Percorsi

Il frontend invia path relativi o root di vault secondo la porta. Le regole di
canonicalizzazione e recinzione vivono nel core.

Non accettare un path assoluto in una porta generica per evitare la verifica del
vault.

## Import Tauri

Sono consentiti soltanto:

- `apps/client/src/host/ipc.ts`;
- `apps/client/src/host/dialog.ts`.

Ogni altro modulo importa l'interfaccia host.

## Compatibilità

Un cambio IPC richiede:

1. tipo Rust serializzabile;
2. fixture;
3. mirror TypeScript;
4. test di conformità;
5. aggiornamento del fake host;
6. test del flusso nella shell;
7. strategia per campi assenti se deve leggere una forma precedente.

## Porte da evitare

- un comando per ogni query;
- payload `unknown` quando il dominio è chiuso;
- stringhe che codificano errori;
- callback o oggetti DOM;
- path di filesystem non recintati;
- duplicazione di regole già in `fub-abi`;
- accesso diretto a `invoke` da un pannello.
