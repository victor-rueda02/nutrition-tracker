// Interfaz: pantallas Inicio (dictado) -> Confirmación (editable) -> Guardar, más Diario (totales del día frente a los
// objetivos), Objetivos y Documento (importar + conexión).
// Sin frameworks: DOM con textContent (nunca innerHTML con datos). Toda la lógica de negocio está en js/core.
import { buildCompactList } from '../core/ai-contract.js';
import { annotateExcluded, isExcluded } from '../core/excluded.js';
import { createDraft, setGrams, changeFood, confirmFood, removeLine, addLine, resolveUnmatched, dropUnmatched, confirmHigh, setMeal, setDate, validateDraft, lineProblem, previewTotals, toMealRecord, draftFromRecord } from '../core/draft.js';
import { MEALS, defaultMeal, madridNow } from '../core/meal-defaults.js';
import { parseFoodsDocument, formatIssue, foodsToCSV } from '../core/foods-parser.js';
import { buildBackup, backupToJSON, parseBackup, planImport, tieneObjetivos } from '../core/backup.js';
import { foodCompleteness, isIncomplete } from '../core/completeness.js';
import { nutrientsForGrams } from '../core/nutrients.js';
import { looseKey } from '../core/text.js';
import { MAX_GRAMS } from '../core/ai-contract.js';
import { loadTargets, resolveTargets, referenceValue } from '../core/targets.js';
import { diaryReport, shiftDate } from '../core/diary.js';
import { parseNumber } from '../core/numbers.js';

const FLAG_TEXT = {
  variante_por_defecto: 'No dijiste el estado: se usa la variante por defecto',
  variante_cambiada: 'Se ajustó la variante elegida por la IA',
  variante_no_disponible: 'Dijiste un estado que no tiene variante en tu documento',
  sin_variante_por_defecto: 'Este grupo no tiene variante por defecto',
  estado_discrepante: 'La IA vio un estado que no dijiste: revísalo',
  gramos_altos: 'Cantidad muy alta: confírmala',
  convertido_ml: 'Convertido de ml a g con la densidad de tu documento',
  unidad_discrepante: 'Dijiste un volumen pero la IA lo pasó como gramos: revisa la cantidad',
  sin_alias: 'No coincide con tus alias: revisa que sea este alimento',
  gramos_asumidos: 'Asumido en gramos (no dijiste la unidad)',
};
const MOTIVO_TEXT = { no_en_catalogo: 'No está en tu documento', ambiguo: 'No lo tengo claro', sin_porcion: 'Falta la cantidad en gramos', excluido_catalogo: 'Excluido del catálogo (incluir=no)', sin_densidad: 'Dijiste ml y este alimento no tiene densidad_g_ml en tu documento' };
const MEAL_LABEL = { desayuno: 'Desayuno', comida: 'Comida', merienda: 'Merienda', cena: 'Cena', otro: 'Otro' };
const nf0 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 });
const UNIT_LABEL = { g: 'g', mg: 'mg', ug: 'µg', kcal: 'kcal' };
// Decimales según el tamaño: 2.350 kcal, 61,2 g, 0,84 mg.
const fmtNum = (v, unit) => (unit === 'kcal' || Math.abs(v) >= 100 ? nf0 : Math.abs(v) >= 10 ? nf1 : nf2).format(v);
const fmtQty = (v, unit) => `${fmtNum(v, unit)} ${UNIT_LABEL[unit] ?? unit}`;
const MACROS = ['energia_kcal', 'proteina_g', 'grasa_total_g', 'grasas_saturadas_g', 'hidratos_g', 'azucares_g', 'fibra_g'];
const ESTADO_TEXT = {
  cumplido: 'Objetivo cumplido', por_debajo: 'Por debajo', dentro: 'Dentro del máximo', excedido: 'Por encima del máximo',
  en_objetivo: 'En objetivo', por_encima: 'Por encima', sin_dato: 'Sin dato', sin_objetivo: '',
};
const TIPO_TEXT = { min: 'al menos', max: 'como mucho', objetivo: 'objetivo' };
// Resultado de "Probar" (comprueba origen, secretos y token sin gastar IA).
const probarTexto = (r) => (!r?.ok ? 'El Worker no responde bien.'
  : r.token === 'incorrecto' ? 'El Worker responde, pero el token no es correcto.'
    : r.configurado === false ? 'El Worker responde, pero le faltan secretos (GEMINI_API_KEY o APP_TOKEN): ver README, «Worker».'
      : r.token === 'ok' ? 'Todo correcto: el Worker responde, tiene sus secretos y el token es el correcto.' : 'El Worker responde.');

