/** Compare absolute drive paths from Windows pickers and Git without rewriting the stored path.
 * Use the path's syntax rather than the client's OS: the sidebar can show a remote host.
 * Keep directory names case-sensitive so distinct folders are never merged by case alone.
 */
export function projectPathKey(dir: string): string {
  if (!/^[a-z]:[\\/]/i.test(dir)) return dir;
  const normalized = dir[0].toUpperCase() + dir.slice(1).replace(/[\\/]+/g, '/');
  return normalized.length > 3 ? normalized.replace(/\/$/, '') : normalized;
}
