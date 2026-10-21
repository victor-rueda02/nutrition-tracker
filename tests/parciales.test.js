// Aviso de totales parciales (core/parciales.js): qué nutrientes, por qué alimentos, agrupación y gravedad.
import test from 'node:test';
import assert from 'node:assert/strict';
import { avisoParciales, listaEs, nombreAlimento } from '../frontend/js/core/parciales.js';
import { diaryReport } from '../frontend/js/core/diary.js';
import { loadTargets, resolveTargets } from '../frontend/js/core/targets.js';
import { catalog, readFile, realFoods } from './helpers.js';

const comida = (...lines) => ({ id: 'm', date: '2026-10-18', meal: 'comida', createdAt: 't', lines: lines.map(([food_id, grams]) => ({ food_id, grams })) });
const food = (id, nombre, nutrients = { energia_kcal: 100 }, extra = {}) => ({ id, nombre, nutrients, extra });
const mapa = (...fs) => new Map(fs.map((f) => [f.id, f]));
const fila = (clave, label, missing) => ({ clave, label, missing, parcial: missing.length > 0 });

const chia = food('chia', 'Chía');
const pasta = food('pasta', 'Pasta');
const arroz = food('arroz', 'Arroz');

test('listaEs: «A», «A y B», «A, B y C»', () => {
  assert.equal(listaEs([]), '');
  assert.equal(listaEs(['A']), 'A');
  assert.equal(listaEs(['A', 'B']), 'A y B');
  assert.equal(listaEs(['A', 'B', 'C']), 'A, B y C');
});

test('agrupa los nutrientes que comparten los mismos alimentos sin dato: «Vitamina K y colina: faltan datos de …»', () => {
  const rows = [fila('vitamina_k_ug', 'Vitamina K', ['chia', 'pasta']), fila('colina_mg', 'Colina', ['pasta', 'chia']), fila('hierro_mg', 'Hierro', ['chia'])];
  const a = avisoParciales([comida(['chia', 20], ['pasta', 200], ['arroz', 100])], mapa(chia, pasta, arroz), rows);
  assert.equal(a.importante, null);
  assert.deepEqual(a.menor.grupos.map((g) => g.texto), [
    'Vitamina K y colina: faltan datos de Pasta y Chía', // más gramos primero
    'Hierro: faltan datos de Chía',
  ]);
  assert.equal(a.menor.grupos[0].nutrientes.length, 2);
  assert.equal(a.menor.nivel, 'menor');
});

test('gravedad: kcal, proteína, hidratos y grasa son importantes; fibra, azúcares, saturadas y micros, menores', () => {
  const rows = [
    fila('energia_kcal', 'Energía', ['chia']), fila('proteina_g', 'Proteína', ['chia']),
    fila('fibra_g', 'Fibra', ['pasta']), fila('grasas_saturadas_g', 'Grasas saturadas', ['pasta']), fila('vitamina_k_ug', 'Vitamina K', ['chia']),
  ];
  const a = avisoParciales([comida(['chia', 20], ['pasta', 100])], mapa(chia, pasta), rows);
  assert.deepEqual(a.importante.grupos.map((g) => g.texto), ['Energía y proteína: faltan datos de Chía']);
  assert.equal(a.importante.nivel, 'importante');
  assert.match(a.importante.resumen, /^Importante: totales parciales en kcal y proteína \(faltan datos de Chía\)$/);
  assert.equal(a.importante.completo, true);
  // menor: dos grupos (pasta -> fibra y saturadas; chía -> vitamina K); el de más nutrientes primero
  assert.deepEqual(a.menor.grupos.map((g) => g.nutrientes.map((n) => n.clave)), [['fibra_g', 'grasas_saturadas_g'], ['vitamina_k_ug']]);
  assert.match(a.menor.grupos[0].texto, /^Fibra y grasas saturadas: faltan datos de Pasta$/);
  assert.equal(a.menor.completo, false);
});

test('una kcal y un micro con los mismos alimentos no se mezclan: cada gravedad tiene sus grupos', () => {
  const rows = [fila('energia_kcal', 'Energía', ['chia']), fila('colina_mg', 'Colina', ['chia'])];
  const a = avisoParciales([comida(['chia', 20])], mapa(chia), rows);
  assert.equal(a.importante.grupos.length, 1);
  assert.equal(a.menor.grupos.length, 1);
  assert.deepEqual(a.menor.grupos[0].nutrientes.map((n) => n.clave), ['colina_mg']);
});

test('resumen: hasta 2 nutrientes por nombre, más como «N nutrientes»; alimentos «A, B, C y N más»', () => {
  const muchos = ['a', 'b', 'c', 'd', 'e'].map((i) => food(i, i.toUpperCase()));
  const ids = muchos.map((f) => f.id);
  const comidas = [comida(...ids.map((id, i) => [id, 100 - i]))];
  const dos = avisoParciales(comidas, mapa(...muchos), [fila('vitamina_k_ug', 'Vitamina K', ids), fila('colina_mg', 'Colina', ids)]);
  assert.equal(dos.menor.resumen, 'Totales parciales en vitamina K y colina (faltan datos de A, B, C y 2 más)');
  assert.equal(dos.menor.completo, false); // el resumen recorta los alimentos
  const tres = avisoParciales(comidas, mapa(...muchos), [fila('vitamina_k_ug', 'Vitamina K', ['a']), fila('colina_mg', 'Colina', ['a']), fila('zinc_mg', 'Zinc', ['a'])]);
  assert.equal(tres.menor.resumen, 'Totales parciales en 3 nutrientes (faltan datos de A)');
  assert.equal(tres.menor.completo, false);
  const uno = avisoParciales(comidas, mapa(...muchos), [fila('vitamina_k_ug', 'Vitamina K', ['a'])]);
  assert.equal(uno.menor.resumen, 'Totales parciales en vitamina K (faltan datos de A)');
  assert.equal(uno.menor.completo, true);
});

