// Bundled sample project. Amounts are integer minor currency units.
export function receiptTotal(lines) {
  return lines.reduce((total, line) => total + line.price, 0);
}
