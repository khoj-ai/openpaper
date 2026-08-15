import React from 'react';

/** Turn literal `<br>` text into real line breaks.
 *
 * Models keep emitting `<br>` inside GFM table cells, because a cell has no
 * other way to hold more than one line. Raw HTML stays disabled in the markdown
 * pipeline — model output is untrusted — so the tag survives as plain text and
 * has to be converted here.
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

/** Walk arbitrary children, converting break tags wherever a string appears. */
export function splitOnBreakTags(node: React.ReactNode, key: string): React.ReactNode {
    if (typeof node === 'string') return breakTagsToNodes(node, key);
    if (Array.isArray(node)) {
        return node.map((child, index) => (
            <React.Fragment key={`${key}-${index}`}>
                {splitOnBreakTags(child, `${key}-${index}`)}
            </React.Fragment>
        ));
    }
    // A break can land inside emphasis or a link, so recurse through elements.
    if (React.isValidElement(node)) {
        const props = node.props as { children?: React.ReactNode };
        if (props?.children !== undefined) {
            return React.cloneElement(
                node as React.ReactElement<{ children?: React.ReactNode }>,
                { children: splitOnBreakTags(props.children, `${key}-c`) },
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
