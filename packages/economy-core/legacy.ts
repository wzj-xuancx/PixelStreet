// Adapted idea only: legacy validateSave checks IDs, uniqueness and owned-follow relation.
// No legacy balances, timers, locations or production are imported into this project.
export function normalizeCompanion(owned: unknown, follow: unknown, allowed: readonly string[]): { owned: string[]; follow: string | null } {
  const safe = Array.isArray(owned) ? [...new Set(owned.filter((id): id is string => typeof id === 'string' && allowed.includes(id)))].slice(0, 32) : [];
  return { owned: safe, follow: typeof follow === 'string' && safe.includes(follow) ? follow : null };
}
export function normalizeBag(value: unknown, allowedItems: ReadonlySet<string>): Readonly<Record<string, readonly string[]>> {
  const result: Record<string, string[]> = Object.create(null), seen = new Set<string>();
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return result;
  for (const [sku, ids] of Object.entries(value).slice(0, 16)) {
    if (!/^[a-z][a-z0-9_-]{0,47}$/.test(sku) || !Array.isArray(ids)) continue;
    const clean = ids.filter((id): id is string => typeof id === 'string' && allowedItems.has(id) && !seen.has(id) && !!seen.add(id)).slice(0, 999);
    if (clean.length) result[sku] = clean;
  }
  return result;
}
