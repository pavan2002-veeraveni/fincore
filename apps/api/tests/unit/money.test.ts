import { describe, it, expect } from 'vitest';
import {
  Currency,
  formatMoney,
  minorToDecimalString,
  toMajorUnits,
  toMinorUnits,
} from '@fincore/contracts';

describe('Money minor-unit arithmetic and formatting', () => {
  it('formats integer paise to exact INR decimal strings without float precision loss', () => {
    expect(minorToDecimalString(0, Currency.INR)).toBe('0.00');
    expect(minorToDecimalString(5, Currency.INR)).toBe('0.05');
    expect(minorToDecimalString(150075, Currency.INR)).toBe('1500.75');
    expect(minorToDecimalString(-25050, Currency.INR)).toBe('-250.50');
  });

  it('formats INR display strings with Indian grouping and symbol', () => {
    expect(formatMoney(150075, Currency.INR)).toBe('₹1,500.75');
    expect(formatMoney(10000000, Currency.INR)).toBe('₹1,00,000.00');
    expect(formatMoney(-500, Currency.INR)).toBe('-₹5.00');
  });

  it('parses decimal string amounts cleanly to minor units without binary float errors', () => {
    expect(toMinorUnits('1500.75', Currency.INR)).toBe(150075);
    expect(toMinorUnits('19.99', Currency.INR)).toBe(1999);
    expect(toMinorUnits('100', Currency.INR)).toBe(10000);
    expect(toMinorUnits('-12.34', Currency.INR)).toBe(-1234);
    expect(toMinorUnits(0.1 + 0.2, Currency.INR)).toBe(30);
    expect(toMajorUnits(150075, Currency.INR)).toBe(1500.75);
  });

  it('rejects malformed or over-precision string money inputs', () => {
    expect(() => toMinorUnits('abc', Currency.INR)).toThrow();
    expect(() => toMinorUnits('12.34.56', Currency.INR)).toThrow();
    expect(() => toMinorUnits('10.559', Currency.INR)).toThrow();
  });
});
