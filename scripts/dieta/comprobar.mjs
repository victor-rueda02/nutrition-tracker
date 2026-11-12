// Comprueba data/dieta.json (versión 2) contra las reglas de la dieta con el catálogo ACTUAL de data/foods.csv.
// Úsalo después de cambiar el catálogo (etiquetas, estimaciones, recetas): un cambio de nutrientes puede sacar un día del
// rango sin que ningún test lo note. Explicación en docs/dieta.md.
//   node scripts/dieta/comprobar.mjs        (sale con 1 si algo falla)
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, F } from './catalogo.mjs';
import { VERSIONES, TIPOS, SEMANA, totales, reglas, CLAVES_REGLAS } from './reglas-optimizador.mjs';

const dieta = JSON.parse(readFileSync(resolve(ROOT, 'data/dieta.json'), 'utf8'));
const aLineas = (menu) => Object.fromEntries(Object.entries(menu).map(([m, ls]) => [m, ls.map((l) => [l.food_id, l.gramos])]));
const SEMANAL = { vitamina_a_ug: 750, vitamina_d_ug: 15, vitamina_e_mg: 13, vitamina_k_ug: 70, vitamina_b12_ug: 4, epa_dha: 0.25, selenio_ug: 70 };
let fallos = 0;

// celdas vacías (sin dato) en los alimentos de la dieta: totales() las cuenta como 0, así que se avisan aquí (regla 4)
const usados = new Set((dieta.versiones ?? []).flatMap((v) => [v.dias, ...Object.values(v.tipos ?? {})].flatMap((d) => Object.values(d).flatMap((m) => Object.values(m).flat()))).map((l) => l.food_id));
for (const id of usados) {
  const f = F.get(id);
  if (!f) { console.log(`${id}: no está en data/foods.csv`); fallos++; continue; }
  const vacias = CLAVES_REGLAS.filter((k) => typeof f.nutrients?.[k] !== 'number');
  if (vacias.length) { console.log(`${id}: sin dato de ${vacias.join(', ')} (cuenta como 0: el total sería parcial)`); fallos++; }
}

for (const v of dieta.versiones ?? []) {
  const ver = VERSIONES.find((x) => x.periodo === v.periodo);
  if (!ver) { console.log(`${v.periodo}: sin reglas (añádelo a VERSIONES de reglas-optimizador.mjs)`); fallos++; continue; }
  const pObj = ver.gkg * ver.peso;
  for (const [modo, dias] of [['normal', v.dias], ...Object.entries(v.tipos ?? {})]) {
    const semana = [];
    for (const [dia, menu] of Object.entries(dias)) {
      const tipo = TIPOS[modo === 'normal' ? SEMANA[dia] : modo];
      if (!tipo) continue;
      const t = totales(aLineas(menu));
      semana.push(t);
      const malas = reglas(t, tipo, pObj).filter((r) => !r.ok);
      fallos += malas.length;
      if (malas.length) console.log(`${v.periodo} ${dia} ${modo}: ${malas.map((r) => r.txt).join(' | ')}`);
    }
    // medias semanales (informativas: la vitamina D la cubre el suplemento de Victor)
    const media = (k) => semana.reduce((a, t) => a + (k === 'epa_dha' ? t.epa_g + t.dha_g : t[k]), 0) / semana.length;
    const bajas = Object.entries(SEMANAL).filter(([k, ref]) => media(k) < ref).map(([k, ref]) => `${k} ${media(k).toFixed(1)} (< ${ref})`);
    console.log(`${v.periodo} ${modo}: medias semanales ${bajas.length ? 'por debajo: ' + bajas.join(', ') : 'en referencia'}`);
  }
}
console.log(fallos ? `${fallos} problemas.` : 'La dieta cumple todas las reglas diarias con el catálogo actual.');
process.exitCode = fallos ? 1 : 0;
