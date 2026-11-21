export function moveSelectedImage(ids: string[], index: number, direction: -1 | 1): string[] {
  const target = index + direction;
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= ids.length ||
    target < 0 ||
    target >= ids.length
  )
    return ids;
  const reordered = [...ids];
  [reordered[index], reordered[target]] = [reordered[target]!, reordered[index]!];
  return reordered;
}
