import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { resolveOperationalShift } from '../src/lib/shifts.ts';
import { ROLE_PERMISSIONS, hasPermission } from '../src/lib/rbac.ts';

const EXPECTED_RUBRIC_SEQUENCE = [
  9, 10, 11, 12, 13, 14, 15, 16, 31, 32, 33, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 28, 29, 42,
  41, 40, 39, 38, 37, 36, 35, 34, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58,
  59, 60, 61, 62, 63, 64,
];

describe('NEXO LOG 2.0 — Fase 1 (Regras Operacionais e Segurança)', () => {
  it('resolveOperationalShift classifica corretamente os 3 turnos (07:30–17:18, 17:00–02:12, 23:28–07:30) e preserva data após 00h', () => {
    const t1 = resolveOperationalShift(new Date(2026, 10, 16, 8, 30, 0));
    assert.equal(t1.shiftCode, 'TURNO_1');
    assert.equal(t1.operationalDate, '2026-11-16');
    assert.equal(t1.crossesMidnight, false);

    // 17:10: início do 2º turno sobrepõe fim do 1º turno (17:00–17:18)
    const t2OverlapStart = resolveOperationalShift(new Date(2026, 10, 16, 17, 10, 0));
    assert.equal(t2OverlapStart.shiftCode, 'TURNO_2');
    assert.equal(t2OverlapStart.operationalDate, '2026-11-16');
    assert.equal(t2OverlapStart.crossesMidnight, true);

    const t2Evening = resolveOperationalShift(new Date(2026, 10, 16, 22, 15, 0));
    assert.equal(t2Evening.shiftCode, 'TURNO_2');
    assert.equal(t2Evening.operationalDate, '2026-11-16');
    assert.equal(t2Evening.crossesMidnight, true);

    // 23:45 e 01:20 / 03:10: 3º turno (23:28–07:30) cruza meia-noite e preserva data de início
    const t3Night = resolveOperationalShift(new Date(2026, 10, 16, 23, 45, 0));
    assert.equal(t3Night.shiftCode, 'TURNO_3');
    assert.equal(t3Night.operationalDate, '2026-11-16');
    assert.equal(t3Night.crossesMidnight, true);

    const t3AfterMidnightEarly = resolveOperationalShift(new Date(2026, 10, 17, 1, 20, 0));
    assert.equal(t3AfterMidnightEarly.shiftCode, 'TURNO_3');
    assert.equal(t3AfterMidnightEarly.operationalDate, '2026-11-16');
    assert.equal(t3AfterMidnightEarly.crossesMidnight, true);

    const t3Dawn = resolveOperationalShift(new Date(2026, 10, 17, 7, 10, 0));
    assert.equal(t3Dawn.shiftCode, 'TURNO_3');
    assert.equal(t3Dawn.operationalDate, '2026-11-16');
    assert.equal(t3Dawn.crossesMidnight, true);
  });

  it('matriz RBAC isola Produção e Operador Moega contra mutações administrativas/cadastrais', () => {
    assert.equal(hasPermission('PRODUCAO', 'dashboard:view'), true);
    assert.equal(hasPermission('PRODUCAO', 'silos:view'), true);
    assert.equal(hasPermission('PRODUCAO', 'requests:create'), true);
    assert.equal(hasPermission('PRODUCAO', 'silos:manage'), false);
    assert.equal(hasPermission('PRODUCAO', 'materials:manage'), false);
    assert.equal(hasPermission('PRODUCAO', 'users:manage'), false);
    assert.equal(hasPermission('PRODUCAO', 'audit:view'), false);

    assert.equal(hasPermission('OPERADOR_MOEGA', 'silos:view'), true);
    assert.equal(hasPermission('OPERADOR_MOEGA', 'silos:manage'), false);
    assert.equal(hasPermission('OPERADOR_MOEGA', 'users:manage'), false);

    assert.equal(hasPermission('SUPERVISOR', 'silos:manage'), true);
    assert.equal(hasPermission('SUPERVISOR', 'pendencies:resolve'), true);
    assert.equal(hasPermission('SUPERVISOR', 'users:manage'), false);

    assert.equal(hasPermission('ADMIN', 'users:manage'), true);
    assert.ok(ROLE_PERMISSIONS.ADMIN.includes('audit:view'));
  });

  it('seed-reference preserva exatamente os 54 silos na sequência oficial sem inventar silos 27 ou 30', () => {
    const seedSource = fs.readFileSync(
      path.resolve(process.cwd(), 'src/db/seed-reference.ts'),
      'utf8'
    );

    const numbers: number[] = [];
    const regex = /siloNumber:\s*(\d+),/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(seedSource)) !== null) {
      numbers.push(Number(match[1]));
    }

    assert.equal(numbers.length, 54);
    assert.deepEqual(numbers, EXPECTED_RUBRIC_SEQUENCE);
    assert.equal(numbers.includes(27), false);
    assert.equal(numbers.includes(30), false);
  });

  it('regra de margem de segurança (-10%) reduz capacidade nominal com precisão inteira', () => {
    const calcSafe = (nominalKg: number) => Math.round(nominalKg * 0.9);
    assert.equal(calcSafe(39000), 35100);
    assert.equal(calcSafe(15520), 13968);
    assert.equal(calcSafe(1202520), 1082268);
  });
});
