// Reglas de la dieta fija de Victor y optimizador por versión (periodo del plan) y tipo de día (docs/dieta.md).
// Nutrientes = valor por 100 g de data/foods.csv × gramos / 100 (catalogo.mjs). Reglas: kcal ±5 % (se busca ±1 %),
// proteína ≥ objetivo y ≤ 110 %, grasa 25-30 %, hidratos 90-110 % del objetivo, fibra ≥ 35, saturadas ≤ 10 %,
// sodio ≤ 2000, B1/B3/ALA por energía, mínimos EFSA (MIN) y UL. Las medias semanales (A, D, E, K, B12, EPA+DHA, Se) se
// miran aparte; la vitamina D no llega (≈ 9 µg/día) y la cubre el suplemento de Victor (noviembre a marzo).
// VERSIONES y TIPOS copian el plan de objetivos del iPhone: si Victor lo cambia, cámbialos aquí.
import { F, KEYS } from './catalogo.mjs';

export const VERSIONES = [
  { periodo: 'volumen_p20_rutina_nov', nombre: 'p20 · rutina de noviembre (proteína 2,0 g/kg)', peso: 73.9, gkg: 2.0 },
  { periodo: 'volumen_p19', nombre: 'p19 · proteína 1,9 g/kg', peso: 74, gkg: 1.9 },
  { periodo: 'volumen_p18', nombre: 'p18 · proteína 1,8 g/kg', peso: 74.5, gkg: 1.8 },
  { periodo: 'volumen_p17', nombre: 'p17 · proteína 1,7 g/kg', peso: 74.8, gkg: 1.7 },
  { periodo: 'volumen_p16', nombre: 'p16 · proteína 1,6 g/kg', peso: 75.2, gkg: 1.6 },
];
export const TIPOS = { fuerza: { kcal: 3700, hc: 57 }, carrera: { kcal: 3600, hc: 56 }, descanso: { kcal: 3300, hc: 55 } };
export const SEMANA = { lunes: 'fuerza', martes: 'fuerza', miercoles: 'carrera', jueves: 'fuerza', viernes: 'fuerza' };
const MIN = {
  vitamina_c_mg: 110, vitamina_b2_mg: 1.6, vitamina_b5_mg: 5, vitamina_b6_mg: 1.7, vitamina_b9_ug: 330,
  colina_mg: 400, calcio_mg: 950, hierro_mg: 11, magnesio_mg: 350, fosforo_mg: 550, potasio_mg: 3500, zinc_mg: 11.7,
  cobre_mg: 1.6, manganeso_mg: 3,
};
const UL = { vitamina_d_ug: 100, vitamina_e_mg: 300, vitamina_b6_mg: 12, calcio_mg: 2500, zinc_mg: 25, cobre_mg: 5, selenio_ug: 255, vitamina_a_ug: 3000 };
// Nutrientes que miran las reglas (diarias y semanales): comprobar.mjs avisa si a un alimento de la dieta le falta alguno.
export const CLAVES_REGLAS = [...new Set(['energia_kcal', 'proteina_g', 'grasa_total_g', 'hidratos_g', 'fibra_g', 'grasas_saturadas_g', 'sodio_mg',
  'vitamina_b1_mg', 'vitamina_b3_mg', 'ala_g', 'epa_g', 'dha_g', 'vitamina_a_ug', 'vitamina_d_ug', 'vitamina_e_mg', 'vitamina_k_ug', 'vitamina_b12_ug', 'selenio_ug',
  ...Object.keys(MIN), ...Object.keys(UL)])];

const VEC = new Map();
for (const [id, f] of F) VEC.set(id, KEYS.map((k) => (typeof f.nutrients?.[k] === 'number' ? f.nutrients[k] : 0)));
const KI = Object.fromEntries(KEYS.map((k, i) => [k, i]));

// Un día: comidas = { desayuno: [[id, g, knob?]], ... }. knob = { min, max, step, w } (w: coste por gramo de moverse).
export function totales(dia) {
  const t = new Array(KEYS.length).fill(0);
  for (const ls of Object.values(dia)) for (const [id, g] of ls) { const v = VEC.get(id); if (!v) throw new Error('No existe ' + id); for (let i = 0; i < v.length; i++) t[i] += v[i] * g / 100; }
  return Object.fromEntries(KEYS.map((k) => [k, t[KI[k]]]));
}

