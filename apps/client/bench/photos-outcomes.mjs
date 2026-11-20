// **Gli esiti del fotografo**, la parte pura di `photos.mjs`: che cosa è
// successo a una foto, quando si scatta una seconda volta, come si sommano i
// due scatti e che cosa dice il riepilogo. Sta qui perché il presidio
// (`photos-outcomes.test.ts`) la provi senza aprire un browser.
//
// # Il secondo scatto
//
// Una foto diversa dalla baseline, o una scena che non arriva allo scatto (un
// tempo scaduto, una scena che non sta ferma), si rifà **una volta**, da sola,
// in una pagina nuova. Se il secondo scatto è uguale alla baseline la foto è
// «instabile ma ripresa»: il banco non cade, ma lo dice nel riepilogo, nel
// foglio di contatto e in `instabili.json`, perché una scena che cambia fra due
// corse dello stesso codice è un difetto da trovare (una issue), non un rosso
// da rilanciare. Se anche il secondo è diverso, l'esito resta quello di oggi.
//
// Mai più di un secondo scatto: con tre o quattro tentativi una scena che si
// muove una volta su due passerebbe quasi sempre, e il banco smetterebbe di
// vederla. E mai su `--update`: lì non c'è un termine di paragone, e la foto
// scritta è quella che diventa la baseline.

/// Cosa è successo a una foto. Sono sei e sono tutte diverse fra loro: un
/// «manca la baseline» che si confondesse con un «è cambiata» renderebbe
/// `--update` la risposta a tutti e due, e la prima volta che qualcuno la
/// desse per la seconda ragione le baseline smetterebbero di essere un presidio.
export const OUTCOMES = Object.freeze({
  equal: "uguale",
  changed: "cambiata",
  withoutBaseline: "senza baseline",
  written: "scritta",
  /// La scena non è arrivata allo scatto: un tempo scaduto, una scena che non
  /// sta ferma.
  unstable: "instabile",
  /// Il primo scatto era diverso (o non c'era), il secondo è uguale.
  recovered: "instabile ma ripresa",
});

/// Gli esiti che fanno cadere il banco in verifica.
const FAILING = new Set([OUTCOMES.changed, OUTCOMES.withoutBaseline, OUTCOMES.unstable]);

/// Se una foto si rifà: soltanto in verifica, e soltanto se era diversa dalla
/// baseline o non è arrivata allo scatto. Una foto senza baseline non si rifà:
/// un secondo scatto non le darebbe un termine di paragone.
export function needsSecondShot(row, { update }) {
  if (update) return false;
  return row.outcome === OUTCOMES.changed || row.outcome === OUTCOMES.unstable;
}

/// L'esito di una foto scattata due volte.
///
/// - Il secondo uguale: «instabile ma ripresa», con il motivo del primo.
/// - Il secondo non arrivato allo scatto: vale il primo, che almeno ha una
///   foto (e, se era cambiata, la sua differenza).
/// - Altrimenti vale il secondo: è il più recente, e la foto in `attuale/` e
///   la differenza in `differenze/` sono le sue.
export function combineShots(first, second) {
  if (second.outcome === OUTCOMES.equal) {
    return {
      ...second,
      outcome: OUTCOMES.recovered,
      first: { outcome: first.outcome, reason: first.reason ?? null, different: first.different ?? 0 },
    };
  }
  if (second.outcome === OUTCOMES.unstable) return first;
  return second;
}

/// Quante foto fanno cadere il banco.
export function failures(report) {
  return report.filter((r) => FAILING.has(r.outcome)).length;
}

/// Le foto instabili ma riprese, nella forma di `instabili.json`: ciò che serve
/// per aprire la issue senza riaprire il foglio di contatto.
export function unstableRecord(report) {
  return report
    .filter((r) => r.outcome === OUTCOMES.recovered)
    .map((r) => ({
      scena: r.scene.id,
      luce: r.light,
      foto: r.name,
      primo: { esito: r.first.outcome, motivo: r.first.reason, pixel: r.first.different },
    }));
}

/// Le righe del riepilogo in verifica, e se il banco cade. Una riga per le
/// instabili ma riprese anche quando tutto il resto è uguale: è l'unico posto
/// del verde in cui si vedono.
export function verifySummary(report, { updateHint }) {
  const count = (outcome) => report.filter((r) => r.outcome === outcome).length;
  const errors = failures(report);
  const recovered = report.filter((r) => r.outcome === OUTCOMES.recovered);
  const lines = [
    `${count(OUTCOMES.equal) + recovered.length}/${report.length} foto uguali alle baseline` +
      (errors ? ` · ${errors} da guardare` : ""),
  ];
  if (recovered.length) {
    lines.push(
      `${recovered.length} instabili ma riprese al secondo scatto (non fanno cadere il banco, ma vanno trovate: instabili.json): ` +
        recovered.map((r) => `${r.name} (${r.first.reason ?? r.first.outcome})`).join(", "),
    );
  }
  if (errors) {
    lines.push(`Se il cambiamento è quello che volevi, il gesto è «${updateHint}» — dopo aver guardato il foglio.`);
  }
  return { lines, exitCode: errors ? 1 : 0 };
}

/// Il riepilogo per la pagina della corsa di GitHub (`GITHUB_STEP_SUMMARY`):
/// vuoto se non c'è niente da dire.
export function stepSummary(report) {
  const recovered = report.filter((r) => r.outcome === OUTCOMES.recovered);
  const failing = report.filter((r) => FAILING.has(r.outcome));
  if (!recovered.length && !failing.length) return "";
  const out = ["### Banco visivo", ""];
  for (const r of failing) out.push(`- ✗ \`${r.name}\`: ${r.outcome}${r.reason ? ` · ${r.reason}` : ""}`);
  for (const r of recovered) {
    out.push(`- ⚠ \`${r.name}\`: instabile ma ripresa · al primo scatto ${r.first.reason ?? r.first.outcome}`);
  }
  out.push("");
  return out.join("\n");
}
