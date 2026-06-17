/**
 * Generate a URL-safe slug from text, suitable for use as an AT Protocol record key (rkey).
 *
 * Valid rkey characters: A-Za-z0-9._-:~  (max 512 chars)
 * This function produces a subset: [a-z0-9-]
 *
 * @param text - The input text (typically a title)
 * @param maxLength - Maximum slug length (default 64, AT Protocol max is 512)
 */
export function slugify(text: string, maxLength = 64): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // strip diacritics (é → e, ñ → n, etc.)
    .replace(/[^a-z0-9]+/g, '-')       // non-alphanum runs → single dash
    .replace(/(^-|-$)/g, '')           // trim leading/trailing dashes
    .substring(0, maxLength)
    .replace(/-$/, '');                // trim trailing dash if truncation left one
}

/**
 * Validate a string as a legal AT Protocol record key.
 * See: https://atproto.com/specs/record-key
 */
export function isValidRkey(rkey: string): boolean {
  if (rkey.length < 1 || rkey.length > 512) return false;
  if (rkey === '.' || rkey === '..') return false;
  return /^[A-Za-z0-9._~:-]+$/.test(rkey);
}
