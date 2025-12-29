import { useState, useEffect, useCallback, useRef } from "react";
import { PaperHighlight, ScaledPosition } from "@/lib/schema";
import { fetchFromApi } from "@/lib/api";

export function useHighlighterHighlights(
	paperId: string,
	readOnlyHighlights: Array<PaperHighlight> = []
) {
	const [highlights, setHighlights] = useState<Array<PaperHighlight>>([]);
	const [selectedText, setSelectedText] = useState<string>("");
	const [tooltipPosition, setTooltipPosition] = useState<{
		x: number;
		y: number;
	} | null>(null);
	const [isAnnotating, setIsAnnotating] = useState(false);
	const [isHighlightInteraction, setIsHighlightInteraction] = useState(false);
	const [activeHighlight, setActiveHighlight] =
		useState<PaperHighlight | null>(null);
	const blockScrollOnNextHighlight = useRef(false);

	// Fetch highlights from server
	const fetchHighlights = useCallback(async () => {
		try {
			const data: PaperHighlight[] = await fetchFromApi(
				`/api/highlight/${paperId}`,
				{
					method: "GET",
					headers: {
						"Content-Type": "application/json",
						Accept: "application/json",
					},
				}
			);

			// Filter valid highlights - require either position or offsets
			const validHighlights = data.filter(
				(h) =>
					h.raw_text &&
					(h.position ||
						(typeof h.start_offset === "number" &&
							typeof h.end_offset === "number"))
			);

			// Deduplicate
			const deduplicatedHighlights = validHighlights.filter(
				(highlight, index, self) =>
					index ===
					self.findIndex(
						(h) =>
							h.id === highlight.id ||
							(h.raw_text === highlight.raw_text &&
								h.page_number === highlight.page_number)
					)
			);

			setHighlights(deduplicatedHighlights);
		} catch (error) {
			console.error("Error loading highlights from server:", error);
		}
	}, [paperId]);

	// Send highlight to server
	const sendHighlightToServer = async (
		highlight: Omit<PaperHighlight, "id">
	): Promise<PaperHighlight | undefined> => {
		// Check for duplicates
		const isDuplicate = highlights.some(
			(h) =>
				h.raw_text === highlight.raw_text &&
				h.page_number === highlight.page_number
		);

		if (isDuplicate) {
			return;
		}

		const payload = {
			paper_id: paperId,
			raw_text: highlight.raw_text,
			page_number: highlight.page_number,
			position: highlight.position,
			role: highlight.role || "user",
		};

		try {
			const data = await fetchFromApi(`/api/highlight`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json",
				},
				body: JSON.stringify(payload),
			});
			return data;
		} catch (error) {
			console.error("Error sending highlight to server:", error);
		}
	};

	// Remove highlight from server
	const removeHighlightFromServer = async (highlight: PaperHighlight) => {
		try {
			await fetchFromApi(`/api/highlight/${highlight.id}`, {
				method: "DELETE",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json",
				},
			});

			setHighlights((prev) => prev.filter((h) => h.id !== highlight.id));
		} catch (error) {
			console.error("Error removing highlight from server:", error);
		}
	};

	// Add a new highlight with position data
	const addHighlight = useCallback(
		async (
			selectedText: string,
			position?: ScaledPosition,
			pageNumber?: number,
			doAnnotate?: boolean
		) => {
			if (!position) {
				console.error("Position is required for highlights");
				return;
			}

			const newHighlight: Omit<PaperHighlight, "id"> = {
				raw_text: selectedText,
				role: "user",
				page_number: pageNumber || position.boundingRect.pageNumber,
				position: position,
			};

			try {
				const savedHighlight = await sendHighlightToServer(newHighlight);

				if (savedHighlight) {
					if (doAnnotate) {
						blockScrollOnNextHighlight.current = true;
						setActiveHighlight(savedHighlight);
						setIsAnnotating(true);
					}

					setHighlights((prev) => [...prev, savedHighlight]);
				}
			} catch (error) {
				console.error("Error adding highlight:", error);
			}

			// Reset states
			setSelectedText("");
			setTooltipPosition(null);
			if (!doAnnotate) {
				setIsAnnotating(false);
			}
		},
		[highlights]
	);

	// Remove a highlight
	const removeHighlight = useCallback((highlight: PaperHighlight) => {
		removeHighlightFromServer(highlight);
	}, []);

	// Handle text selection (for compatibility, though not used with new viewer)
	const handleTextSelection = useCallback(
		(e: React.MouseEvent | MouseEvent) => {
			const selection = window.getSelection();
			if (selection && selection.toString()) {
				let text = selection.toString();
				setIsHighlightInteraction(false);

				// Normalize the text
				text = text.replace(/\s+/g, " ").trim();
				setSelectedText(text);

				setTooltipPosition({
					x: e.clientX,
					y: e.clientY,
				});
			} else {
				if (!isHighlightInteraction && selectedText) {
					setTimeout(() => {
						if (!isHighlightInteraction) {
							const currentSelection = window.getSelection();
							if (!currentSelection?.toString()) {
								setSelectedText("");
							}
							setTooltipPosition(null);
						}
					}, 200);
				}
			}
		},
		[isHighlightInteraction, selectedText]
	);

	// Clear highlights from state
	const clearHighlights = useCallback(() => {
		setHighlights([]);
	}, []);

	// Refresh highlights
	const refreshHighlights = useCallback(async () => {
		await fetchHighlights();
	}, [fetchHighlights]);

	// Load highlights on mount or when readOnlyHighlights changes
	useEffect(() => {
		if (readOnlyHighlights.length > 0) {
			setHighlights(readOnlyHighlights);
		} else {
			fetchHighlights();
		}
	}, [paperId, readOnlyHighlights.length, fetchHighlights]);

	// Reset interaction state when selectedText is cleared
	useEffect(() => {
		if (!selectedText) {
			setIsHighlightInteraction(false);
		}
	}, [selectedText]);

	// Handle active highlight scrolling
	useEffect(() => {
		if (activeHighlight && !blockScrollOnNextHighlight.current) {
			// Scrolling is handled by the PdfHighlighter component via utilsRef
		}
		blockScrollOnNextHighlight.current = false;
	}, [activeHighlight]);

	return {
		highlights,
		setHighlights,
		selectedText,
		setSelectedText,
		tooltipPosition,
		setTooltipPosition,
		isAnnotating,
		setIsAnnotating,
		isHighlightInteraction,
		setIsHighlightInteraction,
		activeHighlight,
		setActiveHighlight,
		handleTextSelection,
		clearHighlights,
		addHighlight,
		removeHighlight,
		fetchHighlights,
		refreshHighlights,
	};
}
