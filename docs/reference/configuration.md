# Configurazione

> **Stato:** implementato  
> **Fonte di verità:** registri delle impostazioni del kernel e della shell

Le impostazioni hanno scope diversi perché seguono vite diverse.

## Precedenza

```mermaid
flowchart LR
    Default["Default dichiarato"] --> Machine["Valore macchina"]
    Machine --> Vault["Valore vault"]
    Vault --> Effective["Valore effettivo"]
```

La precedenza esatta dipende dalla chiave dichiarata; una chiave non può essere letta o scritta in uno scope che il suo descrittore non consente.

## Scope

| Scope | Esempi |
|---|---|
| Default | valore del componente |
| Vault | impostazioni che viaggiano con il vault |
| Macchina | tema scelto, vault conosciuti, preferenze locali |
| Vista | scroll, zoom e stato di un esemplare |
| Documento | stato associato all'identità del documento |

## Regole

- la chiave è dichiarata da un owner;
- tipo, default e scope sono espliciti;
- disattivare l'owner rimuove la registrazione, non i dati dell'utente senza consenso;
- la shell non mantiene copie concorrenti di valori autorevoli del kernel;
- una preferenza visuale non viene confusa con struttura del vault;
- il valore effettivo è leggibile senza conoscere il file fisico che lo conserva.

Le variabili d'ambiente usate dai test non sono impostazioni del prodotto.
