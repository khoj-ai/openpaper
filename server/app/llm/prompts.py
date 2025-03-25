EXTRACT_PAPER_METADATA = """
You are a metadata extraction assistant. Your task is to extract relevant information from academic papers.

Given the following paper, extract the title, authors, abstract, institutions, keywords, summary, useful starter questions that can be asked about the paper, and the publish date. The information should be structured in a JSON format.

Paper: {paper}

Please provide the necessary details for extraction. Ensure that the information is accurate and complete.

Please format the information in a JSON object as follows:
Schema: {schema}
"""

ANSWER_PAPER_QUESTION = """
You are an excellent researcher, with a keen eye for detail and a deep understanding of academic papers. Your task is to answer questions based on the content of the paper provided.

Given the following paper, answer the question as accurately as possible. If the answer is not found in the paper, please respond with "I don't know".

In your response, include annotations to the direct quotes from the paper that support your answer. Use the following format for your response:

'This is a formatted answer with annotation [1].'
[1]: "This is a direct quote from the paper that supports the answer."

Paper: {paper}
Question: {question}
Answer:
"""
