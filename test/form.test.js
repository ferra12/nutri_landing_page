import { test } from 'node:test';
import assert from 'node:assert/strict';
import { romeToday, minBookingDate, isWeekend } from '../lib/form.js';

test('romeToday restituisce la data di Roma, non UTC', () => {
  // 2026-03-15T23:30Z è già il 16 marzo a Roma (UTC+1)
  assert.equal(romeToday(new Date('2026-03-15T23:30:00Z')), '2026-03-16');
});

test('minBookingDate salta il weekend', () => {
  // giovedì 2026-08-06 + 2 giorni lavorativi = lunedì 2026-08-10
  assert.equal(minBookingDate(new Date('2026-08-06T10:00:00Z')), '2026-08-10');
  // lunedì 2026-08-03 + 2 giorni lavorativi = mercoledì 2026-08-05
  assert.equal(minBookingDate(new Date('2026-08-03T10:00:00Z')), '2026-08-05');
});

test('isWeekend riconosce sabato e domenica', () => {
  assert.equal(isWeekend('2026-08-08'), true);   // sabato
  assert.equal(isWeekend('2026-08-09'), true);   // domenica
  assert.equal(isWeekend('2026-08-10'), false);  // lunedì
});
