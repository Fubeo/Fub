# Layout su disco

> **Stato:** implementato  
> **Fonte di verità:** moduli di persistenza e test degli schemi

```text
vault/
├── note.md
├── allegati/
├── .fub/
│   ├── settings...
│   ├── workspace...
│   ├── journal...
│   ├── drafts...
│   └── data/
│       ├── entries...
│       ├── diagnostics...
│       └── plugins/
└── .trash/
```

I nomi concreti e le versioni degli schemi sono definiti nel codice. Questo documento descrive categorie e garanzie, non replica manualmente un censimento che può invecchiare.

## Categorie

| Posizione | Autorità | Politica |
|---|---|---|
| documenti e allegati | utente | mai ricostruiti distruttivamente |
| `.fub/` | vault | migrazione o rifiuto esplicito |
| `.fub/data/` | derivati/componenti | ricostruzione quando dichiarata sicura |
| `.trash/` | rete di sicurezza | ripristino con provenienza quando disponibile |
| configurazione macchina | host | lock e scrittura atomica |

## Versioni di schema

Ogni formato persistente ha una propria versione. Un lettore non interpreta come vecchio un file scritto da una versione futura. I formati derivati possono essere invalidati e ricostruiti; quelli autorevoli richiedono migrazione o rifiuto.

## Portabilità

La rimozione di `.fub/data/` non deve cancellare i contenuti dell'utente. La rimozione indiscriminata di `.fub/` può invece perdere bozze, layout o altre informazioni non ricostruibili.
