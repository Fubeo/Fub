// @vitest-environment happy-dom
// Il campo delle esclusioni della sincronizzazione: un tipo di file è un
// gruppo di voci `ext:`, si accende e si spegne intero, e le altre voci della
// lista restano dove sono.
import { expect, it } from "vitest";
import type { SettingEntry } from "../host/contract";
import { t } from "../i18n/strings";
import { describeSyncExclude, excludedKinds, KIND_EXTENSIONS, syncExcludeField, withKind } from "./sync-exclude-field";

const entry = (value: string[]) => ({ spec: { key: "sync.exclude" }, value }) as unknown as SettingEntry;

it("un tipo è escluso solo se lo sono tutte le sue estensioni, scritte in ogni forma", () => {
  expect([...excludedKinds(["ext:pdf"])]).toEqual(["pdf"]);
  expect([...excludedKinds([".PDF"])]).toEqual(["pdf"]);
  expect([...excludedKinds(["ext:png"])]).toEqual([]);
  const images = KIND_EXTENSIONS.images.map((ext) => `ext:${ext}`);
  expect([...excludedKinds(images)]).toEqual(["images"]);
});

it("accendere un tipo aggiunge le sue voci, spegnerlo le toglie tutte, e il resto non si tocca", () => {
  const on = withKind(["Archivio/", "ext:png"], "images", true);
  expect(on[0]).toBe("Archivio/");
  expect(on.filter((item) => item === "ext:png")).toHaveLength(1);
  expect(excludedKinds(on).has("images")).toBe(true);
  expect(withKind(on, "images", false)).toEqual(["Archivio/"]);
  expect(withKind(["ext:pdf", "ext:docx"], "pdf", false)).toEqual(["ext:docx"]);
});

it("il campo ha una casella per tipo, scrive la lista intera e dice le altre voci", () => {
  const writes: Array<[string[], string, boolean]> = [];
  const field = syncExcludeField(entry(["ext:pdf", "Archivio/"]), "f", (value, part, checked) => writes.push([value, part, checked]));
  const boxes = [...field.querySelectorAll<HTMLInputElement>("input[type=checkbox]")];
  expect(boxes.map((box) => [box.id, box.checked])).toEqual([
    ["f-images", false],
    ["f-audio", false],
    ["f-video", false],
    ["f-pdf", true],
  ]);
  expect(field.textContent).toContain(t("sync.kind.others", { list: "Archivio/" }));
  boxes[3]!.checked = false;
  boxes[3]!.dispatchEvent(new Event("change"));
  expect(writes).toEqual([[["Archivio/"], t("sync.kind.pdf"), false]]);
  expect(describeSyncExclude(["ext:pdf", "ext:png", "Archivio/"])).toBe(`${t("sync.kind.pdf")}, ext:png, Archivio/`);
});
