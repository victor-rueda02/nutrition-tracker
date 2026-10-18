# Notas de la rama `objetivos`

Plan de objetivos detallado: periodos, tipos de día, excepciones por fecha y referencia EFSA para lo demás. El
formato, con un ejemplo completo y el orden de prioridad, está en `docs/OBJETIVOS-FORMATO.md`.

## Decisiones (aprobadas por Victor el 18-10-2026)

- **Tipos de día** en vez de variaciones sueltas por día de la semana: cada periodo define sus tipos (`entreno`,
  `descanso`…) y `semana` asigna uno a cada día. Una excepción puede cambiar el tipo de una fecha.
- **Prioridad por nutriente**: excepción de la fecha > tipo del día > valores del periodo vigente > referencia EFSA
  de `data/targets.json`. **La entrada de un nutriente se sustituye entera** (no se mezclan límites de capas). `null`
  quita el objetivo.
- **Periodo vigente**: de los que cubren el día, el que empezó más tarde (permite anidar y sustituir sin cerrar).
- **Límites** `min`, `objetivo` y `max`, combinables; **unidades** `kcal/kg`, `g/kg` (con `peso_kg`) y `%kcal` (de
  las kcal resueltas ese día).
- **UL**: siempre de `targets.json`; el plan no los cambia.
- **Editar desde la app**: «desde hoy» por defecto (el periodo termina ayer y sigue un tramo nuevo, así los días
  pasados no cambian); «a todo el periodo» como alternativa.
- **«Hoy es: Entreno / Descanso»**: escribe una excepción con solo `fecha` y `tipo`; «Según la semana» la quita.
- **Importar sustituye** el plan del dispositivo (no se fusiona) tras enseñar el resumen, los errores y los avisos.
  Con algún error no se importa nada.
- **Histórico**: el Diario llama a `targetsForDate(día mostrado)`; cada día se evalúa con su plan.
- **«Crear plan»** (sin plan o sin periodos): un periodo «Mis objetivos» abierto desde hoy, con el perfil elegido y la
  referencia de `targets.json` escrita entera (B1, niacina y ALA ya calculados con 2000 kcal), y los tipos de la semana
  de Victor (`TIPOS_SEMANA`): `fuerza` lun-vie, `rh_movilidad` sábado, `descanso` domingo. Cada tipo trae energía,
  proteína, hidratos y grasa de referencia (lo que cambia entre tipos); los micros solo en el periodo, para que
  cambiarlos en el periodo valga para todos los días.
- **Redondeo**: solo lo convertido (g/kg, kcal/kg, %kcal); lo escrito en la unidad de la columna se usa tal cual.

## Qué hay

- `frontend/js/core/targets-plan.js`:
  - `parsePlan` y `validatePlan`: errores con su sitio, todos a la vez; avisos de campos desconocidos (se conservan)
    y de solapes.
  - `targetsForDate(fecha, { plan, targets, catalog })`, `periodoVigente` y `dayContext`.
  - Edición: `editPeriod`, `setDayType` y `setPerfil`.
  - `planFromLegacy`, para migrar los objetivos de la pantalla anterior.
- `frontend/js/core/diary.js`: `evaluate` acepta `min`, `objetivo` y `max` a la vez, con los mismos nombres de estado,
  así que el CSS de las barras no cambia. En un rango sin objetivo, el % es sobre el máximo.
- `frontend/js/ui/objetivos-screen.js` (+ `css/objetivos.css`):
  - «Hoy»: periodo, tipo, peso y cada objetivo con su origen.
  - «Kcal y macros»: energía, proteína, hidratos y grasa, con unidad, mínimo, objetivo y máximo, y el peso.
  - «Plan»: los periodos, el perfil EFSA, importar y exportar.
- Diario: línea «Objetivos: Volumen otoño 2026 · Entreno», y los rangos se muestran como «/ 86,1–121 g».
- Copia de seguridad:
  - Lleva `plan_objetivos`.
  - Una copia antigua (`objetivos`) se convierte en plan.
  - Se restaura solo si el dispositivo no tiene plan.
  - Un plan no válido en la copia se avisa y no se restaura.
