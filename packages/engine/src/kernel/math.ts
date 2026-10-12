/** Match Python fixed-point formatting of the actual IEEE-754 value (ties to even). */
export function pythonFixed(value: number, digits: number): string {
  if (!Number.isInteger(digits) || digits < 0 || digits > 20) {
    throw new RangeError('Fixed-point precision must be between 0 and 20');
  }
  if (Number.isNaN(value)) return 'nan';
  if (!Number.isFinite(value)) return value < 0 ? '-inf' : 'inf';
  const data = new DataView(new ArrayBuffer(8));
  data.setFloat64(0, value);
  const bits = data.getBigUint64(0);
  const negative = bits >> 63n !== 0n;
  const exponent = Number((bits >> 52n) & 0x7ffn);
  let mantissa = bits & ((1n << 52n) - 1n);
  if (exponent !== 0) mantissa |= 1n << 52n;
  const power = exponent === 0 ? -1074 : exponent - 1023 - 52;
  const scale = 10n ** BigInt(digits);
  const numerator = mantissa * scale;
  let rounded: bigint;
  if (power >= 0) {
    rounded = numerator << BigInt(power);
  } else {
    const denominator = 1n << BigInt(-power);
    rounded = numerator / denominator;
    const twiceRemainder = (numerator % denominator) * 2n;
    if (twiceRemainder > denominator || (twiceRemainder === denominator && rounded % 2n !== 0n)) {
      rounded += 1n;
    }
  }
  const sign = negative ? '-' : '';
  if (digits === 0) return sign + rounded.toString();
  return `${sign}${rounded / scale}.${(rounded % scale).toString().padStart(digits, '0')}`;
}
