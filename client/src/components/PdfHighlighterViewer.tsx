"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import {
  PdfLoader,
  PdfHighlighter,
  TextHighlight,
  AreaHighlight,
  useHighlightContainerContext,
  PdfHighlighterUtils,
} from "react-pdf-highlighter-extended";
import type {
  Highlight,
  PdfSelection,
  GhostHighlight,
  Content,
  ViewportHighlight,
} from "react-pdf-highlighter-extended";

// Styles are imported by the library components themselves
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  ArrowRight,
  Minus,
  Plus,
  ChevronUp,
  ChevronDown,
  Search,
  X,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  PaperHighlight,
  PaperHighlightAnnotation,
  ScaledPosition,
} from "@/lib/schema";
import EnigmaticLoadingExperience from "@/components/EnigmaticLoadingExperience";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { getStatusIcon, PaperStatus } from "./utils/PdfStatus";
import InlineAnnotationMenu from "./InlineAnnotationMenu";

// Extended highlight type that includes our custom properties
export interface ExtendedHighlight extends Highlight {
  content: Content;
  comment?: string;
  role?: "user" | "assistant";
  raw_text?: string;
}

// Convert PaperHighlight to ExtendedHighlight
export function paperHighlightToExtended(
  highlight: PaperHighlight
): ExtendedHighlight | null {
  if (!highlight.position) return null;

  return {
    id: highlight.id || crypto.randomUUID(),
    type: "text",
    position: highlight.position,
    content: { text: highlight.raw_text },
    role: highlight.role,
    raw_text: highlight.raw_text,
  };
}

// Convert ExtendedHighlight to PaperHighlight
export function extendedToPaperHighlight(
  highlight: ExtendedHighlight
): PaperHighlight {
  return {
    id: highlight.id,
    raw_text: highlight.content.text || highlight.raw_text || "",
    role: highlight.role || "user",
    page_number: highlight.position.boundingRect.pageNumber,
    position: highlight.position as ScaledPosition,
  };
}

interface PdfHighlighterViewerProps {
  pdfUrl: string;
  explicitSearchTerm?: string;
  highlights: PaperHighlight[];
  setHighlights: (highlights: PaperHighlight[]) => void;
  selectedText: string;
  setSelectedText: (text: string) => void;
  tooltipPosition: { x: number; y: number } | null;
  setTooltipPosition: (position: { x: number; y: number } | null) => void;
  setIsAnnotating: (isAnnotating: boolean) => void;
  isHighlightInteraction: boolean;
  setIsHighlightInteraction: (isHighlightInteraction: boolean) => void;
  activeHighlight: PaperHighlight | null;
  setActiveHighlight: (highlight: PaperHighlight | null) => void;
  addHighlight: (
    selectedText: string,
    position?: ScaledPosition,
    pageNumber?: number,
    doAnnotate?: boolean
  ) => void;
  removeHighlight: (highlight: PaperHighlight) => void;
  loadHighlights: () => Promise<void>;
  renderAnnotations: (annotations: PaperHighlightAnnotation[]) => void;
  annotations: PaperHighlightAnnotation[];
  handleStatusChange?: (status: PaperStatus) => void;
  paperStatus?: PaperStatus;
  setUserMessageReferences: React.Dispatch<React.SetStateAction<string[]>>;
}

// Highlight container component that renders each highlight
function HighlightContainer({
  onHighlightClick,
}: {
  onHighlightClick: (highlight: ViewportHighlight<ExtendedHighlight>, event: MouseEvent) => void;
}) {
  const { highlight, isScrolledTo } =
    useHighlightContainerContext<ExtendedHighlight>();

  const isTextHighlight = highlight.type === "text";

  const handleClick = (event: React.MouseEvent) => {
    event.stopPropagation();
    onHighlightClick(highlight, event.nativeEvent);
  };

  const highlightColor =
    highlight.role === "assistant"
      ? "rgba(168, 85, 247, 0.3)" // purple for AI highlights
      : "rgba(59, 130, 246, 0.3)"; // blue for user highlights

  if (isTextHighlight) {
    return (
      <div onClick={handleClick} style={{ cursor: "pointer" }}>
        <TextHighlight
          isScrolledTo={isScrolledTo}
          highlight={highlight}
          style={{
            background: highlightColor,
          }}
        />
      </div>
    );
  }

  return (
    <div onClick={handleClick} style={{ cursor: "pointer" }}>
      <AreaHighlight
        isScrolledTo={isScrolledTo}
        highlight={highlight}
        style={{
          background: highlightColor,
          border: isScrolledTo ? "2px solid #3b82f6" : "none",
        }}
      />
    </div>
  );
}

