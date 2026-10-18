// Validación en código de la respuesta de la IA + elección determinista de variante crudo/cocinado.
// La IA propone; aquí se descarta lo inválido y se aplican las reglas de variantes.
import { MAX_GRAMS, UMBRAL_GRAMOS_SIN_UNIDAD, detectEstado, detectVolumen, detectPeso, cantidadDicha } from './ai-contract.js';
import { normalizeText, containsTerm, removeTerms } from './text.js';

const CONF = ['alta', 'media', 'baja'];
const lower = (c) => CONF[Math.min(CONF.indexOf(c) + 1, CONF.length - 1)];

// Acepta el JSON del modelo, con o sin vallas ```json.
export function parseModelJson(raw) {
  try {
    const text = String(raw ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    return { ok: true, data: JSON.parse(text) };
  } catch (e) {
    return { ok: false, error: `JSON no válido: ${e.message}` };
  }
}

export function checkStructure(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, error: 'la respuesta no es un objeto' };
  if (!Array.isArray(data.items)) return { ok: false, error: 'falta "items" (lista)' };
  if (!Array.isArray(data.unmatched)) return { ok: false, error: 'falta "unmatched" (lista)' };
  return { ok: true };
}

export function buildVariantIndex(compactList) {
  const byId = new Map(compactList.map((f) => [f.id, f]));
  const groups = new Map();
  for (const f of compactList) if (f.grupo) (groups.get(f.grupo) ?? groups.set(f.grupo, []).get(f.grupo)).push(f);
  return { byId, groups };
}

const satisfies = (food, said) => (said === 'crudo' ? !['cocinado', 'tostado'].includes(food.estado) : food.estado === said);

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Nombre/alias como expresión que tolera el plural ("tomate frito" casa con "tomates fritos").
const termRegex = (term) => new RegExp(`\\b${term.split(' ').map((w) => `${escapeRe(w)}(?:e?s)?`).join('\\s+')}\\b`, 'g');

// Una palabra de estado dentro del nombre o de un alias del alimento ("tomate frito") forma parte del nombre,
// no es un estado dicho. Excepción: si coincide con el estado del propio alimento ("pistachos crudos"), sí cuenta.
// Devuelve el texto sin esos términos y los estados que aparecían en ellos.
export function stripNameStates(text, food) {
  let t = normalizeText(text);
  const states = new Set();
  for (const term of [food.nombre, ...(food.alias ?? [])].map(normalizeText)) {
    const s = term && detectEstado(term);
    if (!s || satisfies(food, s)) continue;
    states.add(s);
    t = t.replace(termRegex(term), ' ');
  }
  return { text: t, states };
}

const nameTerms = (f) => [f.nombre, ...(f.alias ?? [])];

// ¿El texto dicho contiene el nombre o algún alias de alguno de estos alimentos? Sin acentos, sin mayúsculas
// y tolerando plurales por palabra ("tomates fritos" ~ "tomate frito", "macarrones" ~ "macarrón").
export const mentionsFood = (text, foods) => foods.some((f) => nameTerms(f).some((term) => containsTerm(text, term)));

// Cantidad dicha sin unidad: ¿los gramos salen de una porción del alimento? Si se dijo el número ("2 huevos",
// "medio vaso"), gramos = número × porción; si se nombra una porción ("una cucharadita"), tiene que ser esa. Sin número
// ("vaso de leche"), vale un múltiplo de ¼ o ⅓ de porción. Tolerancia del 1 % por redondeos.
export function porcionCuadra(grams, n, text, foods) {
  const porciones = foods.flatMap((f) => f.porciones ?? []).filter((p) => p.gramos > 0);
  const nombradas = porciones.filter((p) => containsTerm(text, p.nombre));
  const candidatas = nombradas.length ? nombradas : porciones;
  const cerca = (a, b) => Math.abs(a - b) <= 0.01 * Math.max(a, 1);
  if (n !== null) return candidatas.some((p) => cerca(grams, n * p.gramos));
  return candidatas.some((p) => {
    const r = grams / p.gramos;
    return r >= 0.25 - 1e-9 && (cerca(r, Math.round(r * 4) / 4) || cerca(r, Math.round(r * 3) / 3));
  });
}

