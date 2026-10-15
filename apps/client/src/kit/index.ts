// Il kit: le primitive con cui la shell costruisce le sue superfici.
//
// Ognuna riceve elementi e una vita, e non conosce la shell: niente stato
// globale dell'applicazione, niente host, niente testo suo. Le etichette
// arrivano da chi chiama; ciò che si registra si scioglie con la vita.
//
// La geometria che una pelle non decide sta in `kit.css`, qui accanto; il
// resto lo veste `theme/scrittoio/skin/kit.css`.
import "./kit.css";

export { iconButton, labelButton, setPressed, textButton } from "./button";
export type { ButtonChord, ButtonKind, IconButtonOptions, TextButtonOptions } from "./button";

export { openDialog } from "./dialog";
export type { DialogAction, DialogActionKind, DialogHandle, DialogOptions } from "./dialog";

export { textField } from "./field";
export type { TextField, TextFieldOptions } from "./field";

export { HOVER_CLOSE_DELAY_MS, HOVER_OPEN_DELAY_MS, attachHoverCard } from "./hover-card";
export type { HoverCardHandle, HoverCardOptions } from "./hover-card";

export { TYPEAHEAD_MS, createList } from "./list";
export type { ListFocus, ListHandle, ListOptions, ListRole } from "./list";

export { POPOVER_MARGIN_PX, openPopover, placePopover } from "./popover";
export type {
  AnchorBox,
  PlaceOptions,
  Placed,
  PopoverAlign,
  PopoverAnchor,
  PopoverCloseReason,
  PopoverHandle,
  PopoverOptions,
  PopoverPlacement,
  VirtualAnchor,
} from "./popover";

export { pressable } from "./press";

export { RESIST_LIMIT_PX, mountSplitter, resist } from "./splitter";
export type { SplitterHandle, SplitterOptions } from "./splitter";

export { createTabs } from "./tabs";
export type { TabSpec, TabsHandle, TabsOptions } from "./tabs";
