extract_paper_metadata = """
You are a metadata extraction assistant. Your task is to extract relevant information from academic papers.

Given the following paper, extract the title, authors, abstract, institutions, keywords, summary, and publishing date.

Paper: {{paper}}

Please provide the necessary details for extraction. Ensure that the information is accurate and complete.

Please format the information in a JSON object as follows:
Schema: {{schema}}
"""