/** Fixups applied to model-authored markdown on its way to being rendered.
 *
 * Raw HTML stays disabled in the markdown pipeline, because model output is
 * untrusted. That is the right default and it has a cost: anything the model
 * writes as a tag arrives here as literal text, so the few tags worth honouring
 * have to be turned back into nodes by hand.
 *
 * Break tags are the only rule so far. The file is named for the job rather
 * than for that one rule, so the next thing a model's output needs on the way
 * to the DOM has an obvious home.
 */

import React from 'react';

/** A literal `<br>`, which models emit inside GFM table cells because a cell
 * has no other way to hold more than one line.
 *
 * Deliberately not a global regex: `split` handles every occurrence either way,
 * and a global regex carries `lastIndex` across `.test()` calls, which would
 * make it skip strings at random.
 */
export const BREAK_TAG = /<br\s*\/?>/i;

export function hasBreakTag(text: string): boolean {
    return BREAK_TAG.test(text);
}

/** Split one string into nodes, with a `<br />` between each line. */
export function breakTagsToNodes(text: string, key: string): React.ReactNode {
    if (!BREAK_TAG.test(text)) return text;
    return text.split(BREAK_TAG).map((part, index) => (
        <React.Fragment key={`${key}-${index}`}>
            {index > 0 && <br />}
            {part}
        </React.Fragment>
    ));
}

/** Walk arbitrary children, applying the fixups above wherever a string
 * appears. Elements are recursed into rather than rewritten, so a node the
 * markdown pipeline already built keeps its own props. */
export function preFormatTextForRendering(node: React.ReactNode, key: string): React.ReactNode {
    if (typeof node === 'string') return breakTagsToNodes(node, key);
    if (Array.isArray(node)) {
        return node.map((child, index) => (
            <React.Fragment key={`${key}-${index}`}>
                {preFormatTextForRendering(child, `${key}-${index}`)}
            </React.Fragment>
        ));
    }
    // A break can land inside emphasis or a link, so recurse through elements.
    if (React.isValidElement(node)) {
        const props = node.props as { children?: React.ReactNode };
        if (props?.children !== undefined) {
            return React.cloneElement(
                node as React.ReactElement<{ children?: React.ReactNode }>,
                { children: preFormatTextForRendering(props.children, `${key}-c`) },
            );
        }
    }
    return node;
}

/** Cell text with `<br>` preserved as newlines.
 *
 * `textContent` concatenates across a line break, so a copied multi-line cell
 * would otherwise read "…1.12–1.38)• First Trimester…".
 */
export function cellText(cell: Element): string {
    let text = '';
    const walk = (node: Node) => {
        if (node.nodeType === Node.TEXT_NODE) {
            text += node.textContent ?? '';
            return;
        }
        if (node.nodeName === 'BR') {
            text += '\n';
            return;
        }
        node.childNodes.forEach(walk);
    };
    cell.childNodes.forEach(walk);
    return text.trim();
}
