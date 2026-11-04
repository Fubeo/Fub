// Il file Craft delle scene `craft-*` (`?craft-scheda=<caso>`): un disegno di
// VectorCraft senza anteprima, con ciò che il bundle `fub.craft` dice nei
// casi della scheda (N7, T23) come le schermate del prototipo
// `PLAN-ui/craft-anteprime.html`: la domanda, le anteprime spente, l'app che
// prepara l'anteprima, il file oltre il peso massimo, il file che non si
// legge, l'app che non ce l'ha fatta. Soltanto le sue scene lo hanno.

import type { FakeCraft } from "../src/host/fake";
import type { CraftPreview, CraftPreviewSize } from "../src/host/craft";

export const CRAFT_SCENE_DOC = "Disegni/logo-studio.vectorcraft";

export type CraftSceneCase = "domanda" | "spente" | "prepara" | "peso" | "rotto" | "fallita";

const CASES: readonly CraftSceneCase[] = ["domanda", "spente", "prepara", "peso", "rotto", "fallita"];

export function craftSceneCase(value: string | null): CraftSceneCase | null {
  return CASES.find((name) => name === value) ?? null;
}

export function craftSceneResources(): Record<string, { bytes: Uint8Array }> {
  return { [CRAFT_SCENE_DOC]: { bytes: new TextEncoder().encode("{\"vectorcraft\":3}") } };
}

const APP = { app: "VectorCraft" } as const;

/// Ciò che il bundle finto dice del disegno, caso per caso.
export function craftSceneCraft(kind: CraftSceneCase): FakeCraft {
  const info = { format_version: "3", bytes: 2_516_582 };
  const doc = {
    domanda: { info, render: { ...APP, consent: "ask" as const } },
    spente: { info, render: { ...APP, consent: "off" as const } },
    prepara: { info, render: { ...APP, consent: "on" as const } },
    peso: { info: { ...info, bytes: 187_432_960 }, missing: "over_limit" as const, limit_bytes: 64 * 1024 * 1024, render: { ...APP, consent: "on" as const } },
    rotto: { info: { bytes: info.bytes }, missing: "unreadable" as const },
    fallita: { info, missing: "failed" as const },
  }[kind];
  return { docs: { [CRAFT_SCENE_DOC]: doc } };
}

/// `craft_render` del caso `prepara`: il job parte e la risposta dice che è
/// in coda; il `job_done` non arriva, e la scheda resta su «Preparo
/// l'anteprima…».
export function craftSceneRender(
  preview: (doc: string, size: CraftPreviewSize) => Promise<CraftPreview>,
): (doc: string, size: CraftPreviewSize) => Promise<CraftPreview> {
  return async (doc, size) => ({ ...(await preview(doc, size)), queued: true });
}
