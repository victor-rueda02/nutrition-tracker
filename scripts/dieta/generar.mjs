// Regenera las versiones de la dieta (p20 a p16, menús normales y de descanso) con el optimizador y las reglas de
// reglas-optimizador.mjs, partiendo de la semana base (semana-base.mjs). Explicación en docs/dieta.md.
//   node scripts/dieta/generar.mjs            -> calcula y enseña cada día (kcal, proteína, grasa, fallos); no escribe nada
//   node scripts/dieta/generar.mjs --escribir -> además escribe data/dieta.json (versión 2; ver data/SCHEMA.md)
// Después: npm test (valida el fichero contra data/foods.csv) y git push.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from './catalogo.mjs';
import { VERSIONES, TIPOS, SEMANA, optimizar, totales, reglas } from './reglas-optimizador.mjs';
import { semanaBase } from './semana-base.mjs';

const menus = {};
let fallos = 0;
for (const v of VERSIONES) {
  const pObj = v.gkg * v.peso;
  menus[v.periodo] = { normal: {}, descanso: {} };
  const base = semanaBase();
  // Decisiones de Victor (11-11-2026): el martes se puede bajar el pollo de la comida (desde 30 g); desde p18, el lunes
  // táper de lentejas caseras de 500 g y sin lata de atún.
  base.martes.comida = base.martes.comida.map((l) => (l[0] === 'pechuga_pollo_cruda' ? [l[0], l[1], { ...l[2], min: 30 }] : l));
  if (['volumen_p18', 'volumen_p17', 'volumen_p16'].includes(v.periodo)) {
    base.lunes.comida = base.lunes.comida.map((l) => (l[0] === 'lentejas_caseras' ? [l[0], 500] : l));
    base.lunes.cena = base.lunes.cena.filter((l) => l[0] !== 'atun_lata_aceite');
  }
  for (const [dia, tipoClave] of Object.entries(SEMANA)) {
    for (const modo of ['normal', 'descanso']) {
      const tipo = TIPOS[modo === 'normal' ? tipoClave : 'descanso'];
      const ini = modo === 'normal' ? base[dia] : menus[v.periodo].normal[dia];
      // p20 normal es la semana que Victor ya sigue (v15), tal cual: no se reoptimiza
      const fija = v.periodo === 'volumen_p20_rutina_nov' && modo === 'normal';
      const { dia: d } = fija ? { dia: JSON.parse(JSON.stringify(ini)) } : optimizar(ini, tipo, pObj);
      menus[v.periodo][modo][dia] = d;
      const t = totales(d);
      const malas = reglas(t, tipo, pObj).filter((r) => !r.ok);
      fallos += malas.length;
      console.log(`${v.periodo.padEnd(24)} ${dia.padEnd(9)} ${modo.padEnd(8)} kcal ${t.energia_kcal.toFixed(0)}/${tipo.kcal} P ${t.proteina_g.toFixed(1)}/${pObj.toFixed(1)} grasa ${(t.grasa_total_g * 900 / tipo.kcal).toFixed(1)} %${malas.length ? '  FALLA: ' + malas.map((r) => r.txt).join(' | ') : ''}`);
    }
  }
}
console.log(fallos ? `\n${fallos} reglas sin cumplir: revísalas antes de escribir.` : '\nTodas las reglas se cumplen.');

if (process.argv.includes('--escribir')) {
  const limpio = (dia) => Object.fromEntries(Object.entries(dia).map(([m, ls]) => [m, ls.filter(([, g]) => g > 0).map(([food_id, g]) => ({ food_id, gramos: Math.round(g * 10) / 10 }))]));
  const dias = (sem) => Object.fromEntries(Object.entries(sem).map(([d, dia]) => [d, limpio(dia)]));
  const versiones = VERSIONES.map((v) => ({ periodo: v.periodo, nombre: v.nombre, dias: dias(menus[v.periodo].normal), tipos: { descanso: dias(menus[v.periodo].descanso) } }));
  const linea = (l) => `{ "food_id": "${l.food_id}", "gramos": ${l.gramos} }`;
  const menu = (d, ind) => `{\n${Object.entries(d).map(([m, ls]) => `${ind}  "${m}": [\n${ls.map((l) => `${ind}    ${linea(l)}`).join(',\n')}\n${ind}  ]`).join(',\n')}\n${ind}}`;
  const semana = (s, ind) => `{\n${Object.entries(s).map(([dia, d]) => `${ind}  "${dia}": ${menu(d, ind + '  ')}`).join(',\n')}\n${ind}}`;
  let txt = `{\n  "version": 2,\n  "nombre": "Volumen 2026-27 (p20 a p16)",\n  "nota": "«dias» de arriba (los menús normales de p20) solo para la app antigua (versión 1); la nueva usa «versiones».",\n  "dias": ${semana(versiones[0].dias, '  ')},\n  "versiones": [\n`;
  txt += versiones.map((v) => `    {\n      "periodo": "${v.periodo}",\n      "nombre": ${JSON.stringify(v.nombre)},\n      "dias": ${semana(v.dias, '      ')},\n      "tipos": {\n        "descanso": ${semana(v.tipos.descanso, '        ')}\n      }\n    }`).join(',\n');
  txt += '\n  ]\n}\n';
  JSON.parse(txt);
  writeFileSync(resolve(ROOT, 'data/dieta.json'), txt);
  console.log('Escrito data/dieta.json');
}
