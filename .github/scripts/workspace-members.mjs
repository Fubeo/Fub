// **Which crates belong to this workspace**, for the guards that run across them.
//
// Two guards in this folder — `check-cargo-versions.mjs` and
// `check-cargo-feature-default.mjs` — need to open the `Cargo.toml` of every
// crate in the workspace. Both of them, up to this file, derived the list the
// same way: **by reading the `crates/` directory**. That was a copy of the same
// function in two files, which is already half the defect — but the half that
// bites is the other one.
//
// The directory is not the list. The list is `[workspace] members` in the root
// `Cargo.toml`, and the two can diverge in both directions:
//
//   1. **a member outside `crates/`** — the root can declare `"tools/something"`
//      and cargo will build it. The two guards wouldn't even open it: a
//      hand-written version inside it, or a feature outside the `default`, was
//      invisible to both. And neither of them would say so: they'd claim "8
//      crates checked" without saying *which eight* — that is, without saying
//      they were choosing for themselves.
//   2. **a directory in `crates/` that no member declares** — cargo won't build
//      it, so its tests don't exist, its code doesn't exist, and CI stays
//      green. It is the on-disk form of the same class of defect that
//      `check-cargo-feature-default.mjs` guards against inside a crate: *a
//      suite that silently empties is indistinguishable from a green suite*. The
//      case is no longer hypothetical: `crates/fub-wasm-host` is the directory
//      that was then just a commented-out line in the root, and is now a
//      declared member. The guard stays for the next one, which will be born the
//      same way.
//
// Hence the shape: **one function, and it answers both ways.** It doesn't just
// return the list of files: it also returns violations, so the second caller
// inherits for free the part that says "no". A list that claims "these are all"
// but can't say who's missing isn't a list, it's a sample.
//
// No npm dependencies, like the other guards in this folder: a check that
// requires `npm install` to run is a check that eventually gets shut down
// "temporarily". The parsing is line-by-line for the same reason it is in the
// two callers, and what you can't parse you don't guess — you declare.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The table name of a `[…]` line, or `null` if the line is not one. */
function nomeSezione(riga) {
  const m = riga.match(/^\[\[?([^\]]+)\]\]?\s*$/);
  return m === null ? m : m[1].trim();
}

/**
 * The members declared by `[workspace] members` in the root manifest.
 *
 * Returns `null` if the section or the key is missing: that is a different case
 * from "zero members", and the caller must be able to tell them apart — the
 * first means this reader is stale, the second means the workspace is empty, and
 * treating them the same would make a guard that stopped reading go green.
 *
 * Commented-out lines are skipped: a line `# "crates/something"` inside the
 * list **is not** a member, and that is precisely the line a naive reader would
 * get wrong. The root once had one — `fub-wasm-host`, before the crate existed
 * — and the next one will be written the same way.
 */
function membriDichiarati(manifestRadice) {
  const righe = fs.readFileSync(manifestRadice, "utf8").split("\n");
  let dentro = false;

  for (let i = 0; i < righe.length; i++) {
    const sezione = nomeSezione(righe[i].trim());
    if (sezione !== null) {
      dentro = sezione === "workspace";
      continue;
    }
    if (!dentro) continue;

    const testo = righe[i].trim();
    if (!/^members\s*=/.test(testo)) continue;

    // The list is almost always multi-line: the brackets close here.
    let raccolto = testo;
    let aperte = (testo.match(/\[/g) ?? []).length - (testo.match(/\]/g) ?? []).length;
    while (aperte > 0 && i + 1 < righe.length) {
      i++;
      const seguito = righe[i].replace(/^\s*#.*$/, "");
      raccolto += ` ${seguito}`;
      aperte += (seguito.match(/\[/g) ?? []).length - (seguito.match(/\]/g) ?? []).length;
    }
    if (aperte > 0) return null;

    // A trailing comment on a list line (`"crates/x", # because`) takes
    // everything after it on that line with it — the `replace` above already
    // handled full-line comments.
    const senzaCommenti = raccolto.replace(/#[^\n"]*$/, "");
    return [...senzaCommenti.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
  }

  return null;
}

/**
 * The `Cargo.toml` files of member crates, in order, and what does not add up.
 *
 * Returns `{ file, violations }`. `file` are the manifests to open — those of
 * the **declared** members, not those that happen to exist on disk. `violations`
 * are the divergences between the list and the disk, in both directions, already
 * written to be printed: the caller appends its own.
 */
export function crateDelWorkspace(radice) {
  const manifestRadice = path.join(radice, "Cargo.toml");
  const violazioni = [];

  if (!fs.existsSync(manifestRadice)) {
    return { file: [], violazioni: [`non c'è un \`Cargo.toml\` in ${radice}.`] };
  }

  const membri = membriDichiarati(manifestRadice);
  if (membri === null) {
    return {
      file: [],
      violazioni: [
        "in `Cargo.toml` non si legge `[workspace] members`: o la radice non è un" +
          " workspace, o la forma di quell'elenco è cambiata e questo lettore è vecchio." +
          "\n  Tacere qui vorrebbe dire controllare zero crate dicendo zero violazioni.",
      ],
    };
  }

  const file = [];
  const dichiarati = new Set();
  for (const membro of membri) {
    const manifest = path.join(radice, membro, "Cargo.toml");
    dichiarati.add(path.resolve(radice, membro));
    if (!fs.existsSync(manifest)) {
      violazioni.push(
        `\`[workspace] members\` dichiara \`${membro}\`, ma lì non c'è nessun` +
          ` \`Cargo.toml\`: cargo non compila quel membro, e i presidi che leggono` +
          ` questo elenco credono di averlo guardato.`,
      );
      continue;
    }
    file.push(manifest);
  }

  // The opposite direction: a directory with a manifest that no member declares.
  // This is where the list turns red when a line is removed — without it,
  // removing a member would only silently check *fewer* crates.
  const dir = path.join(radice, "crates");
  if (fs.existsSync(dir)) {
    for (const voce of fs.readdirSync(dir, { withFileTypes: true }).sort()) {
      if (!voce.isDirectory()) continue;
      const manifest = path.join(dir, voce.name, "Cargo.toml");
      if (!fs.existsSync(manifest)) continue;
      if (dichiarati.has(path.resolve(dir, voce.name))) continue;
      violazioni.push(
        `\`crates/${voce.name}\` ha un \`Cargo.toml\` e non è in` +
          ` \`[workspace] members\`: cargo non lo compila, quindi il suo codice non` +
          ` esiste e i suoi \`#[test]\` non sono rossi — sono spariti dal conto.` +
          `\n  O entra fra i membri, o la cartella non ci va.`,
      );
    }
  }

  return { file: file.sort(), violazioni };
}

// **From the command line**: the member manifests, one per line, on stdout.
//
// The third caller is not a guard but a **count**: `crate-del-workspace` in
// `counts.mjs`, which is a shell string and therefore cannot import a function.
// Without this door, the reading of `[workspace] members` would have been
// rewritten there — that is, the third copy of the thing this file exists to
// not have in two.
//
// Violations go to **stderr** and do not kill the exit: what turns them red are
// the two guards that call `crateDelWorkspace`, and a third actor saying the
// same thing would not add a word — it would only remove the number from the
// register at the very turn it is needed. If the list can't be read at all,
// `file` is empty and the count prints **zero**: that is the right direction to
// fail in, because zero crates inheriting the version will not pass unnoticed
// in any prose that cites that number.
if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { file, violazioni } = crateDelWorkspace(process.cwd());
  for (const violazione of violazioni) console.error(violazione);
  for (const manifest of file) console.log(manifest);
}
