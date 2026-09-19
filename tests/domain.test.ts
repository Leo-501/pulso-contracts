import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  allowedTransitions,
  dateSchema,
  localDate,
  occurrenceDate,
} from '../src/index.js';

test('mensal no dia 31 usa último dia e preserva a âncora em março', () => {
  assert.equal(occurrenceDate('2026-01-31', 'monthly', 1, 1), '2026-02-28');
  assert.equal(occurrenceDate('2026-01-31', 'monthly', 1, 2), '2026-03-31');
  assert.equal(occurrenceDate('2024-01-31', 'monthly', 1, 1), '2024-02-29');
});
test('recorrência semanal cruza ano sem deslocamento por horário de verão', () => {
  assert.equal(occurrenceDate('2026-12-28', 'weekly', 2, 1), '2027-01-11');
});
test('datas impossíveis são rejeitadas e o calendário usa o fuso da unidade', () => {
  assert.equal(dateSchema.safeParse('2026-02-31').success, false);
  assert.equal(dateSchema.safeParse('2024-02-29').success, true);
  assert.equal(localDate(new Date('2026-09-13T01:30:00Z')), '2026-09-12');
});
test('técnico conclui execução, gestor valida e OS encerrada permanece imutável', () => {
  assert.ok(allowedTransitions('in_progress', 'technician').includes('review'));
  assert.deepEqual(allowedTransitions('review', 'technician'), []);
  assert.ok(allowedTransitions('review', 'manager').includes('closed'));
  assert.deepEqual(allowedTransitions('closed', 'admin'), []);
  assert.deepEqual(allowedTransitions('open', 'operator'), []);
});