test('etiquetas con siglas o números no se pasan a minúscula: «vitamina B12», «EPA + DHA»', () => {
  const a = avisoParciales([comida(['chia', 20])], mapa(chia), [fila('colina_mg', 'Colina', ['chia']), fila('epa_dha', 'EPA + DHA', ['chia']), fila('vitamina_b12_ug', 'Vitamina B12', ['chia'])]);
  assert.equal(a.menor.grupos[0].texto, 'Colina, EPA + DHA y vitamina B12: faltan datos de Chía');
});

test('un alimento con 0 g ese día no cuenta; si era el único, no hay aviso', () => {
  const rows = [fila('vitamina_k_ug', 'Vitamina K', ['chia', 'pasta'])];
  const a = avisoParciales([comida(['chia', 0], ['pasta', 50])], mapa(chia, pasta), rows);
  assert.deepEqual(a.menor.grupos[0].alimentos.map((x) => x.id), ['pasta']);
  assert.equal(avisoParciales([comida(['chia', 0])], mapa(chia), rows), null);
  assert.equal(avisoParciales([], mapa(chia), rows), null);
});

test('los gramos de un mismo alimento en varias comidas se suman (orden por gramos)', () => {
  const rows = [fila('vitamina_k_ug', 'Vitamina K', ['chia', 'pasta'])];
  const a = avisoParciales([comida(['chia', 30], ['pasta', 40]), comida(['chia', 30])], mapa(chia, pasta), rows);
  assert.deepEqual(a.menor.grupos[0].alimentos.map((x) => x.id), ['chia', 'pasta']);
});

test('un alimento sin ningún dato no entra (ya se avisa como «Sin datos nutricionales»); sin él, sin aviso', () => {
  const vacio = food('vacio', 'Sin datos', {});
  const rows = [fila('energia_kcal', 'Energía', ['vacio', 'chia']), fila('colina_mg', 'Colina', ['vacio'])];
  const a = avisoParciales([comida(['vacio', 100], ['chia', 20])], mapa(vacio, chia), rows);
  assert.deepEqual(a.importante.grupos[0].alimentos.map((x) => x.id), ['chia']);
  assert.equal(a.menor, null);
  assert.equal(avisoParciales([comida(['vacio', 100])], mapa(vacio), rows), null);
  assert.equal(avisoParciales([comida(['borrado', 100])], mapa(), rows), null); // borrado del documento: tampoco tiene datos
});

test('el nombre del documento (nombre_corto es solo de «¿Qué ceno?»); sin alimento, el id', () => {
  const largo = food('chia', 'Semillas de chía', { energia_kcal: 1 }, { nombre_corto: 'chía' });
  assert.equal(nombreAlimento(largo, 'chia'), 'Semillas de chía');
  assert.equal(nombreAlimento(food('x', 'Pasta'), 'x'), 'Pasta');
  assert.equal(nombreAlimento(undefined, 'id_raro'), 'id_raro');
  const a = avisoParciales([comida(['chia', 20])], mapa(largo), [fila('colina_mg', 'Colina', ['chia'])]);
  assert.equal(a.menor.resumen, 'Totales parciales en colina (faltan datos de Semillas de chía)');
});

test('sin parciales no hay aviso', () => {
  assert.equal(avisoParciales([comida(['chia', 20])], mapa(chia), [fila('colina_mg', 'Colina', [])]), null);
});

test('con el documento real: chía y pasta dan «Vitamina K y colina» (menor); un alimento con kcal sin dato sería importante', () => {
  const { targets } = loadTargets(JSON.parse(readFile('../data/targets.json')), catalog);
  const byId = new Map(realFoods.map((f) => [f.id, f]));
  const sinKcal = { ...byId.get('pasta_seca'), id: 'pasta_sin_kcal', nombre: 'Pasta sin kcal', nutrients: { ...byId.get('pasta_seca').nutrients, energia_kcal: null } };
  byId.set(sinKcal.id, sinKcal);
  const meals = [comida(['semillas_chia', 15], ['pasta_seca', 80])];
  const rep = diaryReport(meals, byId, resolveTargets(targets), catalog);
  const a = avisoParciales(meals, byId, rep.rows);
  assert.equal(a.importante, null);
  const texto = a.menor.grupos.map((g) => g.texto).join(' | ');
  assert.match(texto, /vitamina K.*: faltan datos de Semillas de chía/); // la chía no trae vitamina K...
  assert.match(texto, /Colina: faltan datos de Pasta seca sin enriquecer/); // ...ni la pasta colina
  const rep2 = diaryReport([comida(['pasta_sin_kcal', 80])], byId, resolveTargets(targets), catalog);
  const b = avisoParciales([comida(['pasta_sin_kcal', 80])], byId, rep2.rows);
  assert.match(b.importante.resumen, /^Importante: totales parciales en kcal \(faltan datos de Pasta sin kcal\)$/);
});