// Reglas de variante (ver conversación del hito 2):
//  - Una sola variante y no dice estado: se respeta todo, sin bajar la confianza.
//  - Varias variantes y no dice estado: la marcada "defecto" (crudo) y confianza -1 nivel.
//  - Dice estado (cocido, asado...): la variante de ese estado; si no existe, la de defecto con confianza "baja".
//  - Las palabras de estado que son parte del nombre o alias del alimento elegido no cuentan (stripNameStates).
//  - Alimento con peso_en_crudo: las palabras de cocinado se ignoran (se pesa en crudo).
export function resolveVariant(item, index) {
  const flags = [];
  const modelFood = index.byId.get(item.food_id);
  const members = modelFood.grupo ? index.groups.get(modelFood.grupo) : [modelFood];
  const multiple = members.length > 1;
  const stripped = stripNameStates(item.source_text, modelFood);
  let said = detectEstado(stripped.text);
  let modelSaid = ['crudo', 'cocinado', 'tostado'].includes(item.estado_dicho) ? item.estado_dicho : null;
  if (!said && stripped.states.has(modelSaid)) modelSaid = null; // el modelo tomó el estado del propio nombre
  // peso_en_crudo: "a la plancha" dice cómo lo cociné, no cómo lo pesé. Se queda en esta fila, sin bajar la confianza.
  // Si la IA eligió otra variante del grupo (la cocinada) y la cruda está marcada, se usa la marcada.
  const marcado = modelFood.peso_en_crudo ? modelFood : members.find((m) => m.peso_en_crudo);
  if (marcado && (said === 'cocinado' || (!said && modelSaid === 'cocinado'))) {
    return { food_id: marcado.id, confidence: item.confidence, flags: [] };
  }
  let confidence = item.confidence;

  if (!said && modelSaid) { flags.push('estado_discrepante'); confidence = 'baja'; } // el modelo vio un estado que no consta en su fragmento
  else if (said && modelSaid && said !== modelSaid) flags.push('estado_discrepante');

  let chosen = modelFood;
  if (!multiple) {
    if (said && !satisfies(modelFood, said)) { flags.push('variante_no_disponible'); confidence = 'baja'; }
  } else if (said) {
    const matches = members.filter((m) => satisfies(m, said) && (said !== 'crudo' || m.estado === 'crudo'));
    const pick = matches.find((m) => m.defecto) ?? matches[0];
    if (pick) chosen = pick;
    else {
      flags.push('variante_no_disponible');
      confidence = 'baja';
      chosen = members.find((m) => m.defecto) ?? modelFood;
    }
  } else {
    const def = members.find((m) => m.defecto);
    if (def) { chosen = def; flags.push('variante_por_defecto'); }
    else flags.push('sin_variante_por_defecto');
    confidence = lower(confidence); // varias variantes y no dijo el estado
  }
  if (chosen.id !== item.food_id) flags.push('variante_cambiada');
  return { food_id: chosen.id, confidence, flags };
}

