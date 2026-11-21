// HTML parsing replaces raw NUL with U+FFFD before CSP checks the inline script.
// JavaScript escapes retain router match IDs and produce the same bytes for hashing.
export function normalizePrerenderHtml(html) {
  return html
    .replace(/\r\n?/g, "\n")
    .replace(
      /(<script\b[^>]*>)([\s\S]*?)(<\/script>)/gi,
      (_, open, code, close) => open + code.replaceAll("\0", "\\u0000") + close,
    );
}
