/**
 * Pretty-print any JSON objects or arrays found in the text with 2-space
 * indentation, in place. JSON may span the whole string or be embedded in
 * surrounding prose; non-JSON content passes through unchanged.
 */
export function prettifyMaybeJson(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '{' || ch === '[') {
      const end = findBalancedEnd(text, i);
      if (end !== -1) {
        try {
          out += JSON.stringify(JSON.parse(text.slice(i, end + 1)), null, 2);
          i = end + 1;
          continue;
        } catch {
          // not valid JSON — fall through and emit the character as-is
        }
      }
    }
    out += ch;
    i++;
  }
  return out;
}

/**
 * Index of the bracket closing the one at `start`, respecting JSON string
 * literals and escapes, or -1 if the text ends before it balances.
 */
function findBalancedEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === '{' || ch === '[') {
      depth++;
    } else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}
