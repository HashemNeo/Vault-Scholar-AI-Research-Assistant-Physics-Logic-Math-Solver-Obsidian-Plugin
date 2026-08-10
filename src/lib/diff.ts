// ============================================================
//  Text Diff Engine (LCS-based line diff)
//
//  Produces a list of operations ('equal' | 'add' | 'remove')
//  between two texts, rendered like:
//    - Gravity is a force.
//    + Gravity is spacetime curvature.
// ============================================================

export type DiffOpType = 'equal' | 'add' | 'remove';

export interface DiffOp {
    type: DiffOpType;
    oldLine?: string;
    newLine?: string;
    oldIndex?: number;
    newIndex?: number;
}

export interface DiffStats {
    added: number;
    removed: number;
    unchanged: number;
}

/**
 * Compute a line-level diff between two strings using LCS.
 */
export function diffLines(oldText: string, newText: string): DiffOp[] {
    const a = String(oldText || '').split('\n');
    const b = String(newText || '').split('\n');

    // LCS dynamic programming table
    const n = a.length;
    const m = b.length;
    const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));

    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            if (a[i] === b[j]) {
                dp[i][j] = dp[i + 1][j + 1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
            }
        }
    }

    // Walk the table
    const ops: DiffOp[] = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
        if (a[i] === b[j]) {
            ops.push({ type: 'equal', oldLine: a[i], newLine: b[j], oldIndex: i, newIndex: j });
            i++; j++;
        } else if (dp[i + 1][j] >= dp[i][j + 1]) {
            ops.push({ type: 'remove', oldLine: a[i], oldIndex: i });
            i++;
        } else {
            ops.push({ type: 'add', newLine: b[j], newIndex: j });
            j++;
        }
    }
    while (i < n) {
        ops.push({ type: 'remove', oldLine: a[i], oldIndex: i });
        i++;
    }
    while (j < m) {
        ops.push({ type: 'add', newLine: b[j], newIndex: j });
        j++;
    }

    return ops;
}

/**
 * Render a diff as unified text with -/+ markers.
 */
export function renderUnified(ops: DiffOp[]): string {
    const lines: string[] = [];
    for (const op of ops) {
        if (op.type === 'equal') {
            lines.push('  ' + (op.oldLine || ''));
        } else if (op.type === 'remove') {
            lines.push('- ' + (op.oldLine || ''));
        } else {
            lines.push('+ ' + (op.newLine || ''));
        }
    }
    return lines.join('\n');
}

/**
 * Compute basic change statistics.
 */
export function diffStats(ops: DiffOp[]): DiffStats {
    let added = 0, removed = 0, unchanged = 0;
    for (const op of ops) {
        if (op.type === 'add') added++;
        else if (op.type === 'remove') removed++;
        else unchanged++;
    }
    return { added, removed, unchanged };
}