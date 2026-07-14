export function paginate<T extends { id: number }>(
  rows: T[],
  take: number,
): { data: T[]; nextCursor: string | null } {
  const hasMore = rows.length > take;
  const data = hasMore ? rows.slice(0, take) : rows;
  const nextCursor = hasMore ? String(data[data.length - 1]!.id) : null;
  return { data, nextCursor };
}