- Migración al arrancar: si no hay `plan_objetivos` y había objetivos de la pantalla anterior, se crea un plan con un
  periodo «Mis objetivos» abierto desde la primera fecha del diario. Los totales no cambian; hay un test que compara
  el resultado con `resolveTargets`. El ajuste antiguo `objetivos` no se borra.

## Propuesta de cambios en CLAUDE.md

En la sección 3, en `data/`, cambiar `targets.json` (hito 4) por:

> `targets.json` (referencias EFSA/UE y UL: lo que no define tu plan de objetivos)

Añadir en la sección 3, después de «Diario y documento importado: IndexedDB en el iPhone.»:

> - **Plan de objetivos** (formato en `docs/OBJETIVOS-FORMATO.md`): documento JSON mío, importado y exportado desde
>   Objetivos y guardado en el ajuste `plan_objetivos`; va en la copia de seguridad. Periodos (inicio y fin opcional;
>   manda el que empezó más tarde), tipos de día por periodo asignados con `semana`, excepciones por fecha; por
>   nutriente `min`/`objetivo`/`max`, con `g/kg`, `kcal/kg` o `%kcal`. Prioridad: excepción > tipo del día > periodo >
>   referencia de `targets.json`; la entrada de un nutriente se sustituye entera. Los UL siempre de `targets.json`.
>   Lógica en `core/targets-plan.js`, `targetsForDate(fecha)`; el Diario la llama con el día mostrado (histórico).
>   Editar desde la app: «desde hoy» por defecto (tramo nuevo; los días pasados no cambian).

En la sección 5, sustituir la frase «Los objetivos de kcal y macros son secundarios: no invertir más ahí por ahora.»
por:

> **Plan de objetivos** (rama `objetivos`): periodos, tipos de día (entreno/descanso), excepciones por fecha, rangos y
> g/kg o % de kcal; cada día del Diario con los objetivos de ese día. Ver «Plan de objetivos» en la sección 3.

Actualizar el número de tests (ahora 329).

## Para el coordinador (integración con `ia-recetas`)

Ficheros compartidos y qué cambia en cada uno, para resolver conflictos:

- `frontend/js/ui/app.js`. La pantalla salió en un commit aparte (`9f37ff8`, sin cambios de comportamiento). Después:
  - imports: `targets-plan.js`, y fuera `resolveTargets`;
  - tres líneas tras `const targets = …` (`state.plan`, `targetsFor`);
  - `loadPlan` y `planDeCopia` al principio de «acciones»;
  - una línea en `exportDiary`, tres en `onBackupFile` y `applyBackup` y una en `backupView`;
  - en `diaryScreen`, `obj` y la línea `.objetivos-dia`; una línea en `nutrientRow`;
  - la llamada a `objetivosScreen` en `render`;
  - `track(loadPlan(), …)` al final.
- `frontend/sw.js`: tres ficheros nuevos en `ASSETS` (`css/objetivos.css`, `js/core/targets-plan.js`,
  `js/ui/objetivos-screen.js`) y `VERSION` en `nt-v9`. Si `ia-recetas` también la sube, deja la mayor + 1.
- `frontend/index.html`: una línea con `css/objetivos.css`.
- `frontend/js/core/backup.js`: `buildBackup` acepta `plan` y escribe `plan_objetivos`; `parseBackup` devuelve `plan`.
- `tests/ui.test.js`: solo se reescribieron los dos tests de objetivos (la pantalla y restaurar objetivos de una
  copia). Los nuevos de la pantalla están en `tests/objetivos-ui.test.js`.
- `frontend/js/main.js`: sin cambios; el plan lo carga la propia app desde el almacén.

## Pendiente o para más adelante

- `resolveTargets` y `referenceValue` (`core/targets.js`) ya no los usa la interfaz. Se conservan porque los tests de
  `targets.json` los usan y sirven de comprobación de la migración. Se pueden retirar más adelante.
- `state.objetivos` (en `app.js`) solo queda como entrada de la migración.
- Editar desde la app solo kcal, macros y peso. Los micronutrientes, los periodos nuevos, los tipos y la semana se
  editan en el JSON (exportar → editar → importar).
- No se ha probado en el iPhone. Conviene mirar la pantalla a 375 px: la fila mínimo/objetivo/máximo y el selector de
  unidad.
