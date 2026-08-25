# Problemi comuni

## `cargo tauri` non esiste

Installa Tauri CLI 2:

```bash
cargo install tauri-cli --version '^2' --locked
```

## Il frontend non parte o manca un pacchetto

Ripristina esattamente il lockfile:

```bash
rm -rf frontend/node_modules
npm --prefix frontend ci
```

Su PowerShell elimina `frontend/node_modules` e poi esegui lo stesso `npm --prefix frontend ci`.

## Errore WebKit o GTK su Linux

Installa le dipendenze elencate in [installazione e avvio](installazione-e-avvio.md). I nomi corrispondono a quelli usati dalla CI Ubuntu.

## Il vault non si apre

Controlla, nell'ordine:

1. che il percorso sia assoluto e la cartella esista;
2. che l'utente possa leggerla e scriverci;
3. che non sia già in uso da un'altra istanza;
4. che il problema non riguardi un singolo file illeggibile;
5. che ci sia spazio libero sufficiente per indici, bozze e operazioni atomiche.

Copia il vault prima di modificare `.fub/` manualmente.

## La ricerca non trova tutto

Verifica che l'indicizzazione sia terminata. Durante l'apertura a fasi la ricerca può essere parziale e deve indicarlo. Un indice ricostruibile può essere rigenerato attraverso gli strumenti di manutenzione; non eliminare indiscriminatamente `.fub/data/`.

## Un file è cambiato fuori da Fub

Non forzare il salvataggio se la shell segnala un conflitto. Conserva la versione sul disco e quella nel buffer, quindi confrontale. Le bozze esistono proprio per evitare che una chiusura o un errore trasformino il conflitto in perdita silenziosa.

## Un controllo della documentazione fallisce

Esegui dalla radice:

```bash
node .github/scripts/check-doc-links.mjs
node .github/scripts/check-prose.mjs
node .github/scripts/check-tables.mjs
```

I documenti storici possono descrivere nomi ormai superati; le guide correnti invece devono puntare sempre a percorsi esistenti.