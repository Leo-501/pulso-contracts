import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  transicoesPermitidas,
  esquemaData,
  dataLocal,
  dataOcorrencia,
} from '../src/index.js';

test('mensal no dia 31 usa último dia e preserva a âncora em março', () => {
  assert.equal(dataOcorrencia('2026-01-31', 'mensal', 1, 1), '2026-02-28');
  assert.equal(dataOcorrencia('2026-01-31', 'mensal', 1, 2), '2026-03-31');
  assert.equal(dataOcorrencia('2024-01-31', 'mensal', 1, 1), '2024-02-29');
});
test('recorrência semanal cruza ano sem deslocamento por horário de verão', () => {
  assert.equal(dataOcorrencia('2026-12-28', 'semanal', 2, 1), '2027-01-11');
});
test('datas impossíveis são rejeitadas e o calendário usa o fuso da unidade', () => {
  assert.equal(esquemaData.safeParse('2026-02-31').success, false);
  assert.equal(esquemaData.safeParse('2024-02-29').success, true);
  assert.equal(dataLocal(new Date('2026-09-13T01:30:00Z')), '2026-09-12');
});
test('técnico conclui execução, gestor valida e OS encerrada permanece imutável', () => {
  assert.ok(transicoesPermitidas('em_execucao', 'tecnico').includes('validacao'));
  assert.deepEqual(transicoesPermitidas('validacao', 'tecnico'), []);
  assert.ok(transicoesPermitidas('validacao', 'gestor').includes('concluida'));
  assert.deepEqual(transicoesPermitidas('concluida', 'administrador'), []);
  assert.deepEqual(transicoesPermitidas('aberta', 'solicitante'), []);
});
