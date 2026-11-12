// Comprueba data/dieta.json (versión 2) contra las reglas de la dieta con el catálogo ACTUAL de data/foods.csv.
// Úsalo después de cambiar el catálogo (etiquetas, estimaciones, recetas): un cambio de nutrientes puede sacar un día del
// rango sin que ningún test lo note. Explicación en docs/dieta.md.
//   node scripts/dieta/comprobar.mjs
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from './catalogo.mjs';
import { VERSIONES, TIPOS, SEMANA, totales, reglas } from './reglas-optimizador.mjs';

const dieta = JSON.parse(readFileSync(resolve(ROOT, 'data/dieta.json'), 'utf8'));
const aLineas = (menu) => Object.fromEntries(Object.entries(menu).map(([m, ls]) => [m, ls.map((l) => [l.food_id, l.gramos])]));
let fallos = 0;
for (const v of dieta.versiones ?? []) {
  const ver = VERSIONES.find((x) => x.periodo === v.periodo);
  if (!ver) { console.log(`${v.periodo}: sin reglas (añádelo a VERSIONES de reglas-optimizador.mjs)`); continue; }
  const pObj = ver.gkg * ver.peso;
  for (const [modo, dias] of [['normal', v.dias], ...Object.entries(v.tipos ?? {})]) {
    for (const [dia, menu] of Object.entries(dias)) {
      const tipo = TIPOS[modo === 'normal' ? SEMANA[dia] : modo];
      if (!tipo) continue;
      const t = totales(aLineas(menu));
      const malas = reglas(t, tipo, pObj).filter((r) => !r.ok);
      fallos += malas.length;
      if (malas.length) console.log(`${v.periodo} ${dia} ${modo}: ${malas.map((r) => r.txt).join(' | ')}`);
    }
  }
}
console.log(fallos ? `${fallos} reglas sin cumplir.` : 'La dieta cumple todas las reglas con el catálogo actual.');
process.exitCode = fallos ? 1 : 0;
