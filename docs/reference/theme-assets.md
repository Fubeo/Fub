# Caratteri, icone e impostazioni di un tema

> **Ambito:** ciò che un tema `theme-2` può portare oltre ai fogli e alla
> skin: i caratteri, le icone della shell e le impostazioni, con i limiti e i
> controlli che l'host e il loader della shell applicano.
> **Fonti autorevoli:** `crates/fub-host/src/theme.rs`,
> `crates/fub-abi/src/rules/theme_icons.rs`, `apps/client/src/ui/icons.ts`.

Le regole comuni a ogni tema (motori, manifest, `extends`, limiti, mount) sono
in [Temi installati](permissions-and-security.md#temi-installati).

Da `theme-2` un tema può portare i suoi caratteri (`fonts` nel manifest): al
massimo 8 voci, ognuna con `family` (lettere e cifre ASCII, `-` e spazi
singoli, al massimo 64 caratteri, diversa dalle famiglie di serie e dalle
parole chiave del CSS), `file` (`fonts/<nome>.woff2`, un asset del tema),
`weight` da 100 a 900 e `style` `normal` o `italic`. L'host controlla che il
file sia fra gli asset e cominci con la firma `wOF2`, al massimo 2 MiB l'uno e
6 MiB in tutto. `@font-face` resta vietato nel CSS di un tema, perché un `src:`
scritto a mano potrebbe chiamare la rete: le regole le scrive il loader, coi
valori del manifest e l'URL `data:` dell'asset (la CSP ha `font-src data:`), nel
canale `caratteri-tema`, e la pelle usa la famiglia per nome. Cambiato tema, il
canale si svuota.

Da `theme-2` un tema può ridisegnare per nome le icone della shell (`icons` nel
manifest): il nome di un asset JSON accanto al manifest (`<nome>.json`, in
minuscolo, mai `manifest.json`), `{ "<nome>": ["<d>", …] }`. Un tema porta
soltanto i `d` dei tracciati, mai markup: ogni `d` ammette solo i comandi e i
numeri di un tracciato SVG e gli spazi ASCII, quindi niente `<`, virgolette,
`url(` o riferimenti. Al massimo 1024 nomi, 8 tracciati e 4 KiB di tracciati per
nome, 256 KiB per il file. La regola sta in `fub_abi::rules::theme_icons` e la
applica l'host (all'installazione, all'inventario e alla lettura del tema) come
il loader della shell, con lo stesso mirror delle regole; la stessa regola dei
tracciati vale per le icone che i moduli della shell registrano. Il corpo di
ogni `<svg>` la shell lo costruisce da sé, coi soli `d` validati, nel costrutto
di tutte le icone (griglia 24, tratto, `currentColor`), e `ui/icons.ts`
ripassa ogni voce dalla regola prima di disegnarla. Un tema non aggiunge nomi:
un nome che nessuno disegna non rifiuta il tema ma non si vede. Cambiato tema,
o annullata l'anteprima, il set cambia e le icone nella pagina si ridisegnano.

Da `theme-2` un tema può dichiarare impostazioni: al massimo 32, con nome
`a-z`, `0-9`, `-`, etichetta in prosa e specie fra interruttore, numero (con
minimo e massimo) e scelta. L'host le dichiara al registro delle impostazioni
con chiave `<id>:<nome>`, a livello macchina e non scrivibili da programma; il tema non
sceglie chiave né livello. Il client porta il valore corrente sulla radice del
documento come `data-opt-<nome>` e, per i numeri, `--opt-<nome>`.
