# Le porte dei temi

> **Ambito:** i comandi IPC con cui la shell elenca, legge, installa e collega
> i temi, e l'evento del tema collegato: forme, esiti e limiti.
> **Fonti autorevoli:** `crates/fub-host/src/theme.rs`,
> `crates/fub-host/src/theme/`, `crates/fub-host/src/theme_watch.rs`,
> `crates/fub-app/src/lib.rs`, `apps/client/src/host/contract.ts`,
> `apps/client/src/host/ipc.ts`.

Il resto del confine IPC è nel [contratto IPC](ipc-contract.md).

## Leggere i temi

`list_themes` elenca i temi installati che l'host sa consegnare, e
`read_theme` consegna una luce di uno (manifest, foglio, pelle, asset per
nome): il filesystem non attraversa il confine. Il loader della shell
rivalida il fascio; un tema che rifiuta resta fuori dal catalogo, e Aspetto
mostra i motivi così come li scrive `validateThemeBundle`, una riga per
motivo (file, riga:colonna, codice, perché).

## Installare da una cartella

Installare un tema da una cartella sono tre comandi della sola shell
principale, fuori dal thread principale. La webview non passa mai un path, e
nemmeno il titolo della finestra di scelta:

1. `check_theme_folder()` scarta il permesso del controllo di prima, controlla
   `developer.mode` (spento, `permission_denied`: la regola è dell'host), apre
   la finestra nativa di scelta col titolo dell'host, legge la cartella scelta
   senza scrivere niente e risponde `ThemeFolderCheck`, unione col campo
   `outcome`. Una cartella pronta resta nell'host come **la** cartella
   controllata: il permesso, che vale una volta, di installarla;
2. `install_theme_from_folder(replace, digest)`, solo con `developer.mode`
   acceso, installa la cartella controllata se `digest` è l'impronta di quel
   controllo, e consuma il permesso. Una `collision` lo rinnova solo per la
   chiamata con `replace`, una volta;
3. `discard_theme_folder()` scarta il permesso: la persona ha detto «no» a
   «Sostituisci», o il cancello della shell ha rifiutato la cartella. Non
   chiede la modalità sviluppatore.

| `ThemeFolderCheck.outcome` | Campi | Che cosa vuol dire |
|---|---|---|
| `cancelled` | — | la finestra di scelta è stata chiusa |
| `ready` | `folder`, `manifest`, `skin`, `assets`, `lights`, `digest` | la cartella passa le porte dell'host; `folder` è il path scelto, da mostrare; `skin` e `assets` (i byte solo dei caratteri e del set di icone) valgono per ogni luce e viaggiano una volta; `lights` ha un `ThemeFolderLight` per luce dichiarata (`light`, `sheet`, `named` per gli altri asset citati da foglio o pelle); `digest` è l'impronta dei byte. La shell fa girare sui fasci lo stesso cancello del catalogo |
| `refused` | `folder`, `refusal` | la cartella non è un tema installabile; `refusal` (`ThemeFolderRefusal`, col campo `reason`) è uno di `not_a_theme`, `engine {declared}`, `permissions`, `invalid_id {id}`, `series`, `traversal {path}` (relativo alla cartella), `catalog_state {file}` (il puntatore `.fub-current.json` o `.generations`: li scrive solo Fub), `malformed {detail}`. La shell lo dice con le sue parole |

Tutti e tre rispondono `permission_denied` a una finestra che non è la shell
principale, e `internal` se il lavoro fuori dal thread principale si perde.
Per il resto, gli errori di `check_theme_folder` sono `permission_denied`
(modalità spenta), `bad_args` (un path che non è UTF-8), `internal` (la
finestra di scelta non ha risposto), `io` (il disco, leggendo la cartella) e
`conflict` (la cartella è cambiata mentre la si leggeva). Quelli di
`install_theme_from_folder` sono solo `permission_denied` (modalità spenta) e
`unserved` (Fub non ha una cartella per i temi su questo computer): ogni
fermata dell'installazione è un esito di `ThemeFolderInstall`, unione con il
campo `outcome`:

| `outcome` | Campi | Che cosa vuol dire |
|---|---|---|
| `installed` | `id`, `name`, `version`, `replaced` | il tema è installato; `replaced` se ha preso il posto di uno con lo stesso id |
| `collision` | `id`, `name`, `version`, `installed_version` | un id già installato, niente toccato; `installed_version` è `null` se quello installato non si legge (si può sostituire lo stesso) |
| `revoked` | `id`, `name`, `version` | il tema installato con lo stesso id è revocato dal catalogo: una cartella non lo sostituisce (la copia nuova cancellerebbe la revoca), niente toccato |
| `blocked` | `why`, `path`, `installed` | ciò che c'è nella cartella dei temi non si tocca, niente toccato; `installed` dice se è il tema già installato con lo stesso id (che resta com'era) o la cartella dei temi stessa; `why` (`ThemeBlock`) è `pointer` (il tema installato con lo stesso id ha il puntatore del catalogo che non si legge: potrebbe dire «revocato»), `link` (un link simbolico al posto del tema installato o della cartella dei temi) o `layout` (non è una cartella che Fub sa usare); `path` è dove, da mostrare |
| `replace_failed` | `id`, `name`, `version`, `kept`, `error` | con `replace`, il nuovo non è entrato e il vecchio non è tornato al suo nome; `kept` è il nome della cartella, dentro quella dei temi, dove è rimasto (la shell lo dice con le sue parole); `error` (un `PluginError`) è il guasto del disco, per il log e la diagnosi copiata |
| `unreadable` | `side`, `error` | una lettura non è riuscita e niente è scritto: `side` (`ThemeSide`) è `folder` (la cartella scelta, che ha ancora i byte del controllo) o `themes` (la cartella dei temi di Fub); non è un guasto di scrittura; `error` è il guasto così com'è, mai da mostrare |
| `refused` | `refusal` | le porte dell'installazione hanno rifiutato i byte controllati (un `ThemeFolderRefusal`, come sopra); niente scritto |
| `changed` | — | la cartella non ha più i byte del controllo; niente scritto |
| `unchecked` | — | non c'è un controllo con questa impronta: uno più recente ha preso il suo posto, o è già stato usato o scartato; niente scritto |
| `failed` | `cause`, `error` | il disco non ha lasciato scrivere e niente è cambiato (con `replace` il tema installato è com'era); `cause` (`DiskCause`) è `full`, `denied` o `other`; `error` è il guasto così com'è, mai da mostrare |

## Collegare una cartella

Un autore di temi può anche **collegare** la cartella del suo tema invece di
installarla: il tema compare fra quelli installati con la fiducia
`development` e si rimonta a ogni salvataggio. Sono tre comandi della sola
shell principale, fuori dal thread principale, e un evento:

| Comando | Argomenti | Risposta |
|---|---|---|
| `link_theme_folder` | — | `ThemeFolderLink`, unione col campo `outcome`: `cancelled` (la finestra di scelta chiusa), `linked {link}`, `refused {link}` (il collegamento di prima resta) |
| `unlink_theme_folder` | — | niente: l'host dimentica la cartella e smette di guardarla |
| `theme_link` | — | `ThemeLink` o `null` (nessuna cartella collegata, o la modalità sviluppatore spenta) |

Come `check_theme_folder`, `link_theme_folder` controlla `developer.mode`
(spento, `permission_denied`), apre la finestra nativa col titolo dell'host e
legge la cartella scelta con le porte dell'installazione, senza scrivere
niente in `themes/`. La webview non passa né il path né il titolo. Gli altri
errori sono `bad_args` (un path che non è UTF-8) e `internal` (la finestra di
scelta non ha risposto). `unlink_theme_folder` non chiede la modalità
sviluppatore. `ThemeLink` porta `folder` (il path canonico, da mostrare),
`id` e `name` dell'ultimo manifest letto (`null` se non se n'è letto uno),
`changed`, `watched` e lo stato, nel campo `state`. `watched` dice se un
osservatore vivo guarda la cartella: l'host la guarda solo se è `ready`, e
`false` vuol dire che i salvataggi non arrivano (la cartella non era pronta,
o il sistema non ha più osservatori). Aspetto lo dice con cosa fare. La
chiave `developer.theme-folder` non viaggia coi profili di macchina (vedi
[permessi e sicurezza](permissions-and-security.md#temi-installati)). Gli
stati:

| `state` | Campi | Che cosa vuol dire |
|---|---|---|
| `ready` | — | la cartella passa le porte; il tema è fra quelli che `list_themes` elenca, con `trust: "development"`, e `read_theme` lo legge dalla cartella |
| `missing` | — | la cartella non c'è più (tolta o rinominata); il tema non è elencato |
| `refused` | `refusal` | le porte rifiutano la cartella (un `ThemeFolderRefusal`, come sopra: un manifest a metà salvataggio, un link simbolico che esce) |
| `collision` | — | un tema installato ha lo stesso `id`: vince quello installato, il collegato non è elencato |
| `unreadable` | `error` | il disco non lascia leggere; `error` è il guasto così com'è, mai da mostrare |

L'evento `fub://theme-changed`, alla sola finestra principale, porta un
`ThemeLink` dopo ogni salvataggio nella cartella collegata, a raffiche
raccolte (200 ms): `changed` ha i file salvati, relativi alla cartella, al
più otto. La shell rilegge il tema con `list_themes` e `read_theme`, lo passa
dal suo cancello e lo rimonta solo se regge: un fascio rifiutato lascia
l'ultimo buono. Un evento dopo «Scollega» o con la modalità spenta non parte.

## Il catalogo firmato

Il catalogo firmato ha le sue porte (`catalog_install_theme`,
`catalog_update_theme`, `catalog_rollback_theme`, `catalog_revoke_theme`). Le
regole di sicurezza dei temi sono in
[permessi e sicurezza](permissions-and-security.md#temi-installati).
