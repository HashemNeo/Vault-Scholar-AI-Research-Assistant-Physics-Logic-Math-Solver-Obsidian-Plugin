// ============================================================
//  String Utilities (lodash-es wrappers)
// ============================================================

import { truncate as lodashTruncate, deburr, kebabCase } from 'lodash-es';

/**
 * Truncate a string to `max` chars, appending ellipsis.
 */
export function truncate(str: string, max: number): string {
    if (!str) return '';
    return str.length > max ? str.slice(0, max) + '…' : str;
}

/**
 * Sanitize a filename: keep alphanumeric, dash, underscore; max 60 chars.
 */
export function sanitizeFilename(name: string): string {
    return String(name || '').replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 60);
}

/**
 * Convert any string to a kebab-case slug.
 */
export function slugify(name: string): string {
    return kebabCase(deburr(String(name || '')));
}