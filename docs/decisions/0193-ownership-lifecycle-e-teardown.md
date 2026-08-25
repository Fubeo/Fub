# 0193 — Ogni registrazione ha un owner e un teardown

- **Stato:** accolta
- **Data:** 2026-08-25
- **Ambito:** host
- **Sostituisce:** 0133–0134, 0139, 0141
- **Sostituita da:** —

## Contesto

Listener, timer, observer, registrazioni, watcher e istanze possono
sopravvivere al componente che li ha creati. Pulire mappe globali per nome o
affidarsi alla fine del processo nasconde leak e collisioni. Race concorrenti
senza cancellazione applicano risultati vecchi.

## Decisione

L'owner che registra una risorsa riceve o conserva il disposer. Bundle,
sessioni e superfici aggregano i propri disposer e li eseguono in ordine allo
smontaggio. Listener globali passano da un oggetto lifecycle. Le race usano un
primitivo che rende esplicito quale esecuzione è ancora valida. Lo shutdown
chiude dall'esterno verso l'interno.

## Conseguenze

### Positive

- mount e unmount sono ripetibili;
- leak e collisioni hanno un responsabile;
- risultati obsoleti non sovrascrivono lo stato nuovo;

### Negative

- ogni registrazione deve propagare ownership;
- il teardown può essere fallibile e richiede policy;
- test e API devono rendere visibile la vita delle risorse;

## Alternative scartate

### Cleanup globale

Può rimuovere risorse di un altro bundle.

### Garbage collection implicita

Non rimuove listener, timer o registri nativi.

### Ultima risposta vince

Una richiesta lenta può sovrascrivere una più recente.

## Verifica

Guard frontend impediscono listener globali nudi e attese concorrenti non
custodite. Test ripetono mount/destroy e verificano registri, timer e handler.
