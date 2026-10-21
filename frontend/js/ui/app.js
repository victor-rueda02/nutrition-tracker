// Interfaz: barra inferior Diario · Alimentos · [+] · Más. El "+" abre el dictado -> Confirmación (editable) -> Guardar. Diario
// (resumen del día y comidas) con el Informe diario detrás de los tres puntos; Alimentos (catálogo, recetas, plantillas);
// Más (Objetivos, Documento, Copia de seguridad, Conexión, Pulir el documento).
// Sin frameworks: DOM con textContent (nunca innerHTML con datos). Toda la lógica de negocio está en js/core.
import { buildCompactList } from '../core/ai-contract.js';
import { annotateExcluded, isExcluded } from '../core/excluded.js';
import { createDraft, setGrams, changeFood, confirmFood, removeLine, addLine, resolveUnmatched, dropUnmatched, confirmHigh, setMeal, setDate, validateDraft, lineProblem, previewTotals, toMealRecord, draftFromRecord } from '../core/draft.js';
import { MEALS, defaultMeal, madridNow } from '../core/meal-defaults.js';
import { parseFoodsDocument, parseFoodsCSV, formatIssue, foodsToCSV } from '../core/foods-parser.js';
import { buildBackup, backupToJSON, parseBackup, planImport, tieneObjetivos } from '../core/backup.js';
import { foodCompleteness, isIncomplete } from '../core/completeness.js';
import { nutrientsForGrams } from '../core/nutrients.js';
import { looseKey } from '../core/text.js';
import { MAX_GRAMS } from '../core/ai-contract.js';
import { loadTargets } from '../core/targets.js';
import { targetsForDate, planFromLegacy, validatePlan } from '../core/targets-plan.js';
import { diaryReport, shiftDate } from '../core/diary.js';
import { avisoParciales } from '../core/parciales.js';
import { createRepeat, validateRepeat, toRecords, DESTINO_ORIGEN } from '../core/repeat.js';
import { repeatScreen } from './repeat-screen.js';
import { cleanTemplates, nameError, templateFromRecord, addTemplate, removeTemplate, templateAsMeals, mergeTemplates } from '../core/templates.js';
import { templatesScreen } from './templates-screen.js';
import { newEntry, resolveEntry, cleanLog, addEntry, updateEntry, removeEntry, logToCSV, mergeLog } from '../core/phrase-log.js';
import { phraseLogScreen } from './phrase-log-screen.js';
import { hashText, planCatalogUpdate, applyChoices, unirCabeceras } from '../core/catalog-update.js';
import { catalogUpdateScreen } from './catalog-update-screen.js';
import { parseNumber } from '../core/numbers.js';
import { estimateActions, estimateScreen, pendientesView, MOTIVOS_ESTIMABLES } from './estimate-screen.js';
import { recetasActions, recetasScreen } from './recetas-screen.js';
import { cleanRecetas, mergeRecetasImport } from '../core/recetas.js';
import { objetivosScreen } from './objetivos-screen.js';
import { foodSinDatos, detectarPlatos, tratarComoPlato, lineaAEstimar, deshacerPlato } from '../core/sin-datos.js';
import { bottomNav, sheet, popMenu, icon } from './nav.js';
import { reportScreen, energySummary, parcialesDiario } from './report-screen.js';
import { alimentosScreen, catalogoListScreen } from './foods-screen.js';
import { masScreen } from './more-screen.js';
import { cenasActions, cenasScreen } from './cenas-screen.js';

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
  alias_mas_especifico: 'Dijiste algo más específico que este alimento: revisa cuál es',
  gramos_asumidos: 'Asumido en gramos (no dijiste la unidad)',
  estimado_ia: 'Estimado con IA: proporciones típicas del plato, revisa los gramos',
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
    screen: 'diary', sheet: null, menu: false, docSection: 'documento', catQuery: '', catFilter: 'todos', catFocus: false, addDate: null, plantillasBack: 'alimentos', recetasBack: 'alimentos', foods: deps.initial.foods, extraHeaders: deps.initial.extraHeaders ?? [], docName: deps.initial.docName ?? '',
    text: '', meal: defaultMeal(now()), draft: null, busy: false, error: '', status: '', importResult: null, conn: { ...(deps.conn ?? {}) }, allMeals: [], backupImport: null, docMsg: '',
    day: madridNow(now()).date, dayMeals: [], objetivos: { ...(deps.objetivos ?? {}) }, diaryMsg: '', pendingDelete: null, repeat: null, repeatBack: null, plantillas: [], plantillasMsg: '', templateForm: null, registro: [], logMsg: '', catUpdate: null, catEleccion: {}, catMsg: '', catBack: 'diary',
    estimate: null, cenas: null, recetas: [], recetasPropias: [], recetaForm: null, recetasMsg: '', // «Estimar con IA» y recetas (ui/estimate-screen.js, ui/recetas-screen.js)
  };
  const targets = loadTargets(deps.targets ?? {}, deps.catalog).targets;
  // Plan de objetivos (docs/OBJETIVOS-FORMATO.md): cada día se evalúa con los objetivos vigentes ESE día.
  state.plan = null;
  const targetsFor = (fecha) => targetsForDate(fecha, { plan: state.plan, targets, catalog: deps.catalog });
  let pending = Promise.resolve();
  // Toda acción asíncrona pasa por aquí. Ninguna falla en silencio: si algo lanza un error, se muestra arriba en
  // cualquier pantalla ("No se pudo guardar: …") y no se toca nada más (el borrador y la pantalla se conservan).
  const track = (p, que = 'Algo ha fallado') => {
    state.fail = ''; // una acción nueva quita el aviso de la anterior
    const q = Promise.resolve(p).catch((e) => {
      state.fail = `${que}: ${e?.message ?? e}`;
      globalThis.console?.error?.(e);
      render();
    });
    pending = pending.then(() => q, () => q);
    return q;
  };
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
  // Carga el plan; si no hay y tenías objetivos de la pantalla anterior, pasan a un plan abierto desde tu primer día.
  async function loadPlan() {
    let plan = await deps.store.getSetting('plan_objetivos');
    if (!plan && tieneObjetivos(deps.objetivos)) {
      const fechas = (await deps.store.allMeals()).map((m) => m.date).sort();
      plan = planFromLegacy(deps.objetivos, { desde: fechas[0] ?? madridNow(now()).date, targets });
      if (plan) await deps.store.setSetting('plan_objetivos', plan);
    }
    state.plan = plan ?? null;
    if (['diary', 'informe', 'objetivos'].includes(state.screen)) render();
  }
  // El plan de una copia: el suyo si es válido o, en una copia antigua, el de sus objetivos.
  function planDeCopia(parsed) {
    if (parsed.plan) return validatePlan(parsed.plan, { targets, catalog: deps.catalog }).plan;
    return planFromLegacy(parsed.objetivos, { desde: parsed.meals.map((m) => m.date).sort()[0] ?? madridNow(now()).date, targets });
  }

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
        const entry = newEntry({ texto: text, result, now: now() });
        if (entry) await deps.store.setSetting('registro_frases', addEntry(await loadLog(), entry));
        state.draft = { ...createDraft({ text, meal: state.meal, result, foodsById: byId() }), logId: entry?.id ?? null, addDate: state.addDate };
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
        state.draft = { ...createDraft({ text, meal, result: await interpret(text), foodsById: byId() }), addDate: state.draft.addDate };
      } catch (e) {
        state.error = e.userMessage ?? `Error inesperado: ${e.message}`;
      } finally {
        state.busy = false; render();
      }
    })());
  }

  function startManual() {
    state.draft = { ...createDraft({ text: state.text.trim(), meal: state.meal, foodsById: byId() }), addDate: state.addDate };
    state.error = ''; state.screen = 'confirm'; render();
  }

  function save() {
    if (!validateDraft(state.draft).ok) return;
    if (state.draft.editing) return saveEdit();
    return track((async () => {
      const rec = toMealRecord(state.draft, { now: now(), idGen: deps.idGen });
      if (state.draft.addDate) rec.date = state.draft.addDate; // "+" de una comida de otro día: se guarda en ese día
      await deps.store.addMeal(rec);
      if (state.draft.logId) {
        const log = await loadLog();
        const entry = log.find((e) => e.id === state.draft.logId);
        if (entry) await deps.store.setSetting('registro_frases', updateEntry(log, resolveEntry(entry, rec.lines)));
      }
      const msg = `Guardado en ${MEAL_LABEL[rec.meal].toLowerCase()}: ${rec.lines.length} ${rec.lines.length === 1 ? 'alimento' : 'alimentos'}.`;
      state.text = ''; state.draft = null; state.addDate = null;
      await openDay(rec.date, msg);
    })(), 'No se pudo guardar');
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
    })(), 'No se pudo guardar');
  }

  function deleteMeal(id, date) {
    return track((async () => {
      await deps.store.deleteMeal(id);
      state.draft = null;
      await openDay(date, 'Comida borrada.');
    })(), 'No se pudo borrar');
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
  const loadTemplates = async () => cleanTemplates(await deps.store.getSetting('plantillas'));
  const loadLog = async () => cleanLog(await deps.store.getSetting('registro_frases'));
  const openDoc = (msg = '', section = state.docSection) => track((async () => {
    state.allMeals = await deps.store.allMeals();
    state.plantillas = await loadTemplates();
    state.registro = await loadLog();
    state.recetasPropias = cleanRecetas(await deps.store.getSetting('recetas'));
    state.docMsg = msg; state.docSection = section; state.screen = 'doc'; render();
  })());
  const fecha = () => madridNow(now()).date;

  // ¿Hay una versión nueva del foods.csv publicado? (deps.fetchPublished; sin conexión no pasa nada).
  // manual = desde Documento: dice siempre el resultado y abre la revisión si hay cambios.
  // volver = a qué pantalla regresa la revisión («Volver», «Ahora no»); alTerminar(msg, estado) = quién dice el resultado
  // cuando no hay nada que revisar (por defecto, Documento): estado 'al_dia' | 'sin_conexion' | 'errores' | 'sin_publicado'.
  function checkCatalogUpdate({ manual = false, volver = 'doc', alTerminar = null } = {}) {
    if (!deps.fetchPublished) {
      if (manual && alTerminar) alTerminar('Esta versión de la app no puede consultar el documento publicado.', 'sin_publicado');
      return Promise.resolve();
    }
    const decir = (msg, estado) => { if (manual) { if (alTerminar) alTerminar(msg, estado); else { state.catMsg = msg; render(); } } };
    return track((async () => {
      let text;
      try { text = await deps.fetchPublished(); } catch { decir('No se pudo consultar el documento publicado (¿sin conexión?).', 'sin_conexion'); return; }
      const hash = hashText(text);
      const base = await deps.store.getSetting('catalogo_base');
      if (base?.hash === hash) { decir('Tu documento está al día con el publicado.', 'al_dia'); return; }
      const remote = parseFoodsCSV(text, { catalog: deps.catalog });
      if (!remote.report.ok || !remote.foods.length) { decir('El documento publicado tiene errores: no se ofrece.', 'errores'); return; }
      const baseFoods = base?.text ? parseFoodsCSV(base.text, { catalog: deps.catalog }).foods : null;
      const plan = planCatalogUpdate({ local: state.foods, remote: remote.foods, base: baseFoods, catalog: deps.catalog });
      if (!plan.hayCambios) { await deps.store.setSetting('catalogo_base', { hash, text }); decir('Tu documento está al día con el publicado.', 'al_dia'); return; }
      const ignorado = (await deps.store.getSetting('catalogo_ignorado')) === hash;
      state.catUpdate = { hash, text, remote, plan, ignorado };
      state.catEleccion = {};
      state.catMsg = '';
      if (manual) { state.catBack = volver; state.screen = 'catalogo'; }
      render();
    })(), 'No se pudo comprobar el documento publicado');
  }

  function applyCatalogUpdate() {
    const u = state.catUpdate;
    return track((async () => {
      state.foods = applyChoices(u.plan, u.remote.foods, state.catEleccion);
      state.extraHeaders = unirCabeceras(state.extraHeaders, u.remote.extraHeaders);
      await persistFoods();
      await deps.store.setSetting('catalogo_base', { hash: u.hash, text: u.text });
      await deps.store.setSetting('catalogo_ignorado', null);
      state.catUpdate = null;
      state.diaryMsg = `Documento actualizado: ${u.plan.nuevos.length} nuevos, ${u.plan.actualizados.length} actualizados.`;
      state.screen = 'diary'; render();
    })(), 'No se pudo actualizar el documento');
  }

  // «Ahora no»: no se vuelve a avisar de esta versión (se puede revisar desde Documento).
  function postponeCatalogUpdate() {
    return track((async () => {
      await deps.store.setSetting('catalogo_ignorado', state.catUpdate.hash);
      state.catUpdate = { ...state.catUpdate, ignorado: true };
      if (state.screen === 'catalogo') state.screen = state.catBack;
      render();
    })());
  }

  const openLog = (msg = '') => track((async () => {
    state.registro = await loadLog();
    state.logMsg = msg; state.pendingDelete = null; state.screen = 'registro'; render();
  })());
  const removeLogEntry = (id) => track((async () => {
    await deps.store.setSetting('registro_frases', removeEntry(await loadLog(), id));
    await openLog('Frase quitada.');
  })());
  const clearLog = () => track((async () => {
    await deps.store.setSetting('registro_frases', []);
    await openLog('Registro vaciado.');
  })());
  function exportLog() {
    const text = logToCSV(state.registro, byId());
    return track(saveFile({ name: `nutritiontracker-frases-${madridNow(now()).date}.csv`, text, type: 'text/csv' }).then((r) => {
      state.logMsg = r === 'cancelado' ? 'Exportación cancelada.' : `Exportadas ${state.registro.length} frases.`; render();
    }), 'No se pudo exportar');
  }

  function exportDiary() {
    const text = backupToJSON(buildBackup({ meals: state.allMeals, plan: state.plan, plantillas: state.plantillas, registro: state.registro, recetas: state.recetasPropias, now: now() }));
    const n = state.allMeals.length;
    return track(saveFile({ name: `nutritiontracker-diario-${fecha()}.json`, text, type: 'application/json' }).then((r) => {
      state.docMsg = r === 'cancelado' ? 'Exportación cancelada.' : `Copia del diario: ${n} ${n === 1 ? 'comida' : 'comidas'}.`; render();
    }), 'No se pudo exportar');
  }

  function exportFoods(excel) {
    const text = foodsToCSV(state.foods, { catalog: deps.catalog, extraHeaders: state.extraHeaders, delimiter: excel ? ';' : ',', decimalComma: excel, bom: true });
    const name = `nutritiontracker-alimentos${excel ? '-excel' : ''}-${fecha()}.csv`;
    return track(saveFile({ name, text, type: 'text/csv' }).then((r) => {
      state.docMsg = r === 'cancelado' ? 'Exportación cancelada.' : `Documento exportado: ${state.foods.length} alimentos.`; render();
    }), 'No se pudo exportar');
  }

  function onBackupFile(file) {
    if (!file) return;
    return track((async () => {
      state.allMeals = await deps.store.allMeals();
      const parsed = parseBackup(await readFile(file));
      const plan = parsed.ok ? planImport(state.allMeals, parsed.meals) : null;
      const planCopia = parsed.ok ? planDeCopia(parsed) : null;
      const restaurarObjetivos = Boolean(planCopia) && !state.plan;
      const desconocidos = parsed.ok ? new Set(parsed.meals.flatMap((m) => m.lines.map((l) => l.food_id)).filter((id) => !byId().has(id))) : new Set();
      const plantillas = parsed.ok ? mergeTemplates(await loadTemplates(), parsed.plantillas) : null;
      const registro = parsed.ok ? mergeLog(await loadLog(), parsed.registro) : null;
      const recetas = parsed.ok ? mergeRecetasImport(cleanRecetas(await deps.store.getSetting('recetas')), parsed.recetas) : null;
      state.backupImport = { name: file.name, parsed, plan, planCopia, restaurarObjetivos, plantillas, registro, recetas, desconocidos: [...desconocidos], applied: false };
      state.docMsg = ''; render();
    })(), 'No se pudo leer la copia');
  }

  function applyBackup() {
    const b = state.backupImport;
    return track((async () => {
      for (const m of b.plan.escribir) await deps.store.addMeal(m);
      if (b.restaurarObjetivos) { state.plan = b.planCopia; await deps.store.setSetting('plan_objetivos', state.plan); }
      if (b.plantillas.nuevas.length) await deps.store.setSetting('plantillas', b.plantillas.list);
      if (b.registro.nuevas.length) await deps.store.setSetting('registro_frases', b.registro.list);
      if (b.recetas.nuevas.length) await deps.store.setSetting('recetas', b.recetas.list);
      state.backupImport = null;
      const partes = [`${b.plan.nuevas.length} nuevas`, `${b.plan.actualizadas.length} actualizadas`];
      if (b.plantillas.nuevas.length) partes.push(`${b.plantillas.nuevas.length} ${b.plantillas.nuevas.length === 1 ? 'plantilla' : 'plantillas'}`);
      if (b.registro.nuevas.length) partes.push(`${b.registro.nuevas.length} ${b.registro.nuevas.length === 1 ? 'frase a revisar' : 'frases a revisar'}`);
      if (b.recetas.nuevas.length) partes.push(`${b.recetas.nuevas.length} ${b.recetas.nuevas.length === 1 ? 'receta' : 'recetas'}`);
      await openDoc(`Copia importada: ${partes.join(', ')}${b.restaurarObjetivos ? '; objetivos restaurados' : ''}.`);
    })(), 'No se pudo importar la copia');
  }

  function backupView(b) {
    if (!b.parsed.ok) return h('section', { class: 'report' }, h('p', { class: 'error', role: 'alert' }, `«${b.name}»: ${b.parsed.error}`), h('button', { class: 'link', onclick: () => { state.backupImport = null; render(); } }, 'Cerrar'));
    const { plan } = b;
    const nada = plan.escribir.length === 0 && !b.restaurarObjetivos && !b.plantillas.nuevas.length && !b.registro.nuevas.length && !b.recetas.nuevas.length;
    return h('section', { class: 'report', 'aria-label': 'Importar copia' },
      h('p', {}, `«${b.name}»: ${b.parsed.meals.length} comidas válidas.`),
      h('ul', { class: 'small' },
        h('li', {}, `${plan.nuevas.length} nuevas`),
        h('li', {}, `${plan.actualizadas.length} se actualizan (la copia tiene una versión más reciente)`),
        h('li', {}, `${plan.iguales.length} ya estaban igual`),
        plan.masAntiguas.length ? h('li', {}, `${plan.masAntiguas.length} más antiguas que las de este dispositivo: se mantienen las tuyas`) : null,
        b.parsed.registro.length ? h('li', {}, `${b.registro.nuevas.length} frases a revisar nuevas (las que ya tienes se mantienen)`) : null,
        b.parsed.plantillas.length ? h('li', {}, `${b.plantillas.nuevas.length} plantillas nuevas (las que ya tienes se mantienen)`) : null,
        b.parsed.recetas.length ? h('li', {}, `${b.recetas.nuevas.length} recetas nuevas (las que ya tienes se mantienen; sus filas van en el documento)`) : null,
        b.parsed.plan || tieneObjetivos(b.parsed.objetivos) ? h('li', { class: b.planCopia ? null : 'warn' }, !b.planCopia ? 'El plan de objetivos de la copia no es válido: no se restaura.' : b.restaurarObjetivos ? 'Se restaurarán los objetivos de la copia.' : 'Objetivos: se mantienen los de este dispositivo.') : null,
        b.desconocidos.length ? h('li', { class: 'warn' }, `Alimentos que no están en tu documento (saldrán sin datos): ${b.desconocidos.join(', ')}`) : null),
      b.parsed.errors.length ? h('details', { class: 'errors', open: true }, h('summary', {}, `Comidas con error, no se importan (${b.parsed.errors.length})`),
        h('ul', {}, b.parsed.errors.slice(0, 30).map((e) => h('li', {}, `n.º ${e.index + 1}${e.id ? ` [${e.id}]` : ''}: ${e.message}`)))) : null,
      h('p', { class: 'muted small' }, 'Importar nunca borra nada de este dispositivo.'),
      h('div', { class: 'row' },
        nada ? h('p', { class: 'muted' }, 'No hay nada nuevo que importar.') : h('button', { class: 'primary', onclick: () => applyBackup() }, plan.escribir.length ? `Importar ${plan.escribir.length} ${plan.escribir.length === 1 ? 'comida' : 'comidas'}`
          : b.plantillas.nuevas.length ? `Importar ${b.plantillas.nuevas.length} ${b.plantillas.nuevas.length === 1 ? 'plantilla' : 'plantillas'}`
            : b.registro.nuevas.length ? `Importar ${b.registro.nuevas.length} ${b.registro.nuevas.length === 1 ? 'frase' : 'frases'}`
              : b.recetas.nuevas.length ? `Importar ${b.recetas.nuevas.length} ${b.recetas.nuevas.length === 1 ? 'receta' : 'recetas'}` : 'Restaurar objetivos'),
        h('button', { class: 'link', onclick: () => { state.backupImport = null; render(); } }, nada ? 'Cerrar' : 'Cancelar')));
  }

  // "Repetir": comidas de otro día con ajuste rápido de gramos, sin IA (ver ui/repeat-screen.js).
  // Desde el inicio: el día entero de ayer, cada grupo a su comida. Desde el Diario: esa comida, a la comida de la hora.
  function openRepeat({ sourceDate, recordId = null, targetDate = today(), targetMeal = DESTINO_ORIGEN, back = state.repeatBack }) {
    return track((async () => {
      const day = await deps.store.listMealsByDate(sourceDate);
      const meals = recordId ? day.filter((m) => m.id === recordId) : day;
      state.repeat = createRepeat({ meals, sourceDate, recordId, foodsById: byId(), targetDate, targetMeal });
      state.repeatBack = back;
      state.screen = 'repeat'; render();
    })(), 'No se pudo abrir');
  }

  const openTemplates = (msg = '', back = state.plantillasBack) => track((async () => {
    state.plantillas = await loadTemplates();
    state.plantillasBack = back; state.plantillasMsg = msg; state.pendingDelete = null; state.screen = 'plantillas'; render();
  })());

  // Guardar una comida del Diario como plantilla (con nombre; sin repetir nombres).
  function saveTemplate(rec, nombre) {
    return track((async () => {
      const list = await loadTemplates();
      const err = nameError(nombre, list);
      if (err) { state.templateForm = { ...state.templateForm, nombre, error: err }; render(); return; }
      const t = templateFromRecord(rec, { nombre, list, now: now(), idGen: deps.idGen });
      await deps.store.setSetting('plantillas', addTemplate(list, t));
      state.templateForm = null;
      state.diaryMsg = `Plantilla «${t.nombre}» guardada. La tienes en Alimentos → Plantillas.`;
      render();
    })(), 'No se pudo guardar la plantilla');
  }

  function deleteTemplate(id) {
    return track((async () => {
      const list = await loadTemplates();
      const t = list.find((x) => x.id === id);
      await deps.store.setSetting('plantillas', removeTemplate(list, id));
      await openTemplates(t ? `Plantilla «${t.nombre}» borrada.` : '');
    })(), 'No se pudo borrar la plantilla');
  }

  function useTemplate(t) {
    state.repeat = createRepeat({ meals: templateAsMeals(t), template: { id: t.id, nombre: t.nombre }, foodsById: byId(), targetDate: today(), targetMeal: DESTINO_ORIGEN });
    state.repeatBack = 'plantillas'; state.screen = 'repeat'; render();
  }

  function saveRepeat() {
    const r = state.repeat;
    if (!validateRepeat(r).ok) return;
    return track((async () => {
      const recs = toRecords(r, { now: now(), idGen: deps.idGen });
      for (const rec of recs) await deps.store.addMeal(rec);
      const n = recs.reduce((a, x) => a + x.lines.length, 0);
      state.repeat = null;
      const de = r.template ? `la plantilla «${r.template.nombre}»` : dayLabel(r.sourceDate).toLowerCase();
      await openDay(r.targetDate, `Añadidos ${n} ${n === 1 ? 'alimento' : 'alimentos'} de ${de}.`);
    })(), 'No se pudo guardar');
  }

  function editMeal(rec) {
    state.draft = draftFromRecord(rec, byId());
    state.pendingDelete = null; state.error = ''; state.screen = 'confirm'; render();
  }

  function onFile(file) {
    if (!file) return;
    return track((async () => {
      const text = await readFile(file);
      const parsed = parseFoodsDocument(text, { catalog: deps.catalog, filename: file.name });
      state.importResult = { name: file.name, parsed, applied: false };
      if (parsed.report.ok && parsed.foods.length > 0) await applyImport(); // sin errores: se guarda directamente
      render();
    })(), 'No se pudo leer el documento');
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

  // Cabecera de las pantallas interiores: "‹" a la izquierda (el texto "Volver" queda solo para lectores de pantalla) y el título centrado.
  function header(title, back, { close = false, sub = '' } = {}) {
    return h('header', { class: back ? 'top with-back' : 'top' },
      back ? h('button', { type: 'button', class: 'icon back', onclick: back }, icon(doc, close ? 'close' : 'back'), h('span', { class: 'sr' }, '‹ Volver')) : h('strong', { class: 'brand' }, title),
      back ? (sub ? h('div', { class: 'title-block' }, h('strong', {}, title), h('small', { class: 'muted' }, sub)) : h('strong', {}, title)) : null, back ? h('span', {}) : null);
  }

  // ---------- navegación (barra inferior y "+") ----------
  // El "+" central abre directamente el dictado, con la comida de la hora. El "+" de cada comida abre su hoja de opciones.
  function openAdd({ meal = defaultMeal(now()), date = null } = {}) {
    state.sheet = null; state.menu = false; state.meal = meal; state.addDate = date;
    state.error = ''; state.screen = 'home'; render();
  }
  const openAlimentos = () => track((async () => { state.plantillas = await loadTemplates(); state.recetas = (await rec.todas()).filter((r) => !r.ejemplo); state.screen = 'alimentos'; state.pendingDelete = null; render(); })());
  const openCatalogList = ({ focus = false } = {}) => { state.catFocus = focus; state.screen = 'micatalogo'; render(); };
  function go(id) {
    state.sheet = null; state.menu = false;
    if (id === 'diary') return openDay(today());
    if (id === 'alimentos') return openAlimentos();
    if (id === 'mas') { state.screen = 'mas'; state.pendingDelete = null; render(); return undefined; }
    return openAdd();
  }
  const TAB_OF = { diary: 'diary', informe: 'diary', alimentos: 'alimentos', micatalogo: 'alimentos', plantillas: 'alimentos', recetas: 'alimentos', catalogo: 'alimentos', mas: 'mas', doc: 'mas', objetivos: 'mas', registro: 'mas', cenas: 'diary' };
  const SIN_BARRA = ['home', 'confirm', 'repeat', 'estimar']; // llevan su propia barra de acciones
  // Regla general: una pantalla con su propia barra fija de acciones (footer.bar) nunca lleva la barra inferior de navegación,
  // que si no la taparía (mismo bottom:0 y más z-index) y dejaría el botón de guardar fuera de alcance (recetas, y las que vengan).
  const llevaBarraPropia = (screen) => screen.querySelector(':scope > footer.bar') !== null;

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
        list.append(h('li', {}, h('button', { class: 'pick', onclick: () => { close(); onPick(f); } }, // un excluido elegido a mano se usa en esa línea, sin activarlo (sigue sin ir a la IA)
          h('span', {}, f.nombre, isExcluded(f) ? h('span', { class: 'tag' }, 'excluido (incluir=no): no se envía a la IA') : null),
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
      class: 'dictado', rows: '4', placeholder: 'Toca aquí y dicta con el micrófono del teclado…', 'aria-label': 'Qué has comido', autofocus: true, value: state.text,
      oninput: (e) => { state.text = e.target.value; btn.disabled = state.busy || !state.text.trim(); },
    });
    btn = h('button', { class: 'primary', disabled: state.busy || !state.text.trim(), onclick: process }, state.busy ? 'Procesando…' : 'Procesar');
    const incompletos = state.foods.filter(incompleteInfo).length;
    queueMicrotask(() => { try { ta.focus(); } catch { /* sin foco */ } });
    const fechaDestino = state.addDate ?? today();
    const quick = (ico, label, onclick) => h('button', { type: 'button', class: 'quick', onclick }, icon(doc, ico), h('span', {}, label));
    return h('main', { class: 'dictado-screen' },
      header(`Añadir a ${MEAL_LABEL[state.meal]}`, () => { if (state.day === fechaDestino) { state.screen = 'diary'; render(); } else openDay(fechaDestino); }, { close: true, sub: shortDate(fechaDestino) }),
      h('div', { class: 'quick-row', role: 'group', 'aria-label': 'Accesos rápidos' },
        quick('hand', 'Añadir a mano', startManual),
        quick('copy', 'Repetir de ayer', () => openRepeat({ sourceDate: shiftDate(fechaDestino, -1), targetDate: fechaDestino, back: 'home' })),
        quick('list', 'Plantillas', () => openTemplates('', 'home')),
        quick('spark', 'Estimar con IA', estimateFromText)),
      mealChips(state.meal, (m) => { state.meal = m; render(); }), ta,
      state.error ? h('p', { class: 'error', role: 'alert' }, state.error) : null,
      h('div', { class: 'row' }, btn),
      state.foods.length === 0 ? h('p', { class: 'warn' }, 'No hay documento de alimentos. Impórtalo en Documento.') : h('p', { class: 'muted small' }, `${state.foods.length} alimentos${incompletos ? ` · ${incompletos} incompletos` : ''}`));
  }

  // «Estimar con IA» desde el "+": el texto dictado se trata como un plato que no está en el documento.
  function estimateFromText() {
    const text = state.text.trim();
    if (!text) { state.error = 'Añade al menos un alimento.'; render(); return undefined; }
    state.draft = { ...createDraft({ text, meal: state.meal, foodsById: byId() }), addDate: state.addDate };
    state.draft.unmatched = [{ text, motivo: 'no_en_catalogo' }];
    return est.start(0);
  }

  function flagsFor(line) { return line.flags.filter((f) => FLAG_TEXT[f]).map((f) => h('div', { class: 'flag' }, FLAG_TEXT[f])); }

  function confirmScreen() {
    const d = state.draft;
    const footer = h('footer', { class: 'bar' });
    const totalsEl = h('div', { class: 'totals' });
    const editing = d.editing;
    const saveBtn = h('button', { class: 'primary', onclick: save }, editing ? 'Guardar cambios' : 'Guardar');
    const hint = h('div', { class: 'muted small' });
    const platos = detectarPlatos(d, byId());
    // «Estimar con IA» para una línea sin datos o para un plato partido: pasan a "sin resolver" y se estima desde ahí.
    const estimarLinea = (key) => { const r = lineaAEstimar(state.draft, key, byId()); state.draft = r.draft; if (r.index >= 0) est.start(r.index); };
    const estimarPlato = (p) => { const r = tratarComoPlato(state.draft, p); state.draft = r.draft; if (r.index >= 0) est.start(r.index); };
    let pantalla = null;
    const ajustarMargen = () => { if (pantalla) pantalla.style.paddingBottom = `${footer.offsetHeight + 24}px`; }; // el pie fijo no tapa la última tarjeta
    const paintFooter = () => {
      const v = validateDraft(state.draft);
      const t = previewTotals(state.draft, byId());
      totalsEl.textContent = `Total: ${fmtTotal(t, 'energia_kcal', 'kcal', nf0)} · ${fmtTotal(t, 'proteina_g', 'g de proteína', nf1)}`;
      saveBtn.disabled = !v.ok || state.busy;
      hint.textContent = v.empty ? (editing ? 'Añade al menos un alimento o borra la comida.' : 'Añade al menos un alimento.') : v.problems.some((p) => p.code === 'fecha') ? 'La fecha no es válida.' : v.problems.some((p) => p.code === 'sin_revisar') ? 'Confirma o cambia los alimentos que no coinciden con tus alias o tienen uno más específico.' : v.problems.length ? 'Revisa las líneas marcadas (gramos).' : state.draft.unmatched.length ? `${state.draft.unmatched.length} sin resolver (no se guardarán).` : '';
      ajustarMargen();
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
      const masEspecifico = line.masEspecifico ? byId().get(line.masEspecifico) : null; // alimento del alias más largo que dijiste
      const sinDatos = foodSinDatos(food);
      const inc =sinDatos ? null : incompleteInfo(food);
      const card = h('li', { class: 'card', 'data-key': line.key },
        h('div', { class: 'row between' },
          h('button', { class: 'name', 'aria-label': `Cambiar alimento: ${food.nombre}`, onclick: () => openPicker({ title: 'Cambiar alimento', onPick: (f) => { state.draft = changeFood(state.draft, line.key, f.id); render(); } }) }, food.nombre),
          h('button', { class: 'icon', 'aria-label': `Borrar ${food.nombre}`, onclick: () => { state.draft = removeLine(state.draft, line.key); render(); } }, '✕')),
        line.source_text ? h('div', { class: 'muted small' }, `«${line.source_text}»`) : null,
        h('div', { class: 'row' }, gramsIn, h('span', {}, 'g'), h('span', { class: `badge ${line.confidence}` }, line.confidence)),
        prev,
        flagsFor(line),
        sinDatos ? h('div', { class: 'flag', role: 'alert' }, h('strong', {}, 'Sin datos nutricionales:'), ' este alimento no tiene ningún nutriente en tu documento. No suma nada a los totales, que quedarán incompletos.') : null,
        sinDatos ? h('div', { class: 'row wrap' },
          h('button', { class: 'secondary', disabled: state.busy, onclick: () => estimarLinea(line.key) }, 'Estimar con IA'),
          h('button', { class: 'secondary', onclick: () => openPicker({ title: 'Elegir otro alimento', onPick: (f) => { state.draft = changeFood(state.draft, line.key, f.id); render(); } }) }, 'Elegir otro alimento')) : null,
        line.needsReview && masEspecifico ? h('div', { class: 'flag', role: 'alert' }, `Dijiste «${line.source_text}»: ¿es «${masEspecifico.nombre}»?`) : null,
        line.needsReview && masEspecifico ? h('button', { class: 'secondary review', onclick: () => { state.draft = changeFood(state.draft, line.key, masEspecifico.id); render(); } }, `Cambiar a «${masEspecifico.nombre}»`) : null,
        line.needsReview ? h('button', { class: 'secondary review', onclick: () => { state.draft = confirmFood(state.draft, line.key); render(); } }, `Sí, es «${food.nombre}»`) : null,
        high,
        inc ? h('div', { class: 'flag' }, `Alimento incompleto (${inc.filled}/${inc.total} nutrientes): los totales de micronutrientes no serán completos`) : null);
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
      if (MOTIVOS_ESTIMABLES.includes(u.motivo)) actions.push(h('button', { class: 'secondary', disabled: state.busy, onclick: () => est.start(i) }, 'Estimar con IA'));
      if (u.origen) actions.push(h('button', { class: 'secondary', onclick: () => { state.draft = deshacerPlato(state.draft, i); render(); } }, 'Volver a los alimentos por separado'));
      actions.push(h('button', { class: 'link', onclick: () => { state.draft = dropUnmatched(state.draft, i); render(); } }, 'Descartar'));
      return h('li', { class: 'card unmatched' }, h('div', {}, `«${u.text}»`), h('div', { class: 'muted small' }, MOTIVO_TEXT[u.motivo] ?? u.motivo), h('div', { class: 'row wrap' }, actions));
    };

    footer.append(totalsEl, hint, h('div', { class: 'row' }, saveBtn));
    const dateIn = editing ? h('input', { type: 'date', 'aria-label': 'Fecha', value: d.date, max: today(), onchange: (e) => { state.draft = setDate(state.draft, e.target.value); paintFooter(); } }) : null;
    const screen = h('main', {},
      editing ? header('Editar comida', () => { state.draft = null; openDay(editing.date); }) : header('Confirmar', () => { if (d.volver) { state.screen = d.volver; state.draft = null; } else state.screen = 'home'; render(); }),
      editing ? h('p', { class: 'muted small' }, 'Los cambios no se guardan hasta pulsar «Guardar cambios».') : null,
      editing ? h('label', {}, 'Fecha', dateIn) : null,
      state.error ? h('p', { class: 'error', role: 'alert' }, state.error) : null,
      state.busy ? h('p', { class: 'muted', role: 'status' }, 'Procesando…') : null,
      d.text ? h('p', { class: 'muted dictada' }, `«${d.text}»`) : null,
      mealChips(d.meal, (m) => { state.draft = setMeal(state.draft, m); render(); }),
      d.warnings.length ? h('ul', { class: 'warnlist' }, d.warnings.map((w) => h('li', {}, w))) : null,
      platos.length ? h('ul', { class: 'cards' }, platos.map((p) => h('li', { class: 'card plato' },
        h('div', {}, `«${p.texto}»`),
        h('div', { class: 'muted small' }, 'La IA lo ha separado en varios alimentos, pero suena a un solo plato.'),
        h('div', { class: 'row wrap' }, h('button', { class: 'secondary', disabled: state.busy, onclick: () => estimarPlato(p) }, 'Tratar como un plato y estimar con IA'))))) : null,
      h('ul', { class: 'cards' }, d.lines.map(lineCard)),
      h('button', { class: 'secondary wide', onclick: () => openPicker({ title: 'Añadir alimento', onPick: (f) => { state.draft = addLine(state.draft, f.id); render(); } }) }, '+ Añadir alimento'),
      d.unmatched.length ? h('h2', {}, 'Sin resolver') : null,
      h('ul', { class: 'cards' }, d.unmatched.map(unmatchedCard)),
      editing ? h('div', { class: 'row' }, deleteControls(editing.id, editing.date, 'Borrar esta comida')) : null,
      footer);
    pantalla = screen;
    paintFooter();
    queueMicrotask(ajustarMargen);
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

  const DOC_TITULO = { documento: 'Documento', copia: 'Copia de seguridad', conexion: 'Conexión con la IA', pulir: 'Pulir el documento' };
  function docScreen() {
    const sec = state.docSection;
    const fileIn = h('input', { type: 'file', accept: '.csv,.json,text/csv,application/json,text/plain', hidden: true, 'aria-label': 'Elegir documento de alimentos', onchange: (e) => onFile(e.target.files[0]) });
    const ep = h('input', { type: 'url', placeholder: 'https://nutrition-tracker-ai.TU-CUENTA.workers.dev', value: state.conn.endpoint ?? '', 'aria-label': 'Dirección del Worker' });
    const tk = h('input', { type: 'password', placeholder: 'Token compartido', value: state.conn.token ?? '', 'aria-label': 'Token', autocomplete: 'off' });
    const connMsg = h('p', { class: 'muted small', role: 'status' });
    const backupIn = h('input', { type: 'file', accept: '.json,application/json', hidden: true, 'aria-label': 'Elegir copia del diario', onchange: (e) => onBackupFile(e.target.files[0]) });
    const incompletos = state.foods.filter(incompleteInfo).length;
    const paneles = {
      documento: h('section', { class: 'panel' },
        h('p', {}, state.foods.length ? `${state.docName || 'Documento'}: ${state.foods.length} alimentos (${incompletos} incompletos).` : 'Sin documento cargado.'),
        h('div', { class: 'row' }, h('button', { class: 'primary', onclick: () => fileIn.click() }, 'Importar documento'), fileIn),
        deps.fetchPublished ? h('div', { class: 'row wrap' },
          h('button', { class: 'secondary', onclick: () => checkCatalogUpdate({ manual: true }) }, 'Buscar actualización del documento'),
          state.catUpdate ? h('button', { class: 'link', onclick: () => { state.catBack = 'doc'; state.screen = 'catalogo'; render(); } }, 'Revisar la versión nueva') : null) : null,
        state.catMsg ? h('p', { class: 'muted small', role: 'status' }, state.catMsg) : null,
        state.docMsg ? h('p', { class: 'ok', role: 'status' }, state.docMsg) : null,
        state.importResult ? reportView(state.importResult, h('button', { class: 'primary', onclick: () => track(applyImport().then(render), 'No se pudo importar el documento') }, `Importar ${state.importResult.parsed.foods.length} alimentos válidos`)) : null,
        h('div', { class: 'row wrap' },
          h('button', { class: 'secondary', disabled: !state.foods.length, onclick: () => exportFoods(true) }, 'Exportar documento (Excel)'),
          h('button', { class: 'secondary', disabled: !state.foods.length, onclick: () => exportFoods(false) }, 'Exportar documento (CSV con comas)'))),
      conexion: h('section', { class: 'panel' },
        h('label', {}, 'Worker', ep), h('label', {}, 'Token', tk),
        h('div', { class: 'row col' },
          h('button', { class: 'primary', onclick: () => track((async () => { state.conn = { endpoint: ep.value.trim(), token: tk.value }; await deps.store.setSetting('conn', state.conn); connMsg.textContent = 'Guardado.'; })()) }, 'Guardar'),
          h('button', { class: 'secondary', onclick: () => track((async () => { try { connMsg.textContent = probarTexto(await deps.createAiClient({ endpoint: ep.value.trim(), token: tk.value }).health()); } catch (e) { connMsg.textContent = e.userMessage ?? e.message; } })()) }, 'Probar')),
        connMsg),
      pulir: h('ul', { class: 'menu-list' },
        h('li', {}, h('button', { class: 'menu-row', onclick: () => openLog() }, h('span', { class: 'menu-ico' }, icon(doc, 'list')), h('span', { class: 'menu-text' }, 'Frases a revisar'), h('span', { class: 'valor' }, h('span', { class: 'sr' }, ' ('), String(state.registro.length), h('span', { class: 'sr' }, ')')), icon(doc, 'chevron', 'menu-chev'))),
        h('li', {}, h('button', { class: 'menu-row', onclick: () => { state.recetasBack = 'pulir'; rec.open(); } }, h('span', { class: 'menu-ico' }, icon(doc, 'chef')), h('span', { class: 'menu-text' }, 'Recetas'), icon(doc, 'chevron', 'menu-chev')))),
      copia: h('section', { class: 'panel' },
        h('p', { class: 'muted small' }, `El diario solo está en este dispositivo: exporta una copia de vez en cuando (${state.allMeals.length} ${state.allMeals.length === 1 ? 'comida guardada' : 'comidas guardadas'}). Lleva también tus objetivos, plantillas y frases a revisar; no incluye el token.`),
        doc.defaultView?.isSecureContext === false ? h('p', { class: 'warn small' }, 'Sin https (prueba en red local): el fichero se descarga en vez de abrir el menú Compartir, y la app no funciona sin conexión.') : null,
        state.docMsg ? h('p', { class: 'ok', role: 'status' }, state.docMsg) : null,
        h('div', { class: 'row col' },
          h('button', { class: 'primary', onclick: () => exportDiary() }, 'Exportar diario'),
          h('button', { class: 'secondary', onclick: () => backupIn.click() }, 'Importar diario'), backupIn),
        state.backupImport ? backupView(state.backupImport) : null),
    };
    return h('main', {},
      header(DOC_TITULO[sec] ?? 'Documento', () => { state.screen = 'mas'; render(); }),
      paneles[sec] ?? paneles.documento);
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
    const objetivo = r.valor === null ? '' : r.objetivo === null && r.min != null && r.max != null ? ` / ${fmtNum(r.min, r.unit)}–${fmtQty(r.max, r.unit)}` : ` / ${fmtQty(r.valor, r.unit)}`;
    const fill = h('span', {});
    fill.style.width = `${Math.min(1, r.pct ?? 0) * 100}%`;
    const pct = r.pct !== null && r.estado !== 'sin_dato' ? `${nf0.format(r.pct * 100)} %` : '';
    const excepcional = r.superaUl; // el % y el color ya dicen el resto; el texto de estado sigue en el DOM para lectores de pantalla
    return h('li', { class: r.superaUl ? 'nut over-ul' : 'nut', 'data-clave': r.clave },
      h('div', { class: 'row between nut-head' },
        h('span', { class: 'nut-main' }, h('span', { class: 'nut-label' }, r.label), ' ', h('span', { class: 'nut-tail' }, h('span', { class: 'nut-valor' }, valor, h('span', { class: 'muted' }, objetivo)), r.parcial && r.total !== null ? h('span', { class: 'tag' }, 'parcial') : null)),
        h('span', { class: `nut-pct ${r.estado}` }, pct)),
      h('div', { class: `meter ${r.estado}`, role: 'img', 'aria-label': pct || 'sin dato' }, fill),
      h('div', { class: excepcional ? 'small nut-estado' : 'small nut-estado sr' },
        h('span', { class: r.superaUl ? 'estado sr' : `estado ${r.estado}` }, [ESTADO_TEXT[r.estado], pct].filter(Boolean).join(' · ')),
        r.superaUl ? h('strong', { class: 'ul' }, ` ⚠ Supera el máximo tolerable (UL ${fmtQty(r.ul, r.unit)})`) : null,
        r.superaUl && r.notaUl ? h('div', { class: 'small muted nota-ul' }, r.notaUl) : null));
  }

  const fmtKcal = (x) => (x.kcal === null ? 'sin dato de kcal' : `${nf0.format(x.kcal)} kcal${x.kcalParcial ? ' (parcial)' : ''}`);

  const shortDate = (date) => {
    const [y, m, d] = date.split('-').map(Number);
    return new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d))).replace(/\./g, '');
  };
  const ordinarias = MEALS.filter((m) => m !== 'otro');

  function dayHeader() {
    const rel = state.day === today() ? 'Hoy' : state.day === shiftDate(today(), -1) ? 'Ayer' : null;
    return h('header', { class: 'top diary-top' },
      h('nav', { class: 'daynav', 'aria-label': 'Día' },
        h('button', { class: 'icon', 'aria-label': 'Día anterior', onclick: () => openDay(shiftDate(state.day, -1)) }, icon(doc, 'prev')),
        h('div', { class: 'daytitle' }, h('strong', { class: 'daylabel' }, rel ?? shortDate(state.day)), rel ? h('small', { class: 'muted' }, shortDate(state.day)) : null),
        h('button', { class: 'icon', 'aria-label': 'Día siguiente', disabled: state.day >= today(), onclick: () => openDay(shiftDate(state.day, 1)) }, icon(doc, 'next'))),
      h('button', { type: 'button', class: 'icon top-action', 'aria-label': 'Más opciones del día', 'aria-haspopup': 'menu', 'aria-expanded': String(state.menu), onclick: () => { state.menu = !state.menu; render(); } }, h('span', { class: 'dots-ring' }, icon(doc, 'dots'))));
  }

  function diaryScreen() {
    const obj = targetsFor(state.day);
    const rep = diaryReport(state.dayMeals, byId(), obj.list, deps.catalog);
    const macros = rep.rows.filter((r) => ['proteina_g', 'hidratos_g', 'grasa_total_g'].includes(r.clave));
    const mealCard = (c, meal) => h('section', { class: 'card meal', 'data-meal': meal },
      h('div', { class: 'row between meal-head' },
        h('button', { type: 'button', class: 'icon meal-add', 'aria-label': `Añadir a ${MEAL_LABEL[meal].toLowerCase()}`, onclick: () => { state.sheet = { meal, date: state.day }; render(); } }, icon(doc, 'plus')),
        h('strong', {}, MEAL_LABEL[meal]), h('span', { class: 'muted' }, c ? fmtKcal(c) : '')),
      (c?.registros ?? []).map((r) => h('div', { class: 'registro', 'data-id': r.id },
        h('ul', { class: 'lines' }, r.lines.map((l) => h('li', { class: 'line' },
          h('span', { class: 'line-name' }, l.nombre), h('span', { class: 'sep' }, ' · '),
          h('span', { class: 'line-grams' }, `${nf1.format(l.grams)} g`), h('span', { class: 'sep' }, ' · '),
          h('span', { class: l.kcal === null ? 'line-kcal sin-dato' : 'line-kcal' }, l.kcal === null ? 'sin dato' : `${nf0.format(l.kcal)} kcal`)))),
        h('div', { class: 'row between registro-actions' },
          h('span', { class: 'muted small' }, c.registros.length > 1 ? fmtKcal(r) : ''),
          h('span', { class: 'row wrap' },
            h('button', { class: 'link', onclick: () => editMeal(r.record) }, 'Editar'),
            deleteControls(r.id, state.day),
            h('details', { class: 'more-actions' }, h('summary', { 'aria-label': 'Más acciones de la comida' }, icon(doc, 'dots')),
              h('div', { class: 'more-list' },
                h('button', { class: 'link', onclick: () => openRepeat({ sourceDate: state.day, recordId: r.id, targetMeal: defaultMeal(now()), back: 'diary' }) }, 'Repetir esta comida'),
                h('button', { class: 'link', onclick: () => { state.templateForm = { recordId: r.id, nombre: '', error: '' }; render(); } }, 'Guardar como plantilla'),
                h('button', { class: 'link', onclick: () => rec.openForm({ lines: r.record.lines, back: 'diary' }) }, 'Guardar como receta'))))),
        state.templateForm?.recordId === r.id ? templateForm(r.record) : null)),
      meal === 'cena' ? h('button', { type: 'button', class: 'link que-ceno', onclick: () => cenas.open(state.day) }, icon(doc, 'spark'), h('span', {}, '¿Qué ceno?')) : null);
    return h('main', { class: 'diario' },
      dayHeader(),
      state.diaryMsg ? h('p', { class: 'ok', role: 'status' }, state.diaryMsg) : null,
      state.catUpdate && !state.catUpdate.ignorado ? h('section', { class: 'panel aviso-catalogo', 'aria-label': 'Documento nuevo' },
        h('p', {}, `Hay una versión nueva de tu documento de alimentos: ${state.catUpdate.plan.nuevos.length} nuevos, ${state.catUpdate.plan.actualizados.length} actualizados${state.catUpdate.plan.conflictos.length ? `, ${state.catUpdate.plan.conflictos.length} con conflicto` : ''}.`),
        h('div', { class: 'row' },
          h('button', { class: 'secondary', onclick: () => { state.catBack = 'diary'; state.screen = 'catalogo'; render(); } }, 'Revisar'),
          h('button', { class: 'link', onclick: () => postponeCatalogUpdate() }, 'Ahora no'))) : null,
      state.foods.length === 0 ? h('p', { class: 'warn' }, 'No hay documento de alimentos. Impórtalo en Documento.') : null,
      state.dayMeals.length === 0 ? h('p', { class: 'muted' }, 'Sin registros este día.') : [
        rep.avisosUl.length ? h('section', { class: 'alert-ul alert-strip', role: 'alert' },
          h('button', { type: 'button', class: 'strip-btn', onclick: () => { state.screen = 'informe'; render(); } },
            h('span', {}, '⚠ Máximo tolerable (UL) superado: ', rep.avisosUl.map((r) => r.label).join(', ')), icon(doc, 'chevron'))) : null,
        h('section', { class: 'panel resumen' },
          h('h2', { class: 'caps' }, 'Resumen de energía'),
          energySummary({ h, nf0 }, rep),
          rep.sinDatos.length ? h('p', { class: 'warn small', role: 'alert' }, `Sin datos nutricionales: ${rep.sinDatos.join(', ')}. Los totales de este día no incluyen su aporte y no son completos.`) : null,
          parcialesDiario({ h }, avisoParciales(state.dayMeals, byId(), rep.rows)),
          h('ul', { class: 'nuts' }, macros.map(nutrientRow)))],
      ordinarias.map((m) => mealCard(rep.comidas.find((c) => c.meal === m), m)),
      rep.comidas.find((c) => c.meal === 'otro') ? mealCard(rep.comidas.find((c) => c.meal === 'otro'), 'otro') : null);
  }

  function informeScreen() {
    const obj = targetsFor(state.day);
    const rep = diaryReport(state.dayMeals, byId(), obj.list, deps.catalog);
    return reportScreen({ h, state, deps, rep, parciales: avisoParciales(state.dayMeals, byId(), rep.rows), MACROS, MEAL_LABEL, nf0, fmtQty, fmtKcal, nutrientRow, dayLabel: (d) => (d === today() ? `Hoy · ${shortDate(d)}` : d === shiftDate(today(), -1) ? `Ayer · ${shortDate(d)}` : shortDate(d)), header,
      objetivosTexto: obj.periodo ? `Objetivos: ${obj.periodo.nombre}${obj.tipoDia ? ` · ${obj.tipoDia.nombre}` : ''}${obj.excepcion ? ' · excepción del día' : ''}` : 'Objetivos: referencias EFSA',
      back: () => { state.screen = 'diary'; render(); } });
  }

  // Formulario en línea del Diario para guardar una comida como plantilla.
  function templateForm(rec) {
    const f = state.templateForm;
    const input = h('input', { type: 'text', 'aria-label': 'Nombre de la plantilla', placeholder: `Por ejemplo: ${MEAL_LABEL[rec.meal]} habitual`, value: f.nombre, maxlength: '60' });
    queueMicrotask(() => { try { input.focus(); } catch { /* sin foco */ } });
    return h('div', { class: 'template-form' },
      h('label', {}, 'Nombre de la plantilla', input),
      f.error ? h('p', { class: 'error small', role: 'alert' }, f.error) : null,
      h('div', { class: 'row' },
        h('button', { class: 'secondary', onclick: () => saveTemplate(rec, input.value) }, 'Guardar plantilla'),
        h('button', { class: 'link', onclick: () => { state.templateForm = null; render(); } }, 'Cancelar')));
  }

  // «Estimar con IA» y recetas: acciones en sus módulos (ui/estimate-screen.js, ui/recetas-screen.js).
  const ctx = { state, deps, track, render, byId, persistFoods, now, saveFile, openDay };
  const rec = recetasActions(ctx);
  const est = estimateActions({ ...ctx, guardarReceta: rec.guardarReceta });
  const cenas = cenasActions({ ...ctx, targetsFor, today, loadTemplates, recetasTodas: () => rec.todas(), buscarActualizacion: (o) => checkCatalogUpdate({ manual: true, ...o }) });
  const labels = new Map(deps.catalog.keys.map((k) => [k, deps.catalog.byKey.get(k)?.label ?? k]));

  // ---------- render ----------
  function render() {
    const repeat = () => repeatScreen({
      h, state, byId, header, fmtTotal, nf0, nf1, MEAL_LABEL, dayLabel, today, shiftDate, openRepeat, saveRepeat,
      back: () => {
        const r = state.repeat;
        state.repeat = null;
        if (state.repeatBack === 'diary') openDay(r.sourceDate);
        else if (state.repeatBack === 'diaryTarget') openDay(r.targetDate);
        else if (state.repeatBack === 'plantillas') openTemplates();
        else { state.screen = 'home'; render(); }
      },
    });
    const catalogo = () => catalogUpdateScreen({
      h, state, header, render, applyCatalogUpdate, postponeCatalogUpdate,
      back: () => { state.screen = state.catBack; render(); },
    });
    const registro = () => phraseLogScreen({
      h, state, byId, header, MOTIVO_TEXT, render, removeLogEntry, clearLog, exportLog,
      back: () => openDoc('', 'pulir'),
    });
    const plantillas = () => templatesScreen({
      h, state, byId, header, nf0, nf1, MEAL_LABEL, render, useTemplate, deleteTemplate,
      back: () => { state.pendingDelete = null; state.screen = state.plantillasBack; render(); },
    });
    const objetivos = () => objetivosScreen({
      h, state, store: deps.store, targets, catalog: deps.catalog, track, render, header, today, saveFile, readFile, MACROS, UNIT_LABEL, fmtNum, fmtQty,
      back: () => { state.screen = 'mas'; render(); },
    });
    const estimar = () => estimateScreen({ h, state, byId, header, openPicker, render, thr, est, back: () => { state.estimate = null; state.screen = 'confirm'; render(); } });
    const recetas = () => recetasScreen({ h, state, byId, header, openPicker, render, openDay, nf0, rec, keys: deps.catalog.keys, required: req, labels, back: () => (state.recetasBack === 'pulir' ? openDoc('', 'pulir') : openAlimentos()) });
    const openRecetas = () => { state.recetasBack = 'alimentos'; return rec.open(); };
    const alimentos = () => alimentosScreen({
      h, doc, state, incompleteInfo, openCatalog: openCatalogList, openRecetas, openTemplates: () => openTemplates('', 'alimentos'),
      nRecetas: state.recetas.length, nPlantillas: state.plantillas.length,
      openIncompletos: () => { state.catFilter = 'incompletos'; openCatalogList(); },
      reviewUpdate: () => { state.catBack = 'alimentos'; state.screen = 'catalogo'; render(); }, postponeUpdate: () => postponeCatalogUpdate(),
      pendientes: pendientesView({ h, state, est }),
    });
    const micatalogo = () => catalogoListScreen({ h, doc, state, incompleteInfo, render, header, back: openAlimentos });
    const abrirSeccion = (section) => () => openDoc('', section);
    const mas = () => masScreen({
      h, doc, state, incompletos: state.foods.filter(incompleteInfo).length,
      items: [
        { icon: 'target', label: 'Objetivos', onclick: () => { state.screen = 'objetivos'; render(); } },
        { icon: 'file', label: 'Documento', onclick: abrirSeccion('documento') },
        { icon: 'shield', label: 'Copia de seguridad', onclick: abrirSeccion('copia') },
        { icon: 'link', label: 'Conexión con la IA', onclick: abrirSeccion('conexion') },
        { icon: 'edit', label: 'Pulir el documento', onclick: abrirSeccion('pulir') },
      ],
    });
    const cenasPantalla = () => cenasScreen({ h, state, byId, header, nf0, nf1, dayLabel: (d) => (d === today() ? `Hoy · ${shortDate(d)}` : d === shiftDate(today(), -1) ? `Ayer · ${shortDate(d)}` : shortDate(d)), actions: cenas, back: () => openDay(state.cenas.fecha) });
    const informe = informeScreen;
    const screens = { home: homeScreen, confirm: confirmScreen, doc: docScreen, diary: diaryScreen, informe, alimentos, micatalogo, mas, objetivos, repeat, plantillas, registro, catalogo, estimar, recetas, cenas: cenasPantalla };
    const screen = screens[state.screen]();
    if (state.fail) { // debajo de la cabecera fija, con el recuadro rojo de los avisos (alert-ul)
      const aviso = h('p', { class: 'error alert-ul alert-fail', role: 'alert' }, state.fail, ' ',
        h('button', { class: 'link', onclick: () => { state.fail = ''; render(); } }, 'Cerrar'));
      const cabecera = screen.querySelector(':scope > header');
      if (cabecera) cabecera.after(aviso); else screen.prepend(aviso);
    }
    const extras = [];
    if (!SIN_BARRA.includes(state.screen) && !llevaBarraPropia(screen)) extras.push(bottomNav({ h, doc, active: (state.screen === 'catalogo' && state.catBack === 'cenas' ? 'diary' : TAB_OF[state.screen]) ?? null, go }));
    if (state.menu && state.screen === 'diary') {
      extras.push(popMenu({ h, doc, close: () => { state.menu = false; render(); }, items: [
        { label: 'Ver informe diario', icon: 'file', onclick: () => { state.menu = false; state.screen = 'informe'; render(); } },
        { label: 'Copiar día anterior', icon: 'copy', onclick: () => { state.menu = false; openRepeat({ sourceDate: shiftDate(state.day, -1), targetDate: state.day, back: 'diaryTarget' }); } },
        { label: '¿Qué ceno?', icon: 'spark', onclick: () => { state.menu = false; cenas.open(state.day); } },
        ...(state.day !== today() ? [{ label: 'Ir a hoy', icon: 'diario', onclick: () => { state.menu = false; openDay(today()); } }] : []),
      ] }));
    }
    if (state.sheet && state.screen === 'diary') {
      const { meal, date } = state.sheet;
      const cierra = () => { state.sheet = null; render(); };
      extras.push(sheet({ h, doc, title: `Añadir a ${MEAL_LABEL[meal]}`, close: cierra, items: [
        { icon: 'mic', primary: true, label: 'Dictar comida', onclick: () => openAdd({ meal, date }) },
        { icon: 'hand', label: 'Añadir a mano', onclick: () => { state.sheet = null; state.meal = meal; state.addDate = date; startManual(); } },
        { icon: 'copy', label: 'Repetir de ayer', onclick: () => { state.sheet = null; openRepeat({ sourceDate: shiftDate(date, -1), targetDate: date, targetMeal: meal, back: 'diaryTarget' }); } },
        { icon: 'list', label: 'Plantillas', onclick: () => { state.sheet = null; openTemplates('', 'diary'); } },
      ] }));
    }
    root.replaceChildren(screen, ...extras);
  }
  openDay(today());
  track(loadPlan(), 'No se pudo cargar el plan de objetivos');
  checkCatalogUpdate();
  return { state, render, whenIdle };
}