// Valida y normaliza la salida del modelo. Devuelve { items, unmatched, warnings }.
export function normalizeAiResponse(data, compactList, { maxGrams = MAX_GRAMS } = {}) {
  const index = buildVariantIndex(compactList);
  const items = [];
  const unmatched = [];
  const warnings = [];

  for (const u of data.unmatched ?? []) {
    if (!u || typeof u.text !== 'string' || !u.text.trim()) continue;
    const out = { text: u.text.trim(), motivo: ['no_en_catalogo', 'sin_porcion', 'ambiguo'].includes(u.motivo) ? u.motivo : 'no_en_catalogo' };
    if (typeof u.food_id === 'string' && index.byId.has(u.food_id)) out.food_id = u.food_id;
    unmatched.push(out);
  }

  for (const raw of data.items ?? []) {
    const text = typeof raw?.source_text === 'string' ? raw.source_text.trim() : '';
    if (!raw || typeof raw.food_id !== 'string' || !index.byId.has(raw.food_id)) {
      unmatched.push({ text: text || String(raw?.food_id ?? '?'), motivo: 'no_en_catalogo' });
      warnings.push(`food_id inexistente descartado: ${JSON.stringify(raw?.food_id)}`);
      continue;
    }
    const qty = raw.cantidad;
    const unidad = raw.unidad === 'ml' ? 'ml' : 'g';
    if (typeof qty !== 'number' || !Number.isFinite(qty) || qty <= 0) {
      unmatched.push({ text: text || raw.food_id, motivo: 'sin_porcion', food_id: raw.food_id });
      warnings.push(`cantidad no válida (${JSON.stringify(qty)}) para ${raw.food_id}: pasa a no reconocido`);
      continue;
    }
    const base = { food_id: raw.food_id, source_text: text, confidence: CONF.includes(raw.confidence) ? raw.confidence : 'baja', estado_dicho: raw.estado_dicho };
    const v = resolveVariant(base, index);
    const flags = [...v.flags];
    let confidence = v.confidence;
    const modelFood = index.byId.get(raw.food_id);
    const family = modelFood.grupo ? index.groups.get(modelFood.grupo) : [modelFood];
    const foods = [...family, index.byId.get(v.food_id)];
    // Cantidad sin unidad de peso ni de volumen en lo dicho (el número se lee sin el nombre: "chocolate 85" no es 85):
    //  - menos de UMBRAL_GRAMOS_SIN_UNIDAD ("1 manzana", "2 huevos"): son unidades; solo vale si los gramos salen de una
    //    porción del alimento; si no (o si llega en ml), a "sin porción" para que pongas los gramos.
    //  - desde el umbral ("150 de arroz"): se asume que son gramos, con aviso; no bloquea el guardado.
    let cantidad = qty;
    let unidadFinal = unidad;
    if (!detectPeso(text) && !detectVolumen(text)) {
      const n = cantidadDicha(removeTerms(text, foods.flatMap(nameTerms)));
      if (n !== null && n >= UMBRAL_GRAMOS_SIN_UNIDAD) {
        cantidad = n;
        unidadFinal = 'g';
        flags.push('gramos_asumidos');
        warnings.push(`${v.food_id}: "${text}" no dice la unidad: se asumen ${n} g`);
      } else if (unidad === 'ml' || !porcionCuadra(qty, n, text, foods)) {
        unmatched.push({ text: text || v.food_id, motivo: 'sin_porcion', food_id: v.food_id });
        warnings.push(`${v.food_id}: "${text}" no dice gramos y no hay una porción que dé ${qty} ${unidad}: pon los gramos`);
        continue;
      }
    }
    // Lo dicho debe nombrar al alimento (o a una variante de su grupo): si no, el modelo eligió por su cuenta
    // ("150 g de pechuga" -> pechuga de pollo). Se marca para confirmar; sirve también para descubrir alias que faltan.
    if (!mentionsFood(text, foods)) {
      flags.push('sin_alias');
      confidence = 'baja';
      warnings.push(`${v.food_id}: "${text}" no coincide con tus alias`);
    }
    // Volumen: aquí no se convierte (la densidad no viaja a internet); lo convierte la app al crear el borrador.
    const amount = unidadFinal === 'ml' ? { grams: null, ml: cantidad } : { grams: cantidad };
    if (cantidad > maxGrams) { flags.push('gramos_altos'); warnings.push(`${v.food_id}: ${cantidad} ${unidadFinal} supera ${maxGrams}, confirma la cantidad`); }
    if (unidad === 'g' && detectVolumen(text)) { flags.push('unidad_discrepante'); warnings.push(`${v.food_id}: dijiste un volumen pero llegó en gramos, revisa la cantidad`); }
    if (v.flags.includes('variante_no_disponible')) warnings.push(`${raw.food_id}: dijiste un estado para el que no hay variante en el documento`);
    if (v.flags.includes('sin_variante_por_defecto')) warnings.push(`${raw.food_id}: grupo sin variante_por_defecto`);
    items.push({
      food_id: v.food_id, ...amount, source_text: text, confidence, flags,
      requiresConfirmation: confidence === 'baja' || flags.some((f) => ['gramos_altos', 'variante_no_disponible', 'estado_discrepante', 'unidad_discrepante', 'sin_alias'].includes(f)),
    });
  }
  return { items, unmatched, warnings };
}
