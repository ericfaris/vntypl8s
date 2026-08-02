import { describe, expect, it } from 'vitest';
import {
  PLATE_ALPHABET,
  PLATE_MAX_LENGTH,
  satisfiesRequirements,
  validatePlate,
  VOWELS,
} from '@vntypl8s/shared';

describe('plate alphabet', () => {
  it('is 31 symbols: 21 non-vowel letters (Y included) + 10 digits', () => {
    expect(PLATE_ALPHABET).toHaveLength(31);
    expect(PLATE_ALPHABET).toContain('Y');
    for (const v of VOWELS) expect(PLATE_ALPHABET).not.toContain(v);
    for (const d of '0123456789') expect(PLATE_ALPHABET).toContain(d);
  });
});

describe('validatePlate — mechanical Plate Creation Rules', () => {
  const cases: [string, boolean, string | null][] = [
    ['BRF5X', true, null],
    ['Y', true, null],
    ['BCDFGHJK', true, null], // exactly 8
    ['12345678', true, null],
    ['B1C2D3F4', true, null],
    ['', false, 'EMPTY'],
    ['BCDFGHJKL', false, 'TOO_LONG'], // 9
    ['brf5x', false, 'LOWERCASE'],
    ['BRAF', false, 'VOWEL'],
    ['BREF', false, 'VOWEL'],
    ['BRIF', false, 'VOWEL'],
    ['BROF', false, 'VOWEL'],
    ['BRUF', false, 'VOWEL'],
    ['BR F', false, 'WHITESPACE'],
    ['BR\tF', false, 'WHITESPACE'],
    ['BR-F', false, 'ILLEGAL_CHAR'],
    ['BR.F', false, 'ILLEGAL_CHAR'],
    ['BR!F', false, 'ILLEGAL_CHAR'],
    ['BR🚗', false, 'ILLEGAL_CHAR'],
    ['ÑBC', false, 'ILLEGAL_CHAR'],
  ];

  it.each(cases)('validatePlate(%j) -> ok=%s error=%s', (plate, expectedOk, expectedErr) => {
    const res = validatePlate(plate);
    expect(res.ok).toBe(expectedOk);
    expect(res.error).toBe(expectedErr);
  });

  it('accepts every single symbol in the alphabet', () => {
    for (const ch of PLATE_ALPHABET) expect(validatePlate(ch).ok).toBe(true);
  });

  it('caps at PLATE_MAX_LENGTH', () => {
    expect(validatePlate('B'.repeat(PLATE_MAX_LENGTH)).ok).toBe(true);
    expect(validatePlate('B'.repeat(PLATE_MAX_LENGTH + 1)).ok).toBe(false);
  });
});

describe('satisfiesRequirements — subsequence, not substring', () => {
  it.each([
    ['RF5', 'RF5', true], // exact
    ['BRF5X', 'RF5', true], // contiguous, padded
    ['R1F2503', 'RF5', true], // non-contiguous but in order
    ['B5RF', 'RF5', false], // out of order
    ['RF', 'RF5', false], // missing a char
    ['', 'RF5', false],
    ['5RF', 'RF5', false],
    ['RRFF55', 'RF5', true], // duplicates are fine
    ['RFRF5', 'RF5', true], // first R consumed, later F/5 complete it
    ['BBBRBBF5', 'RF5', true],
    ['FFF555', 'RF5', false], // R never appears
    ['RRR', 'RRR', true],
    ['RR', 'RRR', false],
  ])('satisfiesRequirements(%j, %j) === %s', (plate, required, expected) => {
    expect(satisfiesRequirements(plate, required)).toBe(expected);
  });
});
