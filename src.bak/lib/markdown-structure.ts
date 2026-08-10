// ============================================================
//  Markdown Structural Parser
//
//  Parses a Markdown note into structural elements:
//  headings, paragraphs, equations (block + inline), code blocks,
//  links, citations, tags, and frontmatter.
//  Used for structural diff (Phase 6).
// ============================================================

'use strict';

/**
 * Parse a Markdown document into a structure summary.
 *
 * @param {string} text - Markdown content.
 * @returns {Object} structure summary
 */
function parseStructure(text) {
    const content = String(text || '');
    const lines = content.split('\n');

    const headings = [];
    let paragraphs = 0;
    let equations = 0;
    let inlineMath = 0;
    let codeBlocks = 0;
    const links = [];
    const citations = [];
    const tags = [];
    let frontmatter = null;

    let inCode = false;
    let inBlockMath = false;
    let inFrontmatter = false;
    let fmLines = [];
    let paraBuffer = '';

    for (const line of lines) {
        // Frontmatter
        if (!inFrontmatter && line.trim() === '---' && headings.length === 0 && !inCode) {
            inFrontmatter = true;
            fmLines = [];
            continue;
        }
        if (inFrontmatter) {
            if (line.trim() === '---') {
                inFrontmatter = false;
                frontmatter = fmLines.join('\n');
            } else {
                fmLines.push(line);
            }
            continue;
        }

        // Code blocks
        if (/^```/.test(line.trim())) {
            if (!inCode) {
                inCode = true;
                codeBlocks++;
            } else {
                inCode = false;
            }
            continue;
        }
        if (inCode) continue;

        // Block math
        if (/^\$\$/.test(line.trim())) {
            const trimmed = line.trim();
            // Complete on one line: $$E = mc^2$$
            if (trimmed.length > 2 && trimmed.endsWith('$$')) {
                equations++;
                continue;
            }
            if (!inBlockMath) {
                inBlockMath = true;
            } else {
                inBlockMath = false;
                equations++;
            }
            continue;
        }
        if (inBlockMath) continue;

        // Headings
        const hMatch = line.match(/^(#{1,6})\s+(.*)$/);
        if (hMatch) {
            headings.push({ level: hMatch[1].length, text: hMatch[2].trim() });
            continue;
        }

        // Tags
        const tagMatches = line.match(/#[\w-]+/g);
        if (tagMatches) {
            for (const t of tagMatches) tags.push(t.slice(1));
        }

        // Links [[...]]
        const linkMatches = line.match(/\[\[([^\]]+)\]\]/g);
        if (linkMatches) {
            for (const l of linkMatches) links.push(l.slice(2, -2));
        }

        // Citations [text](url) or [Source: ...]
        const citeMatches = line.match(/\[Source:\s*([^\]]+)\]/g);
        if (citeMatches) {
            for (const c of citeMatches) citations.push(c);
        }

        // Inline math $...$
        const inlineMatches = line.match(/\$[^$\n]+\$/g);
        if (inlineMatches) inlineMath += inlineMatches.length;

        // Paragraph counting (non-empty, non-heading, non-code)
        if (line.trim() === '') {
            if (paraBuffer.trim()) paragraphs++;
            paraBuffer = '';
        } else {
            paraBuffer += line + '\n';
        }
    }
    if (paraBuffer.trim()) paragraphs++;

    return {
        headings,
        paragraphCount: paragraphs,
        equationCount: equations,
        inlineMathCount: inlineMath,
        codeBlockCount: codeBlocks,
        links,
        citations,
        tags,
        frontmatter,
    };
}

/**
 * Compute a structural diff between two structure summaries.
 *
 * @param {Object} oldStruct - Structure of previous version.
 * @param {Object} newStruct - Structure of current version.
 * @returns {Object} categorized changes
 */
function structuralDiff(oldStruct, newStruct) {
    const changes = [];
    const oldH = oldStruct.headings.map(h => '#'.repeat(h.level) + ' ' + h.text);
    const newH = newStruct.headings.map(h => '#'.repeat(h.level) + ' ' + h.text);

    // Headings added/removed
    for (const h of newH) if (!oldH.includes(h)) changes.push({ type: 'heading_added', value: h });
    for (const h of oldH) if (!newH.includes(h)) changes.push({ type: 'heading_removed', value: h });

    // Paragraphs
    if (newStruct.paragraphCount > oldStruct.paragraphCount) {
        changes.push({ type: 'paragraphs_added', count: newStruct.paragraphCount - oldStruct.paragraphCount });
    } else if (oldStruct.paragraphCount > newStruct.paragraphCount) {
        changes.push({ type: 'paragraphs_removed', count: oldStruct.paragraphCount - newStruct.paragraphCount });
    }

    // Equations
    if (newStruct.equationCount !== oldStruct.equationCount) {
        changes.push({ type: 'equation_modified', old: oldStruct.equationCount, new: newStruct.equationCount });
    }

    // Citations
    for (const c of newStruct.citations) if (!oldStruct.citations.includes(c)) changes.push({ type: 'citation_added', value: c });
    for (const c of oldStruct.citations) if (!newStruct.citations.includes(c)) changes.push({ type: 'citation_removed', value: c });

    // Links
    for (const l of newStruct.links) if (!oldStruct.links.includes(l)) changes.push({ type: 'link_added', value: l });
    for (const l of oldStruct.links) if (!newStruct.links.includes(l)) changes.push({ type: 'link_removed', value: l });

    // Tags
    for (const t of newStruct.tags) if (!oldStruct.tags.includes(t)) changes.push({ type: 'tag_added', value: t });
    for (const t of oldStruct.tags) if (!newStruct.tags.includes(t)) changes.push({ type: 'tag_removed', value: t });

    // Code blocks
    if (newStruct.codeBlockCount !== oldStruct.codeBlockCount) {
        changes.push({ type: 'code_blocks_changed', old: oldStruct.codeBlockCount, new: newStruct.codeBlockCount });
    }

    return changes;
}

/**
 * Render a structural diff as a categorized tree.
 */
function renderStructuralDiff(changes) {
    const labels = {
        heading_added: 'Heading added',
        heading_removed: 'Heading removed',
        paragraphs_added: 'Paragraphs added',
        paragraphs_removed: 'Paragraphs removed',
        equation_modified: 'Equation modified',
        citation_added: 'Citation added',
        citation_removed: 'Citation removed',
        link_added: 'Link added',
        link_removed: 'Link removed',
        tag_added: 'Tag added',
        tag_removed: 'Tag removed',
        code_blocks_changed: 'Code blocks changed',
    };
    const lines = ['Changed:'];
    for (const c of changes) {
        const label = labels[c.type] || c.type;
        if (c.count) {
            lines.push(`├── ${label}: ${c.count}`);
        } else if (c.value) {
            lines.push(`├── ${label}: ${c.value}`);
        } else {
            lines.push(`├── ${label}: ${c.old} → ${c.new}`);
        }
    }
    if (changes.length === 0) lines.push('└── No structural changes');
    return lines.join('\n');
}

module.exports = { parseStructure, structuralDiff, renderStructuralDiff };