# Sicurezza

## Segnalare una vulnerabilità

Non aprire una issue pubblica.

Usa, in ordine:

1. [GitHub Security Advisories](https://github.com/Fubeo/Fub/security/advisories/new);
2. `fabio99marchetti@gmail.com`.

Includi il percorso di riproduzione, la versione o il commit, il sistema
operativo, l'impatto e, quando possibile, un proof of concept minimo.

## Tempi attesi

Fub ha un solo manutentore e non offre un SLA.

| Passo | Aspettativa |
|---|---|
| Primo riscontro | entro 7 giorni |
| Valutazione | entro 30 giorni |
| Correzione confermata | prima del rilascio successivo |
| Divulgazione | dopo la correzione, concordata con chi segnala |

## Versioni supportate

Fub non ha ancora pubblicato un rilascio stabile. La linea presidiata è `main`.

## Perimetro

Sono nel perimetro:

- contenuti del vault usati come input non fidato;
- letture o scritture fuori dalla radice del vault;
- perdita silenziosa dei dati dell'utente;
- esecuzione di script o aggiramento della CSP nella webview;
- comandi IPC che superano il proprio contratto;
- bypass delle capability dei plugin;
- fuga dal runtime WASM o accesso a risorse non concesse;
- dipendenze compromesse o policy della supply chain aggirate.

Non è una vulnerabilità il comportamento di codice nativo che l'utente ha
scelto di compilare ed eseguire, salvo che violi uno dei confini sopra.

## Presidi

- `deny.toml` e il job di supply chain controllano advisory, sorgenti e licenze;
- la CI produce una SBOM;
- la webview usa una Content Security Policy restrittiva;
- `fub-kernel` applica le capability tramite un solo `Guard`;
- il WIT è congelato e verificato per additività;
- il runtime WASM non collega WASI e impone limiti di tempo e memoria;
- path, revisioni e scritture atomiche hanno test dedicati.

L'architettura di sicurezza è descritta in
[`docs/reference/permissions-and-security.md`](docs/reference/permissions-and-security.md).
