# I valori delle impostazioni

> **Domanda:** chi controlla il valore che una persona scrive in una riga delle
> Impostazioni, e che cosa vede quando non va?
> **Fonti autorevoli:** `apps/client/src/panels/settings.ts`,
> `apps/client/src/panels/settings-model.ts`, `apps/client/src/kit/quantity.ts`,
> `apps/client/src/ui/commands.ts`, `crates/fub-host/src/settings.rs`,
> `crates/fub-abi` (`SettingKind::rejects`).
> **Contesto:** [Frontend e IPC](frontend-and-ipc.md) descrive il pannello, le
> righe in volo e il loro aggiornamento; questa pagina descrive solo il
> controllo del valore. Nessun contratto IPC o schema su disco nuovo.

## Il rifiuto in una riga

Un valore che non è quello scritto non parte, e la riga lo dice come un rifiuto
dell'host: il controllo torna al valore salvato, sotto restano il motivo nella
lingua dell'interfaccia e l'input provato (`refuseRow`). Un valore rifiutato non
sovrascrive mai quello salvato. Tornare a scrivere in una riga rifiutata toglie
il motivo di prima.

## Chi controlla che cosa

- **Numeri.** Il campo numerico è un testo letto da `parseSettingNumber`
  (`panels/settings-model.ts`) con la regola dei campi del kit
  (`kit/quantity.ts`: virgola e punto per i decimali, niente separatore delle
  migliaia), non un `input[type=number]`, che in WebKit leggeva «1,5» come 15.
  Si rifiutano il campo vuoto, il testo, un numero non finito o con più di 15
  cifre significative (non resterebbe esatto), uno che nella lingua si
  leggerebbe anche come migliaia (`1,500` in inglese, `1.500` in italiano) e uno
  fuori dagli estremi dello schema, che il kernel verifica comunque
  (`SettingKind::rejects`).
- **Scorciatoie.** Una scorciatoia si riconosce dalla forma della chiave
  (`commandOfKeybindingKey`) e passa da `validateKeybinding` in ogni scheda,
  non solo in quella delle scorciatoie.
- **Forme che la specie `text` non sa dire.** Le controlla l'host prima di
  scrivere (`settings::user_value_problem`, chiamato da
  `set_setting_for_user`): `locale.timezone` dev'essere un fuso del database o
  vuoto, `sync.server_url` e `publish.server_url` un indirizzo che
  `validate_base_url` accetta o vuoti. Il rifiuto è un `BadArgs` già nella
  lingua del vault.
- **Frammenti CSS.** Il motivo per cui un frammento non entra viene dal
  catalogo dell'interfaccia (`describeCssViolations` in `ui/sanitize-css.ts`),
  una volta per violazione, mai in due lingue.
