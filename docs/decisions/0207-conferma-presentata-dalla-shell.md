# 0207 — La domanda sì/no passa da una porta, e chi non risponde ha detto no

- **Stato:** accolta
- **Data:** 2026-10-12
- **Ambito:** frontend
- **Sostituisce:** —
- **Sostituita da:** —

## Contesto

Ogni conferma della shell era `confirm` di `host/dialog.ts`, cioè il dialogo del
sistema operativo. Una shell che disegna le proprie superfici vuole porre la
domanda dentro la finestra.

Chi domanda fa qualcosa col «sì» — cestina, scarta un buffer, azzera un profilo
— e niente col «no». Sostituire chi risponde senza fissare cosa vale un guasto
permetterebbe a una superficie che non si apre di diventare un consenso, o di
lasciare un documento sospeso in attesa di una risposta che non arriva.

## Decisione

La domanda sì/no passa da `platform/confirm.ts`, con la stessa firma di prima.
È l'unico modulo che chiede la conferma al sistema.

Senza presentatore dichiarato la porta è trasparente: risponde il dialogo di
sistema, rifiuti compresi.

Una shell dichiara il proprio presentatore con `declareConfirm`. Da quel
momento:

- solo `true` è un sì;
- rifiuto, eccezione, valore diverso, Esc, clic sul velo e chiusura della vita
  della domanda valgono «no», e la promessa non rigetta;
- ritirare il presentatore risponde «no» a tutte le sue domande, anche a quelle
  in attesa;
- le domande si mostrano una alla volta, nell'ordine di arrivo;
- non si ripiega sul dialogo di sistema.

Anche chi domanda tratta il rifiuto come «no»: una domanda che non si riesce a
porre non lascia un'operazione a metà.

## Conseguenze

### Positive

- Nessun chiamante sa chi risponde, né deve prevedere il guasto di una
  superficie.
- Il ramo distruttivo richiede sempre una risposta esplicita.
- La shell di serie non cambia comportamento.

### Negative

- Con un presentatore dichiarato il guasto della superficie è silenzioso: chi
  domanda riceve «no» e non una ragione.
- Una shell che dichiara un presentatore risponde di accessibilità e fuoco della
  domanda, che prima erano del sistema.

## Alternative scartate

### Ogni pannello disegna la propria domanda

Ogni chiamante avrebbe dovuto ripetere la regola del «no» e la fila. È la
situazione che la porta unica evita.

### Ripiegare sul dialogo di sistema se il presentatore fallisce

Chi ha già visto la domanda nella finestra se ne troverebbe una seconda, e una
risposta data alla prima andrebbe persa.

## Verifica

- `apps/client/src/platform/confirm.test.ts` prova trasparenza, regola del
  «no», fila, ritiro e che la porta sia l'unica a chiedere al sistema.
- `apps/client/src/shells/scrittoio/confirm.test.ts` prova la superficie.
- `apps/client/src/panels/trash.test.ts` prova che un rifiuto ritira la
  cancellazione pendente.