// deps: { store, createAiClient, catalog, settings, targets (data/targets.json), objetivos (los tuyos, del almacén),
//         initial: { foods, extraHeaders, docName }, conn, now, idGen, readFile, saveFile }
export function mountApp(root, deps) {
  const doc = root.ownerDocument;
  const now = deps.now ?? (() => new Date());
  const readFile = deps.readFile ?? ((f) => f.text());
  // Entregar un fichero: en el iPhone, el menú Compartir ("Guardar en Archivos", AirDrop...); si no, descarga.
  // Se llama directamente desde el toque del botón (Safari exige que compartir salga de un gesto del usuario).
  const saveFile = deps.saveFile ?? (async ({ name, text, type }) => {
    const win = doc.defaultView;
    const file = new win.File([text], name, { type });
    if (win.navigator.canShare?.({ files: [file] })) {
      try { await win.navigator.share({ files: [file], title: name }); return 'compartido'; } catch (e) { if (e?.name === 'AbortError') return 'cancelado'; }
    }
    const url = win.URL.createObjectURL(new win.Blob([text], { type }));
    const a = doc.createElement('a');
    a.href = url; a.download = name; doc.body.append(a); a.click(); a.remove();
    win.setTimeout(() => win.URL.revokeObjectURL(url), 10000);
    return 'descargado';
  });
  const state = {
    screen: 'home', foods: deps.initial.foods, extraHeaders: deps.initial.extraHeaders ?? [], docName: deps.initial.docName ?? '',
    text: '', meal: defaultMeal(now()), draft: null, busy: false, error: '', status: '', importResult: null, conn: { ...(deps.conn ?? {}) }, allMeals: [], backupImport: null, docMsg: '',
    day: madridNow(now()).date, dayMeals: [], objetivos: { ...(deps.objetivos ?? {}) }, diaryMsg: '', pendingDelete: null,
  };
  const targets = loadTargets(deps.targets ?? {}, deps.catalog).targets;
  let pending = Promise.resolve();
  const track = (p) => { pending = pending.then(() => p, () => p); return p; };
  const whenIdle = async () => { let last; do { last = pending; await last.catch(() => {}); } while (last !== pending); };

  const h = (tag, props = {}, ...kids) => {
    const e = doc.createElement(tag);
    for (const [k, v] of Object.entries(props ?? {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (k === 'value') e.value = v;
      else if (['checked', 'disabled', 'selected'].includes(k)) e[k] = !!v;
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat(Infinity)) if (c !== null && c !== undefined && c !== false) e.append(c.nodeType ? c : doc.createTextNode(String(c)));
    return e;
  };

  let byIdCache = { foods: null, map: null };
  const byId = () => (byIdCache.foods === state.foods ? byIdCache.map : (byIdCache = { foods: state.foods, map: new Map(state.foods.map((f) => [f.id, f])) }).map);
  const req = deps.settings.requiredNutrients;
  const thr = deps.settings.completenessThreshold;
  const incompleteInfo = (food) => { const c = foodCompleteness(food, req); return isIncomplete(c, thr) ? c : null; };

  // ---------- acciones ----------
  const persistFoods = () => deps.store.putCatalogRecord({ foods: state.foods, extraHeaders: state.extraHeaders, name: state.docName, importedAt: now().toISOString() });

  async function activate(id) {
    state.foods = state.foods.map((f) => (f.id === id ? { ...f, extra: { ...f.extra, incluir: 'si' } } : f));
    await persistFoods();
  }

  async function interpret(text) {
    const ai = deps.createAiClient(state.conn);
    const result = await ai.interpretMeal({ texto: text, alimentos: buildCompactList(state.foods) });
    return annotateExcluded(result, state.foods);
  }

  function process() {
    const text = state.text.trim();
    if (!text || state.busy) return;
    state.busy = true; state.error = ''; state.status = ''; render();
    return track((async () => {
      try {
        const result = await interpret(text);
        state.draft = createDraft({ text, meal: state.meal, result, foodsById: byId() });
        state.screen = 'confirm';
      } catch (e) {
        state.error = e.userMessage ?? `Error inesperado: ${e.message}`;
      } finally {
        state.busy = false; render();
      }
    })());
  }

  // Tras activar un alimento excluido: se vuelve a interpretar la misma frase con la lista ampliada.
  function reprocess() {
    state.busy = true; state.error = ''; render();
    return track((async () => {
      const { text, meal } = state.draft;
      try {
        state.draft = createDraft({ text, meal, result: await interpret(text), foodsById: byId() });
      } catch (e) {
        state.error = e.userMessage ?? `Error inesperado: ${e.message}`;
      } finally {
        state.busy = false; render();
      }
    })());
  }

  function startManual() {
    state.draft = createDraft({ text: state.text.trim(), meal: state.meal, foodsById: byId() });
    state.error = ''; state.screen = 'confirm'; render();
  }

  function save() {
    if (!validateDraft(state.draft).ok) return;
    if (state.draft.editing) return saveEdit();
    return track((async () => {
      const rec = toMealRecord(state.draft, { now: now(), idGen: deps.idGen });
      await deps.store.addMeal(rec);
      state.status = `Guardado en ${MEAL_LABEL[rec.meal].toLowerCase()}: ${rec.lines.length} ${rec.lines.length === 1 ? 'alimento' : 'alimentos'}.`;
      state.text = ''; state.draft = null; state.screen = 'home'; render();
    })());
  }

  const today = () => madridNow(now()).date;
  async function loadDay(date) { state.day = date; state.dayMeals = await deps.store.listMealsByDate(date); }
  const openDay = (date, msg = '') => track(loadDay(date).then(() => { state.screen = 'diary'; state.diaryMsg = msg; state.pendingDelete = null; render(); }));

  // Comida editada: mismo id (se sustituye); se vuelve al diario del día en que queda.
  function saveEdit() {
    return track((async () => {
      const rec = toMealRecord(state.draft, { now: now() });
      await deps.store.addMeal(rec);
      const movida = rec.date !== state.draft.editing.date;
      state.draft = null;
      await openDay(rec.date, movida ? `Cambios guardados. La comida está ahora en este día.` : 'Cambios guardados.');
    })());
  }

  function deleteMeal(id, date) {
    return track((async () => {
      await deps.store.deleteMeal(id);
      state.draft = null;
      await openDay(date, 'Comida borrada.');
    })());
  }

  // Borrar pide confirmación dentro de la app (sin diálogos del navegador): "Borrar" -> "Sí, borrar" / "Cancelar".
  function deleteControls(id, date, label = 'Borrar') {
    if (state.pendingDelete !== id) {
      return h('button', { class: 'link danger', onclick: () => { state.pendingDelete = id; render(); } }, label);
    }
    return h('span', { class: 'confirm-delete', role: 'group', 'aria-label': 'Confirmar borrado' },
      h('span', { class: 'small' }, '¿Borrar esta comida? '),
      h('button', { class: 'danger', onclick: () => deleteMeal(id, date) }, 'Sí, borrar'),
      h('button', { class: 'link', onclick: () => { state.pendingDelete = null; render(); } }, 'Cancelar'));
  }

  // Pantalla Documento: se cargan antes todas las comidas para que "Exportar" comparta en el mismo toque.
  const openDoc = (msg = '') => track(deps.store.allMeals().then((all) => { state.allMeals = all; state.docMsg = msg; state.screen = 'doc'; render(); }));
  const fecha = () => madridNow(now()).date;

  function exportDiary() {
    const text = backupToJSON(buildBackup({ meals: state.allMeals, objetivos: tieneObjetivos(state.objetivos) ? state.objetivos : null, now: now() }));
    const n = state.allMeals.length;
    return track(saveFile({ name: `nutritiontracker-diario-${fecha()}.json`, text, type: 'application/json' }).then((r) => {
      state.docMsg = r === 'cancelado' ? 'Exportación cancelada.' : `Copia del diario: ${n} ${n === 1 ? 'comida' : 'comidas'}.`; render();
    }));
  }

  function exportFoods(excel) {
    const text = foodsToCSV(state.foods, { catalog: deps.catalog, extraHeaders: state.extraHeaders, delimiter: excel ? ';' : ',', decimalComma: excel, bom: true });
    const name = `nutritiontracker-alimentos${excel ? '-excel' : ''}-${fecha()}.csv`;
    return track(saveFile({ name, text, type: 'text/csv' }).then((r) => {
      state.docMsg = r === 'cancelado' ? 'Exportación cancelada.' : `Documento exportado: ${state.foods.length} alimentos.`; render();
    }));
  }

  function onBackupFile(file) {
    if (!file) return;
    return track((async () => {
      state.allMeals = await deps.store.allMeals();
      const parsed = parseBackup(await readFile(file));
      const plan = parsed.ok ? planImport(state.allMeals, parsed.meals) : null;
      const restaurarObjetivos = parsed.ok && tieneObjetivos(parsed.objetivos) && !tieneObjetivos(state.objetivos);
      const desconocidos = parsed.ok ? new Set(parsed.meals.flatMap((m) => m.lines.map((l) => l.food_id)).filter((id) => !byId().has(id))) : new Set();
      state.backupImport = { name: file.name, parsed, plan, restaurarObjetivos, desconocidos: [...desconocidos], applied: false };
      state.docMsg = ''; render();
    })());
  }

  function applyBackup() {
    const b = state.backupImport;
    return track((async () => {
      for (const m of b.plan.escribir) await deps.store.addMeal(m);
      if (b.restaurarObjetivos) { state.objetivos = b.parsed.objetivos; await deps.store.setSetting('objetivos', state.objetivos); }
      state.backupImport = null;
      const partes = [`${b.plan.nuevas.length} nuevas`, `${b.plan.actualizadas.length} actualizadas`];
      await openDoc(`Copia importada: ${partes.join(', ')}${b.restaurarObjetivos ? '; objetivos restaurados' : ''}.`);
    })());
  }

  function backupView(b) {
    if (!b.parsed.ok) return h('section', { class: 'report' }, h('p', { class: 'error', role: 'alert' }, `«${b.name}»: ${b.parsed.error}`), h('button', { class: 'link', onclick: () => { state.backupImport = null; render(); } }, 'Cerrar'));
    const { plan } = b;
    const nada = plan.escribir.length === 0 && !b.restaurarObjetivos;
    return h('section', { class: 'report', 'aria-label': 'Importar copia' },
      h('p', {}, `«${b.name}»: ${b.parsed.meals.length} comidas válidas.`),
      h('ul', { class: 'small' },
        h('li', {}, `${plan.nuevas.length} nuevas`),
        h('li', {}, `${plan.actualizadas.length} se actualizan (la copia tiene una versión más reciente)`),
        h('li', {}, `${plan.iguales.length} ya estaban igual`),
        plan.masAntiguas.length ? h('li', {}, `${plan.masAntiguas.length} más antiguas que las de este dispositivo: se mantienen las tuyas`) : null,
        b.parsed.objetivos ? h('li', {}, b.restaurarObjetivos ? 'Se restaurarán los objetivos de la copia.' : 'Objetivos: se mantienen los de este dispositivo.') : null,
        b.desconocidos.length ? h('li', { class: 'warn' }, `Alimentos que no están en tu documento (saldrán sin datos): ${b.desconocidos.join(', ')}`) : null),
      b.parsed.errors.length ? h('details', { class: 'errors', open: true }, h('summary', {}, `Comidas con error, no se importan (${b.parsed.errors.length})`),
        h('ul', {}, b.parsed.errors.slice(0, 30).map((e) => h('li', {}, `n.º ${e.index + 1}${e.id ? ` [${e.id}]` : ''}: ${e.message}`)))) : null,
      h('p', { class: 'muted small' }, 'Importar nunca borra nada de este dispositivo.'),
      h('div', { class: 'row' },
        nada ? h('p', { class: 'muted' }, 'No hay nada nuevo que importar.') : h('button', { class: 'primary', onclick: () => applyBackup() }, plan.escribir.length ? `Importar ${plan.escribir.length} ${plan.escribir.length === 1 ? 'comida' : 'comidas'}` : 'Restaurar objetivos'),
        h('button', { class: 'link', onclick: () => { state.backupImport = null; render(); } }, nada ? 'Cerrar' : 'Cancelar')));
  }

  function editMeal(rec) {
    state.draft = draftFromRecord(rec, byId());
    state.pendingDelete = null; state.error = ''; state.screen = 'confirm'; render();
  }

  // Guarda tus objetivos. Vacío = referencia; un valor no válido no se guarda y se dice cuál.
  async function saveObjetivos(perfil, inputs) {
    const valores = {};
    const malos = [];
    for (const [clave, raw] of Object.entries(inputs)) {
      if (!String(raw).trim()) continue;
      const n = parseNumber(raw);
      if (n.status === 'ok' && n.value > 0) valores[clave] = n.value;
      else malos.push(targets.list.find((t) => t.clave === clave)?.label ?? clave);
    }
    if (malos.length) return { ok: false, msg: `No guardado: valor no válido en ${malos.join(', ')}.` };
    state.objetivos = { perfil, valores };
    await deps.store.setSetting('objetivos', state.objetivos);
    return { ok: true, msg: 'Guardado.' };
  }

  function onFile(file) {
    if (!file) return;
    return track((async () => {
      const text = await readFile(file);
      const parsed = parseFoodsDocument(text, { catalog: deps.catalog, filename: file.name });
      state.importResult = { name: file.name, parsed, applied: false };
      if (parsed.report.ok && parsed.foods.length > 0) await applyImport(); // sin errores: se guarda directamente
      render();
    })());
  }

  async function applyImport() {
    const { name, parsed } = state.importResult;
    state.foods = parsed.foods; state.extraHeaders = parsed.extraHeaders; state.docName = name;
    await persistFoods();
    state.importResult.applied = true;
  }

  // ---------- piezas de interfaz ----------
  const fmtTotal = (t, key, unit, nf) => {
    const r = t[key];
    if (r.value === null) return `sin dato de ${unit}`;
    return `${nf.format(r.value)} ${unit}${r.missing.length ? ' (parcial)' : ''}`;
  };

  function mealChips(current, onPick) {
    return h('div', { class: 'chips', role: 'group', 'aria-label': 'Comida' }, MEALS.map((m) =>
      h('button', { type: 'button', class: 'chip', 'aria-pressed': String(m === current), onclick: () => onPick(m) }, MEAL_LABEL[m])));
  }

  function header(title, back) {
    return h('header', { class: back ? 'top with-back' : 'top' },
      back ? h('button', { class: 'link', onclick: back }, '‹ Volver') : h('strong', { class: 'brand' }, title),
      back ? h('strong', {}, title) : h('nav', {},
        h('button', { class: 'link', onclick: () => openDay(today()) }, 'Diario'),
        h('button', { class: 'link', onclick: () => openDoc() }, 'Documento')));
  }

  function openPicker({ title, onPick }) {
    const overlay = h('div', { class: 'overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
    const input = h('input', { type: 'search', placeholder: 'Buscar en tu documento…', 'aria-label': 'Buscar alimento' });
    const list = h('ul', { class: 'picker-list' });
    const close = () => overlay.remove();
    const fill = () => {
      list.replaceChildren();
      const q = looseKey(input.value);
      const matches = state.foods.filter((f) => !q || [f.nombre, ...f.alias].some((t) => looseKey(t).includes(q))).slice(0, 60);
      if (!matches.length) list.append(h('li', { class: 'muted' }, 'Sin resultados en tu documento'));
      for (const f of matches) {
        list.append(h('li', {}, h('button', { class: 'pick', onclick: () => { close(); track(Promise.resolve(isExcluded(f) ? activate(f.id) : null).then(() => onPick(f))); } },
          h('span', {}, f.nombre, isExcluded(f) ? h('span', { class: 'tag' }, 'excluido (incluir=no): se activará') : null),
          f.alias.length ? h('small', {}, f.alias.slice(0, 3).join(' · ')) : null)));
      }
    };
    input.addEventListener('input', fill);
    overlay.append(h('div', { class: 'sheet' }, h('div', { class: 'sheet-head' }, h('strong', {}, title), h('button', { class: 'link', onclick: close }, 'Cerrar')), input, list));
    root.append(overlay); fill(); try { input.focus(); } catch { /* sin foco */ }
  }

  // ---------- pantallas ----------
  function homeScreen() {
    let btn;
    const ta = h('textarea', {
      class: 'dictado', rows: '6', placeholder: 'Toca aquí y dicta con el micrófono del teclado…', 'aria-label': 'Qué has comido', autofocus: true, value: state.text,
      oninput: (e) => { state.text = e.target.value; btn.disabled = state.busy || !state.text.trim(); },
    });
    btn = h('button', { class: 'primary', disabled: state.busy || !state.text.trim(), onclick: process }, state.busy ? 'Procesando…' : 'Procesar');
    const incompletos = state.foods.filter(incompleteInfo).length;
    queueMicrotask(() => { try { ta.focus(); } catch { /* sin foco */ } });
    return h('main', {},
      header('NutritionTracker'),
      state.status ? h('p', { class: 'ok', role: 'status' }, state.status) : null,
      state.foods.length === 0 ? h('p', { class: 'warn' }, 'No hay documento de alimentos. Impórtalo en Documento.') : h('p', { class: 'muted' }, `${state.foods.length} alimentos${incompletos ? ` · ${incompletos} incompletos` : ''}`),
      ta, mealChips(state.meal, (m) => { state.meal = m; render(); }),
      state.error ? h('p', { class: 'error', role: 'alert' }, state.error) : null,
      h('div', { class: 'row' }, btn, h('button', { class: 'secondary', onclick: startManual }, 'Añadir a mano')));
  }

  function flagsFor(line) { return line.flags.filter((f) => FLAG_TEXT[f]).map((f) => h('div', { class: 'flag' }, FLAG_TEXT[f])); }

  function confirmScreen() {
    const d = state.draft;
    const footer = h('footer', { class: 'bar' });
    const totalsEl = h('div', { class: 'totals' });
    const editing = d.editing;
    const saveBtn = h('button', { class: 'primary', onclick: save }, editing ? 'Guardar cambios' : 'Guardar');
    const hint = h('div', { class: 'muted small' });
    const paintFooter = () => {
      const v = validateDraft(state.draft);
      const t = previewTotals(state.draft, byId());
      totalsEl.textContent = `Total: ${fmtTotal(t, 'energia_kcal', 'kcal', nf0)} · ${fmtTotal(t, 'proteina_g', 'g de proteína', nf1)}`;
      saveBtn.disabled = !v.ok || state.busy;
      hint.textContent = v.empty ? (editing ? 'Añade al menos un alimento o borra la comida.' : 'Añade al menos un alimento.') : v.problems.some((p) => p.code === 'fecha') ? 'La fecha no es válida.' : v.problems.some((p) => p.code === 'sin_revisar') ? 'Confirma o cambia los alimentos que no coinciden con tus alias.' : v.problems.length ? 'Revisa las líneas marcadas (gramos).' : state.draft.unmatched.length ? `${state.draft.unmatched.length} sin resolver (no se guardarán).` : '';
    };

    const lineCard = (line) => {
      const food = byId().get(line.food_id);
      const prev = h('div', { class: 'preview muted small' });
      const high = h('label', { class: 'flag high' });
      const gramsIn = h('input', { type: 'text', inputmode: 'decimal', class: 'grams', 'aria-label': `Gramos de ${food.nombre}`, value: line.grams ?? '' });
      const paint = () => {
        const cur = state.draft.lines.find((l) => l.key === line.key);
        if (!cur) return;
        const f = byId().get(cur.food_id);
        let txt = '';
        if (cur.grams > 0) {
          const n = nutrientsForGrams(f, cur.grams, ['energia_kcal', 'proteina_g']);
          txt = `${n.energia_kcal === null ? 'sin dato de kcal' : `${nf0.format(n.energia_kcal)} kcal`} · ${n.proteina_g === null ? 'sin dato de proteína' : `${nf1.format(n.proteina_g)} g prot.`}`;
        }
        prev.textContent = txt;
        const isHigh = cur.grams > MAX_GRAMS;
        high.hidden = !isHigh;
        high.replaceChildren(h('input', { type: 'checkbox', checked: cur.confirmedHigh, onchange: (e) => { state.draft = confirmHigh(state.draft, line.key, e.target.checked); paint(); paintFooter(); } }), ` Confirmo ${nf0.format(cur.grams ?? 0)} g`);
        const badGrams = lineProblem({ ...cur, needsReview: false }) !== null; // solo problemas de gramos
        gramsIn.classList.toggle('bad', badGrams);
        gramsIn.setAttribute('aria-invalid', String(badGrams));
      };
      gramsIn.addEventListener('input', (e) => { state.draft = setGrams(state.draft, line.key, e.target.value); paint(); paintFooter(); });
      const inc = incompleteInfo(food);
      const card = h('li', { class: 'card', 'data-key': line.key },
        h('div', { class: 'row between' },
          h('button', { class: 'name', 'aria-label': `Cambiar alimento: ${food.nombre}`, onclick: () => openPicker({ title: 'Cambiar alimento', onPick: (f) => { state.draft = changeFood(state.draft, line.key, f.id); render(); } }) }, food.nombre),
          h('button', { class: 'icon', 'aria-label': `Borrar ${food.nombre}`, onclick: () => { state.draft = removeLine(state.draft, line.key); render(); } }, '✕')),
        line.source_text ? h('div', { class: 'muted small' }, `«${line.source_text}»`) : null,
        h('div', { class: 'row' }, gramsIn, h('span', {}, 'g'), h('span', { class: `badge ${line.confidence}` }, line.confidence)),
        flagsFor(line),
        line.needsReview ? h('button', { class: 'secondary review', onclick: () => { state.draft = confirmFood(state.draft, line.key); render(); } }, `Sí, es «${food.nombre}»`) : null,
        high,
        inc ? h('div', { class: 'flag' }, `Alimento incompleto (${inc.filled}/${inc.total} nutrientes): los totales de micronutrientes no serán completos`) : null,
        prev);
      paint();
      return card;
    };

    const unmatchedCard = (u, i) => {
      const actions = [];
      if (u.food_id && byId().has(u.food_id)) {
        const f = byId().get(u.food_id);
        actions.push(h('button', { class: 'secondary', onclick: () => { state.draft = resolveUnmatched(state.draft, i, u.food_id, null, f); render(); } }, `Poner gramos de «${f.nombre}»`));
      }
      for (const id of u.candidates ?? []) {
        const f = byId().get(id);
        if (f) actions.push(h('button', { class: 'secondary', onclick: () => track((async () => { await activate(id); await reprocess(); })()) }, `Activar «${f.nombre}»`));
      }
      actions.push(h('button', { class: 'secondary', onclick: () => openPicker({ title: 'Buscar en mi documento', onPick: (f) => { state.draft = resolveUnmatched(state.draft, i, f.id, null, f); render(); } }) }, 'Buscar en mi documento'));
      actions.push(h('button', { class: 'link', onclick: () => { state.draft = dropUnmatched(state.draft, i); render(); } }, 'Descartar'));
      return h('li', { class: 'card unmatched' }, h('div', {}, `«${u.text}»`), h('div', { class: 'muted small' }, MOTIVO_TEXT[u.motivo] ?? u.motivo), h('div', { class: 'row wrap' }, actions));
    };

    footer.append(totalsEl, hint, h('div', { class: 'row' }, saveBtn));
    const dateIn = editing ? h('input', { type: 'date', 'aria-label': 'Fecha', value: d.date, max: today(), onchange: (e) => { state.draft = setDate(state.draft, e.target.value); paintFooter(); } }) : null;
    const screen = h('main', {},
      editing ? header('Editar comida', () => { state.draft = null; openDay(editing.date); }) : header('Confirmar', () => { state.screen = 'home'; render(); }),
      editing ? h('p', { class: 'muted small' }, 'Los cambios no se guardan hasta pulsar «Guardar cambios».') : null,
      editing ? h('label', {}, 'Fecha', dateIn) : null,
      state.error ? h('p', { class: 'error', role: 'alert' }, state.error) : null,
      state.busy ? h('p', { class: 'muted', role: 'status' }, 'Procesando…') : null,
      d.text ? h('p', { class: 'muted small' }, `«${d.text}»`) : null,
      mealChips(d.meal, (m) => { state.draft = setMeal(state.draft, m); render(); }),
      d.warnings.length ? h('ul', { class: 'warnlist' }, d.warnings.map((w) => h('li', {}, w))) : null,
      h('ul', { class: 'cards' }, d.lines.map(lineCard)),
      h('button', { class: 'secondary', onclick: () => openPicker({ title: 'Añadir alimento', onPick: (f) => { state.draft = addLine(state.draft, f.id); render(); } }) }, '+ Añadir alimento'),
      d.unmatched.length ? h('h2', {}, 'Sin resolver') : null,
      h('ul', { class: 'cards' }, d.unmatched.map(unmatchedCard)),
      editing ? h('div', { class: 'row' }, deleteControls(editing.id, editing.date, 'Borrar esta comida')) : null,
      footer);
    paintFooter();
    return screen;
  }

  function reportView(r, applyBtn) {
    const { parsed } = r;
    const sec = (title, list, cls) => (list.length ? h('details', { class: cls, open: cls === 'errors' }, h('summary', {}, `${title} (${list.length})`),
      h('ul', {}, list.slice(0, 30).map((i) => h('li', {}, formatIssue(i, parsed.report.rowLabel))), list.length > 30 ? h('li', { class: 'muted' }, `… y ${list.length - 30} más`) : null)) : null);
    const s = parsed.report.summary;
    return h('section', { class: 'report' },
      h('p', { role: 'status', class: parsed.report.ok ? 'ok' : 'error' },
        parsed.foods.length === 0 ? `No se puede importar «${r.name}».` : r.applied ? `Importado «${r.name}»: ${s.imported} alimentos.` : `«${r.name}»: ${s.imported} alimentos válidos, ${s.rejected} filas con error.`),
      sec('Errores', parsed.report.errors, 'errors'), sec('Avisos', parsed.report.warnings, 'warnings'), sec('Información', parsed.report.info, 'info'),
      !r.applied && parsed.foods.length > 0 ? applyBtn : null);
  }

  function docScreen() {
    const fileIn = h('input', { type: 'file', accept: '.csv,.json,text/csv,application/json,text/plain', hidden: true, 'aria-label': 'Elegir documento de alimentos', onchange: (e) => onFile(e.target.files[0]) });
    const ep = h('input', { type: 'url', placeholder: 'https://nutrition-tracker-ai.TU-CUENTA.workers.dev', value: state.conn.endpoint ?? '', 'aria-label': 'Dirección del Worker' });
    const tk = h('input', { type: 'password', placeholder: 'Token compartido', value: state.conn.token ?? '', 'aria-label': 'Token', autocomplete: 'off' });
    const connMsg = h('p', { class: 'muted small', role: 'status' });
    const backupIn = h('input', { type: 'file', accept: '.json,application/json', hidden: true, 'aria-label': 'Elegir copia del diario', onchange: (e) => onBackupFile(e.target.files[0]) });
    const incompletos = state.foods.filter(incompleteInfo).length;
    return h('main', {},
      header('Documento', () => { state.screen = 'home'; render(); }),
      h('section', { class: 'panel' },
        h('p', {}, state.foods.length ? `${state.docName || 'Documento'}: ${state.foods.length} alimentos (${incompletos} incompletos).` : 'Sin documento cargado.'),
        h('div', { class: 'row' }, h('button', { class: 'primary', onclick: () => fileIn.click() }, 'Importar documento'), fileIn),
        state.importResult ? reportView(state.importResult, h('button', { class: 'primary', onclick: () => track(applyImport().then(render)) }, `Importar ${state.importResult.parsed.foods.length} alimentos válidos`)) : null),
      h('section', { class: 'panel' },
        h('h2', {}, 'Conexión con la IA'),
        h('label', {}, 'Worker', ep), h('label', {}, 'Token', tk),
        h('div', { class: 'row' },
          h('button', { class: 'secondary', onclick: () => track((async () => { state.conn = { endpoint: ep.value.trim(), token: tk.value }; await deps.store.setSetting('conn', state.conn); connMsg.textContent = 'Guardado.'; })()) }, 'Guardar'),
          h('button', { class: 'secondary', onclick: () => track((async () => { try { connMsg.textContent = probarTexto(await deps.createAiClient({ endpoint: ep.value.trim(), token: tk.value }).health()); } catch (e) { connMsg.textContent = e.userMessage ?? e.message; } })()) }, 'Probar')),
        connMsg),
      h('section', { class: 'panel' },
        h('h2', {}, 'Copia de seguridad'),
        h('p', { class: 'muted small' }, `El diario solo está en este dispositivo: exporta una copia de vez en cuando (${state.allMeals.length} ${state.allMeals.length === 1 ? 'comida guardada' : 'comidas guardadas'}). La copia no incluye el token.`),
        state.docMsg ? h('p', { class: 'ok', role: 'status' }, state.docMsg) : null,
        h('div', { class: 'row wrap' },
          h('button', { class: 'secondary', onclick: () => exportDiary() }, 'Exportar diario'),
          h('button', { class: 'secondary', onclick: () => backupIn.click() }, 'Importar diario'), backupIn),
        state.backupImport ? backupView(state.backupImport) : null,
        h('div', { class: 'row wrap' },
          h('button', { class: 'secondary', disabled: !state.foods.length, onclick: () => exportFoods(true) }, 'Exportar documento (Excel)'),
          h('button', { class: 'secondary', disabled: !state.foods.length, onclick: () => exportFoods(false) }, 'Exportar documento (CSV con comas)'))));
  }

  const dayLabel = (date) => {
    if (date === today()) return 'Hoy';
    if (date === shiftDate(today(), -1)) return 'Ayer';
    const [y, m, d] = date.split('-').map(Number);
    return new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)));
  };

  // Una fila de nutriente: valor / objetivo, barra y estado. Superar el UL es un aviso aparte (no "cumplido").
  function nutrientRow(r) {
    const valor = r.total === null ? 'sin dato' : fmtQty(r.total, r.unit);
    const objetivo = r.valor === null ? '' : ` / ${fmtQty(r.valor, r.unit)}`;
    const fill = h('span', {});
    fill.style.width = `${Math.min(1, r.pct ?? 0) * 100}%`;
    const pct = r.pct !== null && r.estado !== 'sin_dato' ? `${nf0.format(r.pct * 100)} %` : '';
    return h('li', { class: r.superaUl ? 'nut over-ul' : 'nut', 'data-clave': r.clave },
      h('div', { class: 'row between nut-head' }, h('span', { class: 'nut-label' }, r.label, r.parcial && r.total !== null ? h('span', { class: 'tag' }, 'parcial') : null), h('span', { class: 'nut-valor' }, valor, h('span', { class: 'muted' }, objetivo))),
      h('div', { class: `meter ${r.estado}`, role: 'img', 'aria-label': pct || 'sin dato' }, fill),
      h('div', { class: 'small nut-estado' },
        h('span', { class: `estado ${r.estado}` }, [ESTADO_TEXT[r.estado], pct].filter(Boolean).join(' · ')),
        r.superaUl ? h('strong', { class: 'ul' }, ` ⚠ Supera el máximo tolerable (UL ${fmtQty(r.ul, r.unit)})`) : null));
  }

  const fmtKcal = (x) => (x.kcal === null ? 'sin dato de kcal' : `${nf0.format(x.kcal)} kcal${x.kcalParcial ? ' (parcial)' : ''}`);

  function diaryScreen() {
    const rep = diaryReport(state.dayMeals, byId(), resolveTargets(targets, state.objetivos), deps.catalog);
    const macros = rep.rows.filter((r) => MACROS.includes(r.clave));
    const micros = rep.rows.filter((r) => !MACROS.includes(r.clave));
    return h('main', {},
      header('Diario', () => { state.screen = 'home'; render(); }),
      h('nav', { class: 'daynav row between', 'aria-label': 'Día' },
        h('button', { class: 'icon', 'aria-label': 'Día anterior', onclick: () => openDay(shiftDate(state.day, -1)) }, '‹'),
        h('strong', { class: 'daylabel' }, dayLabel(state.day)),
        h('button', { class: 'icon', 'aria-label': 'Día siguiente', disabled: state.day >= today(), onclick: () => openDay(shiftDate(state.day, 1)) }, '›')),
      state.day !== today() ? h('button', { class: 'link', onclick: () => openDay(today()) }, 'Ir a hoy') : null,
      state.diaryMsg ? h('p', { class: 'ok', role: 'status' }, state.diaryMsg) : null,
      state.dayMeals.length === 0 ? h('p', { class: 'muted' }, 'Sin registros este día.') : [
        rep.avisosUl.length ? h('section', { class: 'alert-ul', role: 'alert' }, h('h2', {}, '⚠ Máximo tolerable (UL) superado'),
          h('ul', {}, rep.avisosUl.map((r) => h('li', {}, `${r.label}: ${fmtQty(r.total, r.unit)} (UL ${fmtQty(r.ul, r.unit)})`, r.notaUl ? h('div', { class: 'small muted' }, r.notaUl) : null)))) : null,
        rep.parciales.length ? h('p', { class: 'warn small' }, `Totales parciales: faltan datos de ${rep.parciales.join(', ')}.`) : null,
        h('section', { class: 'panel' }, h('h2', {}, 'Energía y macros'), h('ul', { class: 'nuts' }, macros.map(nutrientRow))),
        h('section', { class: 'panel' }, h('h2', {}, 'Micronutrientes'), h('ul', { class: 'nuts' }, micros.map(nutrientRow))),
        h('details', { class: 'panel' }, h('summary', {}, 'Otros nutrientes'),
          h('ul', {}, rep.otros.map((o) => h('li', {}, `${o.label}: ${o.total === null ? 'sin dato' : fmtQty(o.total, o.unit)}${o.parcial && o.total !== null ? ' (parcial)' : ''}`)))),
        h('h2', {}, 'Comidas'),
        rep.comidas.map((c) => h('section', { class: 'card meal' },
          h('div', { class: 'row between meal-head' }, h('strong', {}, MEAL_LABEL[c.meal]), h('span', { class: 'muted' }, fmtKcal(c))),
          c.registros.map((r) => h('div', { class: 'registro', 'data-id': r.id },
            h('ul', { class: 'lines' }, r.lines.map((l) => h('li', { class: 'line' },
              h('span', { class: 'line-name' }, l.nombre), h('span', { class: 'sep' }, ' · '),
              h('span', { class: 'line-grams' }, `${nf1.format(l.grams)} g`), h('span', { class: 'sep' }, ' · '),
              h('span', { class: l.kcal === null ? 'line-kcal sin-dato' : 'line-kcal' }, l.kcal === null ? 'sin dato' : `${nf0.format(l.kcal)} kcal`)))),
            h('div', { class: 'row between registro-actions' },
              h('span', { class: 'muted small' }, c.registros.length > 1 ? fmtKcal(r) : ''),
              h('span', { class: 'row' }, h('button', { class: 'link', onclick: () => editMeal(r.record) }, 'Editar'), deleteControls(r.id, state.day))))))),
      ],
      h('div', { class: 'row' }, h('button', { class: 'secondary', onclick: () => { state.screen = 'objetivos'; render(); } }, 'Objetivos')));
  }

  function objetivosScreen() {
    const own = state.objetivos.valores ?? {};
    const perfilActual = resolveTargets(targets, state.objetivos)[0]?.perfil ?? targets.perfilPorDefecto;
    const perfilSel = h('select', { 'aria-label': 'Perfil de referencia' },
      Object.entries(targets.perfiles).map(([k, label]) => h('option', { value: k, selected: k === perfilActual }, label)));
    const inputs = new Map();
    const msg = h('p', { class: 'small', role: 'status' });
    const campo = (t) => {
      const ref = referenceValue(targets, t.clave, { perfil: perfilActual, valores: own });
      const unit = UNIT_LABEL[t.unit] ?? t.unit;
      const input = h('input', { type: 'text', inputmode: 'decimal', 'aria-label': `${t.label} (${unit})`, value: own[t.clave] === undefined ? '' : nf2.format(own[t.clave]).replace(/\./g, ''), placeholder: ref === null ? '' : fmtNum(ref, t.unit) });
      inputs.set(t.clave, input);
      return h('li', { class: `card k-${t.clave}` },
        h('label', {}, h('span', {}, `${t.label} (${unit}) · ${TIPO_TEXT[t.tipo]}`), input),
        h('div', { class: 'small muted' }, [ref === null ? '' : `Referencia: ${fmtQty(ref, t.unit)}`, t.ul !== null ? `UL: ${fmtQty(t.ul, t.unit)}` : '', t.nota].filter(Boolean).join(' · ')));
    };
    const save = (vaciar) => track((async () => {
      const r = await saveObjetivos(perfilSel.value, vaciar ? {} : Object.fromEntries([...inputs].map(([k, el]) => [k, el.value])));
      if (r.ok) { render(); root.querySelector('[role=status]').textContent = r.msg; } else msg.textContent = r.msg;
    })());
    return h('main', {},
      header('Objetivos', () => openDay(state.day)),
      h('label', {}, 'Perfil de referencia (EFSA)', perfilSel),
      h('p', { class: 'muted small' }, 'Vacío = valor de referencia. Tus objetivos se guardan en este dispositivo. B1, niacina y ALA se calculan con tu objetivo de kcal. Los UL no cambian.'),
      h('h2', {}, 'Energía y macros'), h('ul', { class: 'cards' }, targets.list.filter((t) => MACROS.includes(t.clave)).map(campo)),
      h('h2', {}, 'Micronutrientes'), h('ul', { class: 'cards' }, targets.list.filter((t) => !MACROS.includes(t.clave)).map(campo)),
      h('div', { class: 'row' }, h('button', { class: 'primary', onclick: () => save(false) }, 'Guardar'), h('button', { class: 'secondary', onclick: () => save(true) }, 'Restablecer')),
      msg);
  }

  // ---------- render ----------
  function render() {
    const screens = { home: homeScreen, confirm: confirmScreen, doc: docScreen, diary: diaryScreen, objetivos: objetivosScreen };
    root.replaceChildren(screens[state.screen]());
  }
  render();
  return { state, render, whenIdle };
}
