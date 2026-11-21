export function centavosToPesos(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid saved amount.");
  const cents = BigInt(value);
  return `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}