export function reglas(t, tipo, pObj) {
  const K = tipo.kcal, MJ = K * 0.004184;
  const r = [];
  const add = (clave, ok, txt) => r.push({ clave, ok, txt });
  add('kcal', Math.abs(t.energia_kcal / K - 1) <= 0.05, `kcal ${t.energia_kcal.toFixed(0)} (obj ${K})`);
  add('proteina', t.proteina_g >= pObj && t.proteina_g <= pObj * 1.1, `prot ${t.proteina_g.toFixed(1)} (obj ${pObj.toFixed(1)}-${(pObj * 1.1).toFixed(1)})`);
  const gp = t.grasa_total_g * 9 / K * 100;
  add('grasa', gp >= 25 && gp <= 30, `grasa ${gp.toFixed(1)} % (25-30, sobre obj kcal)`);
  const hObj = K * tipo.hc / 400;
  add('hidratos', t.hidratos_g >= hObj * 0.9 && t.hidratos_g <= hObj * 1.1, `HC ${t.hidratos_g.toFixed(0)} (obj ${hObj.toFixed(0)})`);
  add('fibra', t.fibra_g >= 35, `fibra ${t.fibra_g.toFixed(0)}`);
  add('saturadas', t.grasas_saturadas_g <= K * 0.1 / 9, `sat ${(t.grasas_saturadas_g * 9 / K * 100).toFixed(1)} %`);
  add('sodio', t.sodio_mg <= 2000, `Na ${t.sodio_mg.toFixed(0)}`);
  add('b1', t.vitamina_b1_mg >= 0.1 * MJ, 'B1');
  add('b3', t.vitamina_b3_mg >= 1.6 * MJ, 'B3');
  add('ala', t.ala_g >= K * 0.005 / 9, 'ALA');
  for (const [c, m] of Object.entries(MIN)) add(c, t[c] >= m && (!UL[c] || t[c] <= UL[c]), `${c} ${t[c].toFixed(1)} (≥ ${m})`);
  for (const [c, u] of Object.entries(UL)) if (!MIN[c]) add(c, t[c] <= u, `${c} ≤ UL`);
  return r;
}

function coste(dia, base, tipo, pObj) {
  const t = totales(dia);
  const K = tipo.kcal;
  let c = 0;
  const kd = (t.energia_kcal / K - 1) * 100; c += kd * kd * 6; // ±1 % ≈ 6
  const p = t.proteina_g;
  const pT = pObj * 1.04;
  if (p < pObj) c += 400 + (pObj - p) ** 2 * 40; else if (p > pObj * TOPE) c += 400 + (p - pObj * TOPE) ** 2 * 40; else c += ((p - pT) / pObj * 100) ** 2 * 0.3;
  const gp = t.grasa_total_g * 900 / K;
  if (gp < 25) c += 400 + (25 - gp) ** 2 * 60; else if (gp > 30) c += 400 + (gp - 30) ** 2 * 60; else c += (gp - 26.5) ** 2 * 0.5;
  const hObj = K * tipo.hc / 400, hr = t.hidratos_g / hObj;
  if (hr < 0.9 || hr > 1.1) c += 400 + ((hr - 1) * 100) ** 2 * 10;
  if (t.fibra_g < 35) c += 400 + (35 - t.fibra_g) ** 2 * 20;
  if (t.grasas_saturadas_g > K * 0.1 / 9) c += 1000;
  if (t.sodio_mg > 2000) c += 400 + (t.sodio_mg - 2000) * 2;
  if (t.azucares_g > 140) c += (t.azucares_g - 140) * 0.6; // preferir almidón (patata, arroz) a más fruta dulce
  for (const [k, m] of Object.entries(MIN)) if (t[k] < m) c += 400 + ((m - t[k]) / m * 100) ** 2 * 5;
  for (const [k, u] of Object.entries(UL)) if (t[k] > u) c += 1000;
  // moverse de la base cuesta (para no cambiar más de lo necesario)
  for (const [m, ls] of Object.entries(dia)) ls.forEach(([, g, kn], i) => { if (kn) c += Math.abs(g - base[m][i][1]) * (kn.w ?? 0.02); });
  return c;
}

export let TOPE = 1.1; // proteína máxima = objetivo × TOPE (regla de la dieta: 110 %)
export const setTope = (x) => { TOPE = x; };
export function optimizar(diaBase, tipo, pObj, iter = 400) {
  const dia = JSON.parse(JSON.stringify(diaBase));
  const knobs = [];
  for (const [m, ls] of Object.entries(dia)) ls.forEach((l, i) => { if (l[2]) knobs.push([m, i]); });
  let best = coste(dia, diaBase, tipo, pObj);
  for (let it = 0; it < iter; it++) {
    let mejoro = false;
    for (const [m, i] of knobs) {
      const kn = dia[m][i][2];
      for (const mult of [1, 2, 4]) for (const s of [-1, 1]) {
        const g0 = dia[m][i][1];
        let g = g0 + s * kn.step * mult;
        if (kn.cero && g0 === 0 && s > 0) g = kn.min; else if (kn.cero && g < kn.min && s < 0) g = 0; else g = Math.min(kn.max, Math.max(kn.min, g));
        g = Math.round(g * 1000) / 1000;
        if (g === g0) continue;
        dia[m][i][1] = g;
        const c = coste(dia, diaBase, tipo, pObj);
        if (c < best - 1e-9) { best = c; mejoro = true; } else dia[m][i][1] = g0;
      }
    }
    // pares: subir uno y bajar otro (salir de mínimos locales)
    if (!mejoro) {
      for (const [m1, i1] of knobs) for (const [m2, i2] of knobs) {
        if (m1 === m2 && i1 === i2) continue;
        const a = dia[m1][i1], b = dia[m2][i2];
        const a0 = a[1], b0 = b[1];
        const na = a[2].cero && a0 === 0 ? a[2].min : Math.min(a[2].max, a0 + a[2].step);
        const nb = b[2].cero && b0 - b[2].step < b[2].min ? 0 : Math.max(b[2].min, b0 - b[2].step);
        if (na === a0 || nb === b0) continue;
        a[1] = na; b[1] = nb;
        const c = coste(dia, diaBase, tipo, pObj);
        if (c < best - 1e-9) { best = c; mejoro = true; } else { a[1] = a0; b[1] = b0; }
      }
    }
    if (!mejoro) break;
  }
  return { dia, coste: best };
}
