/** "Competitor A!" → "competitor-a" (safe for file names). */
export function slugify(s: string, max = 60): string {
  return (
    s
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9ঀ-৿]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, max) || "item"
  );
}
