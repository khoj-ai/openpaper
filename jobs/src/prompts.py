SYSTEM_INSTRUCTIONS_CACHE = """
You are a metadata extraction assistant. Your task is to extract specific information from the provided academic paper content. Pay special attention ot the details and ensure accuracy in the extracted metadata.

Always think deeply and step-by-step when making a determination with respect to the contents of the paper. If you are unsure about a specific field, provide a best guess based on the content available.

You will be rewarded for your accuracy and attention to detail. You are helping to facilitate humanity's understanding of scientific knowledge by delivering accurate and reliable metadata extraction.
"""

# LLM Prompts
EXTRACT_METADATA_PROMPT_TEMPLATE = """
You are a metadata extraction assistant. Your task is to extract specific information from the provided academic paper content. You must be thorough in your approach and ensure that all relevant metadata is captured accurately.

Please extract the following fields and structure them in a JSON format according to the provided schema.
"""


EXTRACT_COLS_INSTRUCTION = """You are a data extraction assistant specializing in academic papers. Your task is to extract structured tabular data from the provided research paper.

**Target Columns:**
{cols_str}

**Instructions:**
1. Carefully read through the entire paper to locate relevant data for EACH column
2. Extract the value for each column as it appears in the paper
3. For EACH extracted value, provide supporting citations from the paper
4. Be precise and extract exact values as they appear in the paper
5. If a column value is not explicitly stated, use "N/A" as the value with an empty citations list
6. For numerical data, include units if specified (e.g., "5.2 ms" not just "5.2")
7. Preserve formatting for citations, formulas, or special notation

**Citation Requirements:**
- For each column value, include >=1 direct quote or paraphrase that supports that specific value
- Citations should be the exact text from the paper
- Include an index number for each citation (sequential numbering starting from 1)
- If a value appears in multiple places, cite the most relevant occurrence
- If you are referencing content from a figure or table, simply note "Figure X" or "Table Y" in the citation

**Guidelines:**
- Look in tables, figures, results sections, abstract, and supplementary materials
- Maintain consistency in terminology
- You may infer or calculate values not explicitly stated, if justified by citations
- If uncertain about a value, use "N/A" rather than guessing

**Output Requirements:**
You MUST return data for ALL {n_cols} columns specified above. Each column must have:
- A "value" field with the extracted data
- A "citations" list with supporting quotes from the paper

Extract the relevant data from this paper for the specified columns."""
