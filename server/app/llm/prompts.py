EXTRACT_PAPER_METADATA = """
You are a metadata extraction assistant. Your task is to extract relevant information from academic papers.

Given the following paper, extract the title, authors, abstract, institutions, keywords, summary, useful starter questions that can be asked about the paper, and the publish date. The information should be structured in a JSON format.

Paper: {paper}

Please provide the necessary details for extraction. Ensure that the information is accurate and complete.

Please format the information in a JSON object as follows:
Schema: {schema}
"""
