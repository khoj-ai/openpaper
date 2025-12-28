// Ligatures that expand to multiple characters
export const ligatureMap: Record<string, string> = {
	'\ufb01': 'fi', '\ufb02': 'fl', '\ufb03': 'ffi', '\ufb04': 'ffl',
};

// Greek letters and common math symbols - maps Unicode to ASCII representation
// This allows matching between PDF-rendered symbols and LaTeX input
export const greekLetterMap: Record<string, string> = {
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
export const latexCommandMap: Record<string, string> = {
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
export const quoteChars = new Set([
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
export function expandLatexCommands(text: string): string {
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
}

// Normalize text for search matching:
// - Expand LaTeX commands to ASCII equivalents
// - Expand ligatures
// - Expand Greek letters to ASCII equivalents
// - Remove all quote characters entirely
// - Keep only alphanumeric characters and spaces
export function normalizeForSearch(text: string): string {
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
}