export function PdfHighlighterViewer(props: PdfHighlighterViewerProps) {
  const {
    pdfUrl,
    explicitSearchTerm,
    highlights,
    setHighlights,
    selectedText,
    setSelectedText,
    tooltipPosition,
    setTooltipPosition,
    setIsAnnotating,
    isHighlightInteraction,
    setIsHighlightInteraction,
    activeHighlight,
    setActiveHighlight,
    addHighlight,
    removeHighlight,
    paperStatus,
    handleStatusChange = () => {},
    setUserMessageReferences,
  } = props;

  const highlighterUtilsRef = useRef<PdfHighlighterUtils | null>(null);
  const [currentSelection, setCurrentSelection] = useState<PdfSelection | null>(
    null
  );
  const [, setCurrentGhostHighlight] =
    useState<GhostHighlight | null>(null);
  const [scale, setScale] = useState(1.0);
  const [currentPage, setCurrentPage] = useState(1);
  const [numPages, setNumPages] = useState<number | null>(null);
  const [showScrollToTop] = useState(false); // TODO: Add scroll listener to update this
  const [searchText, setSearchText] = useState(explicitSearchTerm || "");
  const [showSearchInput, setShowSearchInput] = useState(false);
  // Each "match" is a group of highlight elements (for multi-line matches)
  const [searchMatches, setSearchMatches] = useState<HTMLElement[][]>([]);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const lastSearchTermRef = useRef<string | undefined>(undefined);

  // Convert PaperHighlights to ExtendedHighlights
  const extendedHighlights: ExtendedHighlight[] = highlights
    .map(paperHighlightToExtended)
    .filter((h): h is ExtendedHighlight => h !== null);

  // Ligatures that expand to multiple characters
  const ligatureMap: Record<string, string> = {
    '\ufb01': 'fi', '\ufb02': 'fl', '\ufb03': 'ffi', '\ufb04': 'ffl',
  };

  // Greek letters and common math symbols - maps Unicode to ASCII representation
  // This allows matching between PDF-rendered symbols and LaTeX input
  const greekLetterMap: Record<string, string> = {
    // Lowercase Greek
    'α': 'alpha', 'β': 'beta', 'γ': 'gamma', 'δ': 'delta', 'ε': 'epsilon',
    'ζ': 'zeta', 'η': 'eta', 'θ': 'theta', 'ι': 'iota', 'κ': 'kappa',
    'λ': 'lambda', 'μ': 'mu', 'ν': 'nu', 'ξ': 'xi', 'ο': 'omicron',
    'π': 'pi', 'ρ': 'rho', 'σ': 'sigma', 'ς': 'sigma', 'τ': 'tau',
    'υ': 'upsilon', 'φ': 'phi', 'χ': 'chi', 'ψ': 'psi', 'ω': 'omega',
    // Uppercase Greek
    'Α': 'Alpha', 'Β': 'Beta', 'Γ': 'Gamma', 'Δ': 'Delta', 'Ε': 'Epsilon',
    'Ζ': 'Zeta', 'Η': 'Eta', 'Θ': 'Theta', 'Ι': 'Iota', 'Κ': 'Kappa',
    'Λ': 'Lambda', 'Μ': 'Mu', 'Ν': 'Nu', 'Ξ': 'Xi', 'Ο': 'Omicron',
    'Π': 'Pi', 'Ρ': 'Rho', 'Σ': 'Sigma', 'Τ': 'Tau', 'Υ': 'Upsilon',
    'Φ': 'Phi', 'Χ': 'Chi', 'Ψ': 'Psi', 'Ω': 'Omega',
    // Common math symbols
    '∞': 'infinity', '∂': 'partial', '∇': 'nabla', '∑': 'sum',
    '∏': 'prod', '∫': 'int', '√': 'sqrt', '≈': 'approx',
    '≠': 'neq', '≤': 'leq', '≥': 'geq', '±': 'pm',
    '×': 'times', '÷': 'div', '∈': 'in', '∉': 'notin',
    '⊂': 'subset', '⊃': 'supset', '∪': 'cup', '∩': 'cap',
    '∧': 'land', '∨': 'lor', '¬': 'neg', '→': 'to',
    '←': 'leftarrow', '↔': 'leftrightarrow', '⇒': 'Rightarrow',
    '⇐': 'Leftarrow', '⇔': 'Leftrightarrow',
  };

  // LaTeX commands to their Unicode equivalents (for input normalization)
  const latexCommandMap: Record<string, string> = {
    '\\alpha': 'alpha', '\\beta': 'beta', '\\gamma': 'gamma', '\\delta': 'delta',
    '\\epsilon': 'epsilon', '\\varepsilon': 'epsilon', '\\zeta': 'zeta',
    '\\eta': 'eta', '\\theta': 'theta', '\\vartheta': 'theta', '\\iota': 'iota',
    '\\kappa': 'kappa', '\\lambda': 'lambda', '\\mu': 'mu', '\\nu': 'nu',
    '\\xi': 'xi', '\\pi': 'pi', '\\varpi': 'pi', '\\rho': 'rho',
    '\\varrho': 'rho', '\\sigma': 'sigma', '\\varsigma': 'sigma', '\\tau': 'tau',
    '\\upsilon': 'upsilon', '\\phi': 'phi', '\\varphi': 'phi', '\\chi': 'chi',
    '\\psi': 'psi', '\\omega': 'omega',
    '\\Alpha': 'Alpha', '\\Beta': 'Beta', '\\Gamma': 'Gamma', '\\Delta': 'Delta',
    '\\Epsilon': 'Epsilon', '\\Zeta': 'Zeta', '\\Eta': 'Eta', '\\Theta': 'Theta',
    '\\Iota': 'Iota', '\\Kappa': 'Kappa', '\\Lambda': 'Lambda', '\\Mu': 'Mu',
    '\\Nu': 'Nu', '\\Xi': 'Xi', '\\Pi': 'Pi', '\\Rho': 'Rho', '\\Sigma': 'Sigma',
    '\\Tau': 'Tau', '\\Upsilon': 'Upsilon', '\\Phi': 'Phi', '\\Chi': 'Chi',
    '\\Psi': 'Psi', '\\Omega': 'Omega',
    '\\infty': 'infinity', '\\partial': 'partial', '\\nabla': 'nabla',
    '\\sum': 'sum', '\\prod': 'prod', '\\int': 'int', '\\sqrt': 'sqrt',
    '\\approx': 'approx', '\\neq': 'neq', '\\leq': 'leq', '\\geq': 'geq',
    '\\pm': 'pm', '\\times': 'times', '\\div': 'div', '\\in': 'in',
    '\\notin': 'notin', '\\subset': 'subset', '\\supset': 'supset',
    '\\cup': 'cup', '\\cap': 'cap', '\\land': 'land', '\\lor': 'lor',
    '\\neg': 'neg', '\\to': 'to', '\\rightarrow': 'to',
    '\\leftarrow': 'leftarrow', '\\leftrightarrow': 'leftrightarrow',
    '\\Rightarrow': 'Rightarrow', '\\Leftarrow': 'Leftarrow',
    '\\Leftrightarrow': 'Leftrightarrow',
  };

  // Quote normalization - all quote types map to empty (removed)
  // Using unicode escapes for special characters to avoid parser issues
  const quoteChars = new Set([
    '"', "'", '`',
    '\u201C', '\u201D',  // " "  left/right double quotation marks
    '\u2018', '\u2019',  // ' '  left/right single quotation marks
    '\u201A', '\u201E',  // ‚ „  low-9 quotation marks
    '\u2039', '\u203A',  // ‹ ›  single angle quotation marks
    '\u00AB', '\u00BB',  // « »  double angle quotation marks
    '\u300C', '\u300D',  // 「 」 CJK corner brackets
    '\u300E', '\u300F',  // 『 』 CJK white corner brackets
    '\u301D', '\u301E', '\u301F',  // 〝 〞 〟 double prime quotation marks
    '\uFF02', '\uFF07',  // ＂ ＇ fullwidth quotation marks
  ]);

  // Expand LaTeX commands in the input text
  const expandLatexCommands = useCallback((text: string): string => {
    let result = text;
    // Sort by length descending to match longer commands first (e.g., \varepsilon before \epsilon)
    const sortedCommands = Object.keys(latexCommandMap).sort((a, b) => b.length - a.length);
    for (const cmd of sortedCommands) {
      // Use regex to match the command followed by a non-letter (or end of string)
      // This prevents matching \alpha inside \alphaXYZ
      const regex = new RegExp(cmd.replace(/\\/g, '\\\\') + '(?![a-zA-Z])', 'g');
      result = result.replace(regex, latexCommandMap[cmd]);
    }
    return result;
  }, []);

  // Normalize text for search matching:
  // - Expand LaTeX commands to ASCII equivalents
  // - Expand ligatures
  // - Expand Greek letters to ASCII equivalents
  // - Remove all quote characters entirely
  // - Keep only alphanumeric characters and spaces
  const normalizeForSearch = useCallback((text: string): string => {
    // First expand LaTeX commands
    const expandedText = expandLatexCommands(text);

    let result = '';
    for (const char of expandedText) {
      // Handle ligatures first
      if (ligatureMap[char]) {
        result += ligatureMap[char];
      }
      // Handle Greek letters and math symbols
      else if (greekLetterMap[char]) {
        result += greekLetterMap[char];
      }
      // Remove quote characters entirely (don't convert to space)
      else if (quoteChars.has(char)) {
        // Skip quotes - don't add anything
        continue;
      }
      else if (/[\p{L}\p{N}]/u.test(char)) {
        // Keep letters and numbers (Unicode-aware)
        result += char;
      } else {
        // Replace all other characters (punctuation, symbols, spaces) with space
        result += ' ';
      }
    }
    // Collapse multiple spaces into one
    return result.replace(/\s+/g, ' ').trim();
  }, [expandLatexCommands]);

  // Search for a single term in a text layer and return match groups
  // Each match group contains all highlight elements for a single logical match
  const searchInTextLayer = useCallback(
    (
      textLayer: Element,
      searchTerm: string,
      matchGroups: HTMLElement[][]
    ) => {
      const spans = Array.from(textLayer.querySelectorAll("span"));

      // Forward mapping: for each character in normalized text, track where it came from
      interface CharMapping {
        span: HTMLSpanElement;
        originalCharIndex: number;
        textNode: Text | null;
        isVirtual?: boolean;  // True for separator spaces that don't exist in the original DOM
      }

      let normalizedCombined = "";
      const charMappings: CharMapping[] = [];

      spans.forEach((span) => {
        const originalText = span.textContent || "";
        const textNode = span.firstChild as Text | null;

        if (originalText.length === 0) return;

        // Add space between spans if needed (when previous doesn't end with space
        // and we have content to add)
        if (normalizedCombined.length > 0 && !normalizedCombined.endsWith(" ")) {
          normalizedCombined += " ";
          // Mark as virtual - this space doesn't exist in the DOM, it's just for matching
          charMappings.push({ span, originalCharIndex: -1, textNode, isVirtual: true });
        }

        let prevWasSpace = normalizedCombined.endsWith(" ");

        for (let i = 0; i < originalText.length; i++) {
          const char = originalText[i];

          if (ligatureMap[char]) {
            // Ligature expands to multiple chars - each maps back to this single original char
            for (const expandedChar of ligatureMap[char]) {
              normalizedCombined += expandedChar;
              charMappings.push({ span, originalCharIndex: i, textNode });
            }
            prevWasSpace = false;
          } else if (greekLetterMap[char]) {
            // Greek letter/math symbol expands to ASCII equivalent
            for (const expandedChar of greekLetterMap[char]) {
              normalizedCombined += expandedChar;
              charMappings.push({ span, originalCharIndex: i, textNode });
            }
            prevWasSpace = false;
          } else if (quoteChars.has(char)) {
            // Skip quote characters entirely - no mapping entry, no output
            continue;
          } else if (/[\p{L}\p{N}]/u.test(char)) {
            // Regular letter/number
            normalizedCombined += char;
            charMappings.push({ span, originalCharIndex: i, textNode });
            prevWasSpace = false;
          } else {
            // Non-alphanumeric becomes space, but collapse consecutive spaces
            if (!prevWasSpace) {
              normalizedCombined += " ";
              charMappings.push({ span, originalCharIndex: i, textNode });
              prevWasSpace = true;
            }
            // If prevWasSpace, skip this char (collapsed) - no mapping entry
          }
        }
      });

      // Trim leading spaces (and remove their mappings)
      while (normalizedCombined.startsWith(" ")) {
        normalizedCombined = normalizedCombined.slice(1);
        charMappings.shift();
      }
      // Trim trailing spaces (and remove their mappings)
      while (normalizedCombined.endsWith(" ")) {
        normalizedCombined = normalizedCombined.slice(0, -1);
        charMappings.pop();
      }

      const normalizedLower = normalizedCombined.toLowerCase();
      const normalizedTerm = normalizeForSearch(searchTerm).trim().toLowerCase();

      if (!normalizedTerm || charMappings.length === 0) return;

      // Create space-stripped versions for fuzzy matching
      // This handles PDFs with weird spacing like "h e l l o" matching "hello"
      let spaceStrippedText = "";
      const spaceStrippedToNormalizedIndex: number[] = []; // maps space-stripped index -> normalized index

      for (let i = 0; i < normalizedLower.length; i++) {
        if (normalizedLower[i] !== ' ') {
          spaceStrippedToNormalizedIndex.push(i);
          spaceStrippedText += normalizedLower[i];
        }
      }

      // Also strip spaces from search term
      const spaceStrippedTerm = normalizedTerm.replace(/\s+/g, '');

      if (!spaceStrippedTerm) return;

      // Try exact match first (with spaces), then fall back to space-stripped match
      let searchIndex = normalizedLower.indexOf(normalizedTerm);
      let useSpaceStripped = false;

      if (searchIndex === -1) {
        // No exact match, try space-stripped matching
        searchIndex = spaceStrippedText.indexOf(spaceStrippedTerm);
        useSpaceStripped = true;
      }

      while (searchIndex !== -1) {
        // Convert indices based on whether we're using space-stripped matching
        let normalizedStartIndex: number;
        let normalizedEndIndex: number;

        if (useSpaceStripped) {
          // Map space-stripped indices back to normalized indices
          normalizedStartIndex = spaceStrippedToNormalizedIndex[searchIndex];
          const endInStripped = searchIndex + spaceStrippedTerm.length - 1;
          normalizedEndIndex = spaceStrippedToNormalizedIndex[endInStripped] + 1;
        } else {
          normalizedStartIndex = searchIndex;
          normalizedEndIndex = searchIndex + normalizedTerm.length;
        }

        const textLayerRect = textLayer.getBoundingClientRect();

        // Collect all highlight elements for this single logical match
        const matchElements: HTMLElement[] = [];

        // Group consecutive characters by span to create highlight ranges
        // Each range is: { span, textNode, startIdx, endIdx }
        interface HighlightRange {
          span: HTMLSpanElement;
          textNode: Text | null;
          startIdx: number;
          endIdx: number;
        }

        const ranges: HighlightRange[] = [];
        let currentRange: HighlightRange | null = null;

        for (let i = normalizedStartIndex; i < normalizedEndIndex && i < charMappings.length; i++) {
          const mapping = charMappings[i];

          // Skip virtual characters (separator spaces that don't exist in the DOM)
          if (mapping.isVirtual) {
            continue;
          }

          if (
            currentRange &&
            currentRange.span === mapping.span &&
            currentRange.endIdx === mapping.originalCharIndex
          ) {
            // Extend current range
            currentRange.endIdx = mapping.originalCharIndex + 1;
          } else if (
            currentRange &&
            currentRange.span === mapping.span &&
            currentRange.endIdx === mapping.originalCharIndex + 1
          ) {
            // Same position (ligature case - multiple normalized chars map to same original)
            // Keep endIdx the same
          } else {
            // Start new range
            if (currentRange) {
              ranges.push(currentRange);
            }
            currentRange = {
              span: mapping.span,
              textNode: mapping.textNode,
              startIdx: mapping.originalCharIndex,
              endIdx: mapping.originalCharIndex + 1,
            };
          }
        }
        if (currentRange) {
          ranges.push(currentRange);
        }

        // Create highlight elements for each range
        for (const range of ranges) {
          if (range.textNode && range.textNode.nodeType === Node.TEXT_NODE) {
            try {
              const domRange = document.createRange();
              const safeStart = Math.min(range.startIdx, range.textNode.length);
              const safeEnd = Math.min(range.endIdx, range.textNode.length);

              if (safeStart >= safeEnd) continue;

              domRange.setStart(range.textNode, safeStart);
              domRange.setEnd(range.textNode, safeEnd);

              const rects = domRange.getClientRects();
              for (let i = 0; i < rects.length; i++) {
                const rect = rects[i];
                if (rect.width === 0 || rect.height === 0) continue;

                const highlight = document.createElement("div");
                highlight.className = "search-highlight-overlay";
                highlight.style.position = "absolute";
                highlight.style.left = `${rect.left - textLayerRect.left}px`;
                highlight.style.top = `${rect.top - textLayerRect.top}px`;
                highlight.style.width = `${rect.width}px`;
                highlight.style.height = `${rect.height}px`;
                highlight.style.backgroundColor = "rgba(255, 235, 59, 0.4)";
                highlight.style.borderRadius = "2px";
                highlight.style.pointerEvents = "none";
                highlight.style.mixBlendMode = "multiply";

                textLayer.appendChild(highlight);
                matchElements.push(highlight);
              }
            } catch (e) {
              // Range might fail for some edge cases, skip this range
              console.warn("Range error:", e);
            }
          }
        }

        // Add this match group if it has any elements
        if (matchElements.length > 0) {
          matchGroups.push(matchElements);
        }

        // Find next occurrence
        if (useSpaceStripped) {
          searchIndex = spaceStrippedText.indexOf(spaceStrippedTerm, searchIndex + 1);
        } else {
          searchIndex = normalizedLower.indexOf(normalizedTerm, searchIndex + 1);
        }
      }
    },
    [normalizeForSearch]
  );

  // Perform search using DOM-based text search with overlay highlights
  // Supports searching across multiple spans and handles ellipses in AI-generated text
  const performSearch = useCallback((term: string) => {
    // Clear previous search highlights
    const existingHighlights = document.querySelectorAll(".search-highlight-overlay");
    existingHighlights.forEach((el) => el.remove());

    if (!term || term.trim() === "") {
      setSearchMatches([]);
      setCurrentMatchIndex(0);
      return;
    }

    // Remove leading/trailing ellipses and split on internal ellipses
    const ellipsisPattern = /\.{3,}|…/g;
    const trimmedTerm = term.replace(/^(\.{3,}|…)+/, '').replace(/(\.{3,}|…)+$/, '');
    const searchParts = trimmedTerm
      .split(ellipsisPattern)
      .map((part) => part.trim())
      .filter((part) => part.length > 3); // Only search for parts with meaningful length

    const matchGroups: HTMLElement[][] = [];

    // Find all text layers in the PDF viewer
    const textLayers = document.querySelectorAll(".textLayer");

    textLayers.forEach((textLayer) => {
      // Search for each part of the term (split by ellipses)
      for (const searchPart of searchParts) {
        searchInTextLayer(textLayer, searchPart, matchGroups);
      }
    });

    setSearchMatches(matchGroups);
    setCurrentMatchIndex(0);

    // Highlight and scroll to first match group
    if (matchGroups.length > 0) {
      // Highlight all elements in the first match group as current
      matchGroups[0].forEach((el) => {
        el.style.backgroundColor = "rgba(255, 152, 0, 0.6)"; // Orange for current
      });
      matchGroups[0][0].scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [searchInTextLayer]);

  // Navigate to next match
  const goToNextMatch = useCallback(() => {
    if (searchMatches.length === 0) return;

    // Reset current match group color
    searchMatches[currentMatchIndex].forEach((el) => {
      el.style.backgroundColor = "rgba(255, 235, 59, 0.4)";
    });

    // Move to next match group
    const nextIndex = (currentMatchIndex + 1) % searchMatches.length;
    setCurrentMatchIndex(nextIndex);

    // Highlight all elements in new current match group and scroll to first
    searchMatches[nextIndex].forEach((el) => {
      el.style.backgroundColor = "rgba(255, 152, 0, 0.6)";
    });
    searchMatches[nextIndex][0].scrollIntoView({ behavior: "smooth", block: "center" });
  }, [searchMatches, currentMatchIndex]);

  // Navigate to previous match
  const goToPreviousMatch = useCallback(() => {
    if (searchMatches.length === 0) return;

    // Reset current match group color
    searchMatches[currentMatchIndex].forEach((el) => {
      el.style.backgroundColor = "rgba(255, 235, 59, 0.4)";
    });

    // Move to previous match group
    const prevIndex = (currentMatchIndex - 1 + searchMatches.length) % searchMatches.length;
    setCurrentMatchIndex(prevIndex);

    // Highlight all elements in new current match group and scroll to first
    searchMatches[prevIndex].forEach((el) => {
      el.style.backgroundColor = "rgba(255, 152, 0, 0.6)";
    });
    searchMatches[prevIndex][0].scrollIntoView({ behavior: "smooth", block: "center" });
  }, [searchMatches, currentMatchIndex]);

  // Handle explicit search term from props
  useEffect(() => {
    if (explicitSearchTerm === lastSearchTermRef.current) return;
    lastSearchTermRef.current = explicitSearchTerm;

    if (explicitSearchTerm) {
      setSearchText(explicitSearchTerm);
      setShowSearchInput(true);
    }
    performSearch(explicitSearchTerm || "");
  }, [explicitSearchTerm, performSearch]);

  // Handle keyboard shortcut for search (Cmd/Ctrl + F)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        setShowSearchInput(true);
        setTimeout(() => searchInputRef.current?.focus(), 0);
      }
      if (e.key === "Escape" && showSearchInput) {
        setShowSearchInput(false);
        setSearchText("");
        performSearch("");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showSearchInput, performSearch]);

  // Handle search input change
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchText(value);
  };

  // Handle search submit - go to next match if already searched
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchMatches.length > 0 && lastSearchTermRef.current === searchText) {
      // Already have results for this term, go to next match
      goToNextMatch();
    } else {
      // New search
      performSearch(searchText);
      lastSearchTermRef.current = searchText;
    }
  };

  // Clear search
  const handleClearSearch = () => {
    setSearchText("");
    setSearchMatches([]);
    setCurrentMatchIndex(0);
    performSearch("");
    setShowSearchInput(false);
  };

  // Handle selection
  const handleSelection = useCallback(
    (selection: PdfSelection) => {
      setCurrentSelection(selection);
      setSelectedText(selection.content.text || "");
      setIsHighlightInteraction(false);

      // Get position for tooltip from the browser selection
      const domSelection = window.getSelection();
      if (domSelection && domSelection.rangeCount > 0) {
        const range = domSelection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        setTooltipPosition({
          x: rect.right,
          y: rect.top + rect.height / 2,
        });
      }
    },
    [setSelectedText, setTooltipPosition, setIsHighlightInteraction]
  );

  // Handle ghost highlight creation (when selection is converted to highlight preview)
  const handleCreateGhostHighlight = useCallback(
    (ghostHighlight: GhostHighlight) => {
      setCurrentGhostHighlight(ghostHighlight);
    },
    []
  );

  // Handle ghost highlight removal
  const handleRemoveGhostHighlight = useCallback(() => {
    setCurrentGhostHighlight(null);
  }, []);

  // Handle adding a highlight from the menu
  const handleAddHighlightFromMenu = useCallback(
    (
      text: string,
      startOffset?: number,
      endOffset?: number,
      pageNumber?: number,
      doAnnotate?: boolean
    ) => {
      if (currentSelection) {
        const ghostHighlight = currentSelection.makeGhostHighlight();
        addHighlight(
          text,
          ghostHighlight.position as ScaledPosition,
          ghostHighlight.position.boundingRect.pageNumber,
          doAnnotate
        );
        setCurrentSelection(null);
        setSelectedText("");
        setTooltipPosition(null);
      }
    },
    [currentSelection, addHighlight, setSelectedText, setTooltipPosition]
  );

  // Handle highlight click
  const handleHighlightClick = useCallback(
    (viewportHighlight: ViewportHighlight<ExtendedHighlight>, event: MouseEvent) => {
      setIsHighlightInteraction(true);
      setSelectedText(viewportHighlight.content?.text || viewportHighlight.raw_text || "");
      setTooltipPosition({ x: event.clientX, y: event.clientY });

      // Find the original highlight with scaled position from our highlights array
      const originalHighlight = extendedHighlights.find(h => h.id === viewportHighlight.id);
      if (originalHighlight) {
        const paperHighlight = extendedToPaperHighlight(originalHighlight);
        setActiveHighlight(paperHighlight);
      }
    },
    [
      setIsHighlightInteraction,
      setSelectedText,
      setTooltipPosition,
      setActiveHighlight,
      extendedHighlights,
    ]
  );

  // Zoom controls
  const zoomIn = useCallback(() => {
    setScale((prev) => Math.min(prev + 0.25, 3));
  }, []);

  const zoomOut = useCallback(() => {
    setScale((prev) => Math.max(prev - 0.25, 0.5));
  }, []);

  // Page navigation using PDF.js viewer
  const goToPreviousPage = useCallback(() => {
    if (currentPage > 1) {
      const viewer = highlighterUtilsRef.current?.getViewer();
      if (viewer) {
        viewer.currentPageNumber = currentPage - 1;
        setCurrentPage(currentPage - 1);
      }
    }
  }, [currentPage]);

  const goToNextPage = useCallback(() => {
    if (numPages && currentPage < numPages) {
      const viewer = highlighterUtilsRef.current?.getViewer();
      if (viewer) {
        viewer.currentPageNumber = currentPage + 1;
        setCurrentPage(currentPage + 1);
      }
    }
  }, [currentPage, numPages]);

  // Scroll to top
  const scrollToTop = useCallback(() => {
    const viewer = highlighterUtilsRef.current?.getViewer();
    if (viewer) {
      viewer.currentPageNumber = 1;
      setCurrentPage(1);
    }
  }, []);

  // Handle outside click to dismiss tooltip
  useEffect(() => {
    if (!tooltipPosition) return;

    const handleOutsideClick = (e: MouseEvent) => {
      const tooltipElement = document.querySelector(".fixed.z-30");
      if (!tooltipElement) return;

      if (!tooltipElement.contains(e.target as Node)) {
        setTimeout(() => {
          setIsHighlightInteraction(false);
          setSelectedText("");
          setTooltipPosition(null);
          setIsAnnotating(false);
          setCurrentSelection(null);
        }, 10);
      }
    };

    const timerId = setTimeout(() => {
      document.addEventListener("mousedown", handleOutsideClick);
    }, 100);

    return () => {
      clearTimeout(timerId);
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  }, [
    tooltipPosition,
    setIsHighlightInteraction,
    setSelectedText,
    setTooltipPosition,
    setIsAnnotating,
  ]);

  // Scroll to active highlight when it changes
  useEffect(() => {
    if (activeHighlight?.id && highlighterUtilsRef.current) {
      const extendedHighlight = extendedHighlights.find(
        (h) => h.id === activeHighlight.id
      );
      if (extendedHighlight) {
        highlighterUtilsRef.current.scrollToHighlight(extendedHighlight);
      }
    }
  }, [activeHighlight, extendedHighlights]);

  return (
    <div
      ref={containerRef}
      className="flex flex-col w-full h-full overflow-hidden"
      id="pdf-container"
    >
      {/* Toolbar */}
      <div className="sticky top-0 z-10 flex items-center justify-between bg-white/80 dark:bg-black/80 backdrop-blur-sm p-2 rounded-none w-full border-b border-gray-300">
        {/* Page navigation */}
        <div className="flex items-center gap-1 mx-2">
          <Button
            onClick={goToPreviousPage}
            size="sm"
            variant="ghost"
            className="h-8 w-8 p-0"
            disabled={currentPage <= 1}
          >
            <ArrowLeft size={16} />
          </Button>
          <span className="text-xs text-secondary-foreground">
            {currentPage} of {numPages || "?"}
          </span>
          <Button
            onClick={goToNextPage}
            size="sm"
            variant="ghost"
            className="h-8 w-8 p-0"
            disabled={!numPages || currentPage >= numPages}
          >
            <ArrowRight size={16} />
          </Button>
        </div>

        {/* Search */}
        <div className="flex items-center gap-1">
          {showSearchInput ? (
            <form onSubmit={handleSearchSubmit} className="flex items-center gap-1">
              <div className="relative">
                <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  ref={searchInputRef}
                  type="text"
                  placeholder="Search..."
                  value={searchText}
                  onChange={handleSearchChange}
                  className="h-8 w-40 pl-7 pr-7 text-xs"
                  autoFocus
                />
                {searchText && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-0 top-1/2 -translate-y-1/2 h-6 w-6 p-0"
                    onClick={handleClearSearch}
                  >
                    <X size={12} />
                  </Button>
                )}
              </div>
              {/* Match count and navigation */}
              {searchMatches.length > 0 ? (
                <>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {currentMatchIndex + 1} of {searchMatches.length}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    onClick={goToPreviousMatch}
                    title="Previous match"
                  >
                    <ChevronUp size={14} />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    onClick={goToNextMatch}
                    title="Next match"
                  >
                    <ChevronDown size={14} />
                  </Button>
                </>
              ) : searchText && lastSearchTermRef.current === searchText ? (
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  No results
                </span>
              ) : null}
            </form>
          ) : (
            <Button
              onClick={() => {
                setShowSearchInput(true);
                setTimeout(() => searchInputRef.current?.focus(), 0);
              }}
              size="sm"
              variant="ghost"
              className="h-8 w-8 p-0"
              title="Search (Cmd+F)"
            >
              <Search size={16} />
            </Button>
          )}
        </div>

        {/* Zoom controls */}
        <div className="flex items-center gap-1">
          <Button
            onClick={zoomOut}
            size="sm"
            variant="ghost"
            className="h-8 w-8 p-0"
          >
            <Minus size={16} />
          </Button>
          <span className="text-xs w-12 text-center">
            {Math.round(scale * 100)}%
          </span>
          <Button
            onClick={zoomIn}
            size="sm"
            variant="ghost"
            className="h-8 w-8 p-0"
          >
            <Plus size={16} />
          </Button>
        </div>

        {/* Status dropdown */}
        {paperStatus && (
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="h-8 px-2">
                  <span className="ml-1 text-xs text-muted-foreground flex items-center gap-1">
                    {getStatusIcon(paperStatus)}
                    {paperStatus}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => handleStatusChange("todo")}>
                  {getStatusIcon("todo")}
                  Todo
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleStatusChange("reading")}>
                  {getStatusIcon("reading")}
                  Reading
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => handleStatusChange("completed")}
                >
                  {getStatusIcon("completed")}
                  Completed
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      {/* PDF Viewer */}
      <div className="flex-1 overflow-hidden relative">
        <PdfLoader
          document={pdfUrl}
          workerSrc="/pdf.worker.mjs"
          beforeLoad={() => <EnigmaticLoadingExperience />}
          errorMessage={(error) => (
            <div className="p-4 text-red-500">
              Error loading PDF: {error.message}
            </div>
          )}
        >
          {(pdfDocument) => {
            // Set numPages when document loads
            if (pdfDocument.numPages !== numPages) {
              setNumPages(pdfDocument.numPages);
            }

            return (
              <PdfHighlighter
                pdfDocument={pdfDocument}
                pdfScaleValue={scale}
                highlights={extendedHighlights}
                onSelection={handleSelection}
                onCreateGhostHighlight={handleCreateGhostHighlight}
                onRemoveGhostHighlight={handleRemoveGhostHighlight}
                enableAreaSelection={(event) => event.altKey}
                utilsRef={(utils) => {
                  highlighterUtilsRef.current = utils;
                }}
                style={{
                  height: "100%",
                }}
                textSelectionColor="rgba(59, 130, 246, 0.3)"
              >
                <HighlightContainer onHighlightClick={handleHighlightClick} />
              </PdfHighlighter>
            );
          }}
        </PdfLoader>
      </div>

      {/* Inline Annotation Menu - shown when text is selected or highlight is clicked */}
      {tooltipPosition && (
        <InlineAnnotationMenu
          selectedText={selectedText}
          tooltipPosition={tooltipPosition}
          setSelectedText={setSelectedText}
          setTooltipPosition={setTooltipPosition}
          setIsAnnotating={setIsAnnotating}
          highlights={highlights}
          setHighlights={setHighlights}
          isHighlightInteraction={isHighlightInteraction}
          activeHighlight={activeHighlight}
          addHighlight={handleAddHighlightFromMenu}
          removeHighlight={removeHighlight}
          setUserMessageReferences={setUserMessageReferences}
        />
      )}

      {/* Scroll to top button */}
      {showScrollToTop && (
        <Button
          onClick={scrollToTop}
          size="sm"
          variant="secondary"
          className="fixed bottom-4 right-4 z-20 rounded-full w-10 h-10 p-0 shadow-lg"
        >
          <ChevronUp size={16} />
        </Button>
      )}
    </div>
  );
}
