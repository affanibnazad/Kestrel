// Supabase returns at most 1000 rows per request (the API "Max rows" setting), and a bigger .limit() is cut
// silently. fetchAll reads page after page until a short page comes back. The query must have a stable order
// (end it with a unique column such as id) so rows are not skipped or repeated between pages.
type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
// onPage (19 Nov 2026): called with everything read so far after each step, so a screen can show the first 1000 rows
// at once instead of 0 until the last page arrives. After a full first page, the next pages are read 3 at a time.
const AT_ONCE = 3;
export async function fetchAll<T>(page: (from: number, to: number) => Page<T>, max = 100_000, size = 1000, onPage?: (sofar: T[]) => void): Promise<{ data: T[]; error: { message: string } | null }> {
  const out: T[] = [];
  let from = 0, at = 1;
  while (from < max) {
    const starts: number[] = [];
    for (let k = 0; k < at && from + k * size < max; k++) starts.push(from + k * size);
    const pages = await Promise.all(starts.map((f) => page(f, Math.min(f + size, max) - 1)));
    for (const { data, error } of pages) {
      if (error) return { data: out, error };
      out.push(...(data ?? []));
      if (!data || data.length < size) { onPage?.(out.slice()); return { data: out, error: null }; }
    }
    onPage?.(out.slice());
    from += starts.length * size;
    at = AT_ONCE;
  }
  return { data: out, error: null };
}
