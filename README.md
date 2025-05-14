# ![Open Paper](https://raw.githubusercontent.com/sabaimran/openpaper/refs/heads/master/client/src/app/annotated_paper.svg) Open Paper


When reading lots of papers for research, it can be hard to keep track of your notes and annotations. When you need to go deeper into a specific topic or clarify something you don't understand, you may switch contexts many times to look up terms, concepts, related research.

I wanted to build something for myself that helped me address some of these issues in one place.

The Open Paper is a place to upload your paper, highlight, leave comments, take notes, and chat all in one place. Search through your existing corpus of annotated papers.

![The Open Paper](./demo.gif)

## AI-powered copilot

![ai copilot](https://assets.khoj.dev/annotated_paper_chat_assistant.png)

AI is very useful at helping us elicit an understanding of new information in large, complex documents and translating between complexity <-> simplicity. This is useful in a research context, where the true meaning behind an insight, methodology, or hypothesis may not be immediately apparent. We want to build better bridges between where we are and where we need to go.

As soon as you upload your PDF, you'll be taken to the page view, which shows you an AI-generated brief on the paper, and some good starter questions. You can use these to quickly ground yourself before diving in.

The AI copilot uses a citations annotation protocol that pushes it to ground its responses in the context of the protocol, while making it easy for you to click and navigate to the exact location in the document where that context may have appeared. One of the challenges here was implementing it in an efficient way where the response could be grounded, but still streamed back to the user for speed. The lookup logic relies on string matching, so it currently is imperfect, but it works well enough for most cases.

## Parallel Views

![parallel view](https://assets.khoj.dev/annotated_paper_parallel_view.png)

Many tools currently allow you to upload your raw documents and chat with them, but they typically don't show the document in a parallel view. For me, this is a necessary feature as I still need to actually read the document. I want to use an LLM to give me an overview, provide context, extract references, but I want it to do it grounded in the context of the file I'm currently reading. Moreover, I want to highlight, take notes, annotate, all in one place. The split view allows me to do that more easily.

In context of your PDF, try highlighting a section of the text to see an inline menu that quickly lets you take deeper actions.

## Knowledge Base Search

Since you can upload many of your PDFs all in one place, you can also search for them in that centralized spot. Quickly find the paper you might be thinking of in context of your corpus.

## Annotations

![annotations](https://assets.khoj.dev/annotated_paper_highlight_annotations.png)

Highlights and annotations should help you quickly recall your insights in a given paper and navigate to the particular area of interest.

## Notes

Takes notes directly in context with your paper. You can use the toggle at the top of the section to view them in markdown format.

## Run it Locally

This project uses a separate server & client to run the web application

```bash
git clone git@github.com:sabaimran/openpaper.git
```

To start the server, see instructions in `/server`. To start the client, see instructions in `/client`.
