export type { ExtendedHighlight } from "./types";
export { paperHighlightToExtended, extendedToPaperHighlight } from "./types";
export { normalizeForSearch, expandLatexCommands } from "./textNormalization";
export { HighlightContainer } from "./HighlightContainer";
export { activeHighlightStore } from "./activeHighlightStore";
export { usePdfSearch } from "./usePdfSearch";
export { PdfToolbar } from "./PdfToolbar";
export { findTextPages, createTextHighlightOverlays, removeHighlightOverlays, computeScaledPositionFromTextLayer } from "./findTextPosition";
