# ¿Qué ceno? — Especificación

Rama `cenas`. Lee antes `CLAUDE.md` (reglas 1-10 y las secciones «Estética» y «Navegación»), `docs/cenas/cenas-cronometer.md` y `.csv`. Decisiones de Victor (20-10-2026): se puede añadir `POST /cenas` al Worker (sin desplegar); a Gemini viajan también los **nombres** de los nutrientes con déficit (§8), lo que exige ampliar la regla 6 (propuesta en `docs/cenas/notas.md`, sin aplicarla a `CLAUDE.md`); 25 g por rebanada de pan de molde y 20 g por loncha de queso, como supuestos.

## 1. Qué es

Una pantalla que, para un día (hoy por defecto), mira lo que ya he registrado, lo compara con mis objetivos de ese día (`targetsForDate`) y me propone **3 cenas** sacadas de mis cenas habituales, con los gramos ajustados para cubrir lo que me falta (kcal, macros y micros), sin pasar ningún UL. Cada propuesta se añade con «Añadir a la cena», que abre la **confirmación editable de siempre** (regla 5). Funciona sin internet y sin gastar cuota; la IA solo entra con el botón «Más ideas».

Principios (no negociables):
- Los gramos y los nutrientes los calcula el código desde mi documento (`sumLines`, `nutrientsForGrams`, `evaluate`). La IA solo propone combinaciones de ids de mi catálogo; el código las valida, ajusta los gramos y calcula.
- Nunca se propone un alimento con `incluir=no`, sin datos (`foodSinDatos`) o que no esté en el documento.
- Determinista: con las mismas entradas, las mismas propuestas en el mismo orden (desempate por id).

## 2. Casos de uso

1. Por la noche, en el Diario de hoy, toco «¿Qué ceno?» en la tarjeta de Cena (o en los tres puntos): veo cuánto me falta del día y 3 cenas; toco «Añadir a la cena» en una, ajusto gramos en la confirmación y guardo.
2. En el Diario de otro día (pasado o futuro), «¿Qué ceno?» calcula sobre el día mostrado y la cena se guarda con esa fecha.
3. Ya me he pasado o me falta muy poco: la pantalla lo dice con claridad y propone algo ligero o nada.
4. Quiero otras ideas: «Más ideas» hace una llamada a la IA y añade hasta 3 propuestas más, marcadas «Idea de la IA», calculadas igual que las demás.

## 3. Ids de la semilla frente a `data/foods.csv` (comprobado el 20-10-2026)

Todos los `id_catalogo` de `cenas-cronometer.csv` existen en `data/foods.csv`. Equivalencias y filtros:

| id en el CSV | Situación | Qué se hace |
|---|---|---|
| `pan_integral` (19-sep «Barra de pan Dia» 50 g; 24-sep «Bread, french or vienna, whole wheat» 167 g) | Existe, pero la nota pide revisar: es pan de barra | Equivalente actual: **`pan_blanco_barra`** («pan» a secas = barra de pan blanco, CLAUDE.md §4) |
| `tortilla_patata`, `crema_calabacin` | Existen, `incluir=no` y sin datos | Se conservan en la semilla; el motor los filtra en ejecución (si un día tienen datos e `incluir=si`, vuelven solos) |
| `yogur_griego_vainilla`, `queso_monterey_jack` | Existen, `incluir=no` y sin datos | Igual: se filtran en ejecución |
| `tinto_verano`, `ron`, `coca_cola` (18-sep) | Salida, no es cena | No entran en la semilla |
| `semillas_chia` 81 %, `chocolate_negro_85` 87 %, `pan_molde_blanco` 84 %, `pimiento_amarillo` 87 %, `pasta_seca` 97 % | Completos (≥ 80 %) pero con huecos | Se proponen; la cobertura de esos nutrientes se marca «parcial» |

Conversión de cantidades a gramos para la semilla:
- `g` → tal cual (merluza 230 g y patata 74 g se toman como peso en crudo: el motor reescala de todos modos).
- `ml` de aceite → × `densidad_g_ml` (0,91): 10 ml = 9,1 g; 6 ml = 5,46 g. El 24-sep suma 17 g + 6 ml = 22,46 g de aceite.
- Porciones del catálogo: kiwi «1 each» = 69 g (`unidad`); zanahoria «1 medium» = 61 g (`unidad mediana`).
- Chocolate «1 Portion» = 10 g (nota del CSV).
- **Sin porción en el catálogo** (aceptados por Victor, marcados `"supuesto": true` en la semilla): pan de molde 3 rebanadas = 3 × 25 g = 75 g; queso tierno 1 loncha = 20 g.
- `tortilla_patata` «2 Serving» → `gramos: null` (sin datos: se filtra).

## 4. Ficheros

| Fichero | Contenido |
|---|---|
| `frontend/js/core/cenas.js` | Motor puro, sin DOM (§5-§7). |
| `frontend/js/core/cenas-validate.js` | Validación de la respuesta de «Más ideas», compartida Worker/app (como `estimate-validate.js`). |
| `data/cenas-semilla.json` | `{ version, cenas: [{ fecha, lineas: [{ food_id, gramos, supuesto? }] }], roles: { food_id: rol } }`, generado a mano desde el CSV con las equivalencias de §3. |
| `frontend/js/ui/cenas-screen.js` + `frontend/css/cenas.css` | Pantalla (§9). CSS enlazado en `index.html` y en la caché del service worker (subir `VERSION`). |
| `worker/src/prompt.js`, `worker/src/index.js`, `frontend/js/ai-client.js`, `scripts/dev-server.mjs` | Ruta `POST /cenas` y `ideasCena()` (§8); el servidor local la atiende con el mismo código del Worker, como `/estimate`. Sin desplegar. |
| `tests/cenas.test.js`, `tests/cenas-ui.test.js`, tests del Worker | Tests de §11. |
| `docs/cenas/notas.md` | Propuesta de cambios a `CLAUDE.md` (regla 6, «¿Qué ceno?» en Arquitectura y Estado), sin aplicarlos. |

`dev-server.mjs` solo sirve `frontend/` y `data/`: por eso la semilla va en `data/`, no se lee `docs/`.

### Roles
Cada alimento que puede ir en una cena tiene un rol en `roles` de la semilla: `proteina` (merluza, salmón, atún, sardina, huevo, pavo en lonchas, pechuga de pollo y de pavo, solomillo), `hidrato` (arroz, pasta, pan de barra, pan de molde, patata), `verdura` (calabacín, berenjena, cebolla, pimientos, pepino, zanahoria, judías verdes, brócoli, champiñón, verduras asadas y parrillada Hacendado), `plato` (recetas: lentejas caseras; cuenta como proteína + hidrato + verdura), `grasa` (aceite), `salsa` (tomate frito), `postre_base` (yogur griego natural), `postre_extra` (chía, chocolate 85 %, nueces), `fruta` (kiwi, manzana, pera…), `otro` (queso en lonchas y cualquier alimento sin rol). Un alimento del historial sin rol entra como `otro` (fijo, no se escala).

## 5. Entradas del motor

`proponerCenas({ fecha, comidasDelDia, historial, plantillas, recetas, semilla, foodsById, objetivos, catalog, ideasIA? })`
- `comidasDelDia`: registros de `fecha` (todas las comidas, **incluida una cena ya registrada**: cuenta como consumido y se avisa).
- `historial`: registros con `meal = 'cena'` de los 60 días anteriores a `fecha`.
- `objetivos`: `targetsForDate(fecha, …)` (con plan o con las referencias de `targets.json` si no hay plan).
- Devuelve `{ estado, resumen, faltan, avisos, propuestas: [≤3], descartados }` (§7).

Consumido = `dayTotals(comidasDelDia)`. Para cada nutriente con objetivo:
- **Meta** (lo que quiero alcanzar): `objetivo`; si es rango sin objetivo, `(min+max)/2`; si solo hay `min`, `min`; si solo hay `max`, no hay meta (solo tope).
- **Déficit** `d = max(0, meta − consumido)`.
- **Tope blando**: `max`; si hay objetivo sin max, `objetivo × 1,1` (como `RANGO_OBJETIVO` del Diario).
- **Tope duro**: `ul`.
- EPA + DHA (`suma`) se combina como en el Diario.

Kcal restantes `R = meta_kcal − consumido_kcal`.

## 6. Algoritmo

### 6.1 Modo según R
- `R ≥ 400` → **normal**.
- `150 ≤ R < 400` → **ligero**: candidatos de §6.6.
- `R < 150` (incluye pasarse) → **cubierto**: sin propuestas normales; mensaje honesto («Ya llevas X kcal de Y: te faltan solo Z» o «Te has pasado Z kcal»). Si `R > 0`, hasta 3 opciones «muy ligeras» ≤ `R` (yogur griego, fruta habitual, verdura cruda habitual); si `R ≤ 0`, la recomendación es no cenar y, como mucho, una verdura cruda habitual ≤ 50 kcal, marcada «por encima de tu objetivo».

### 6.2 Candidatos (normal)
1. **Historial real**: cada fecha con cena del `historial` (los registros de cena del mismo día se juntan) es un candidato. Si se repite el mismo conjunto de alimentos, se queda el más reciente y se cuenta cuántas veces (`veces`).
2. **Plantillas** con `meal = 'cena'`.
3. **Semilla** (`data/cenas-semilla.json`): solo mientras el historial tenga **menos de 21 días distintos con cena** (constante `DIAS_PARA_HISTORIAL = 21`). Desde 21, la semilla no se usa.
4. **Recetas**: cada alimento receta con datos e `incluir=si` (rol `plato`) + el postre habitual; gramos base: la mediana de lo registrado o, si nunca se registró, `RACION_RECETA_G = 300`.
5. **Variantes**: por cada candidato de 1-3, una sustitución de un solo componente (`proteina`, `hidrato` o `verdura`) por otro alimento **habitual** del mismo rol (que aparezca en historial, plantillas o semilla), con sus gramos habituales (mediana). Se etiquetan «Tu cena del 22-sep con huevo en vez de salmón».

Limpieza de cada candidato, en este orden:
- Se quitan las líneas con `incluir=no`, sin datos, fuera del documento o con `gramos: null` (y se anota en `descartados` con el motivo, para mostrarlo una vez: «No propongo tortilla de patata ni crema de calabacín: no tienen datos»).
- Un candidato sin `proteina` ni `plato` se descarta.
- Si le falta `verdura` (o `hidrato`), se completa con la más habitual de ese rol, marcada «añadida para completar».
- Si no tiene `postre_base`, se añade el postre habitual: yogur griego natural 125 g + chía (mediana habitual, 3 g si no hay).

### 6.3 Escalado de gramos
- Escalables: `proteina` (factor `fp`), `hidrato` y `plato` (factor `fh`). Fijos: `verdura` (al menos sus gramos habituales), `grasa`, `salsa`, `postre_*`, `fruta`, `otro`.
- Meta de la cena `E* = min(R, kcal del candidato con fp = fh = 1,5)`.
- Si queda déficit de proteína `P* > 0`: se resuelven `fp` y `fh` para acercarse a la vez a `E*` y a `P*` (mínimos cuadrados con dos incógnitas, kcal con peso doble); si no, `fp = 1` y `fh` se despeja para `E*`.
- Cada factor se limita a `[0,6 ; 1,5]` de los gramos base; si uno se topa, se vuelve a despejar el otro para las kcal.
- Redondeo: proteína, hidrato y plato a 5 g; el resto a 1 g. **Después de redondear se recalcula todo con `sumLines`**: lo que se muestra es siempre el cálculo sobre los gramos finales.
- Extras de postre (chocolate 10 g, nueces 10 g, fruta habitual con sus gramos habituales): se prueban de uno en uno, en orden fijo, y se añaden si suben la puntuación y la cena sigue dentro de kcal.
- **Límite de kcal**: una propuesta nunca pasa de `R + max(50, 5 % de R)`; si no se puede bajar a eso con los factores mínimos, se descarta. Si se queda por debajo de `E* − 10 %` por los topes, se avisa en la tarjeta («se queda en X kcal»).

### 6.4 Puntuación
Para cada nutriente `n` con déficit `d_n > 0`: cobertura `c_n = min(1, aporte_n / d_n)` (el aporte solo cuenta líneas con dato; si falta alguna, `n` es «parcial»).
- `S_kcal = max(0, 1 − |K − E*| / E*)`.
- `S_macros` = media de `c_n` de proteína y fibra, y de hidratos y grasa si tienen déficit.
- `S_micros` = media de `c_n` de los micronutrientes de `objetivos` con déficit (1 si no hay ninguno).
- `S_hab`: candidato real o plantilla `min(1, veces/3)`; receta 1; semilla 0,5; variante la mitad de su origen.
- `Pen` = suma, por nutriente con tope blando, de cuánto lo hace pasar la cena: `max(0, (después − max(tope, antes)) / tope)`, cada uno como mucho 1. (Si ya estaba pasado antes de cenar, solo cuenta lo que añade la cena.)
- **Puntuación** `= 0,25·S_kcal + 0,30·S_macros + 0,35·S_micros + 0,10·S_hab − 0,5·Pen`.
- **UL (duro)**: se descarta una propuesta que haga superar un UL que antes de cenar no se superaba. Si el UL ya se había superado, la propuesta no se descarta, se penaliza como un tope blando y se avisa arriba.

### 6.5 Elección de las 3
Orden por puntuación (desempate por la lista de ids ordenada). Se toman en orden, saltando una propuesta si su proteína principal (o su `plato`) ya está en una elegida, mientras queden otras; si no hay 3 distintas, se completa con las siguientes. Como máximo una variante por cada cena de origen.

### 6.6 Modo ligero (150 ≤ R < 400)
Candidatos: `proteina` habitual + `verdura` habitual (+ aceite, como mucho 5 g), y el postre habitual con o sin fruta. Mismo escalado con `E* = R` y el factor mínimo bajado a 0,3; sin completar hidrato ni postre. Mismo límite de kcal, puntuación y UL.

## 7. Salida y textos

`resumen`: kcal consumidas, meta, `R`; proteína, hidratos y grasa que faltan; los 5 micros con más % por cubrir.
`avisos` (cada uno con su código, para los tests):
- `dia_vacio`: «No has registrado nada hoy: la propuesta cubre solo la cena (como mucho X kcal), no el día entero.»
- `sin_plan`: «Sin plan de objetivos: uso las referencias EFSA.»
- `cena_registrada`: «Ya tienes una cena registrada (X kcal): esto propone qué añadir.»
- `consumido_parcial`: «Lo que llevas hoy no es completo: X no tiene datos; puede que te falte menos.»
- `ul_superado`: «Ya has superado el UL de X hoy.»
- `semilla`: «Aún tienes N días con cena en la app: uso también tus cenas de Cronometer.»
- `sin_candidatos`: «No tengo cenas habituales con tu documento actual: registra alguna cena o guarda una plantilla de cena.»

Cada propuesta: `{ origen (texto), lineas: [{ food_id, nombre, gramos, rol, añadida? }], kcal, proteina, hidratos, grasa (de sumLines), completa: [nutrientes que pasan a cumplido], mitad: [c ≥ 0,5 sin llegar], siguenFaltando: [top 3], parciales: [nutrientes con aporte parcial], incompletos: [alimentos < 80 %], puntuacion, ia: bool }`.

## 8. Capa de IA («Más ideas») — aprobada por Victor

- Botón «Más ideas» en la pantalla. **Una llamada por pulsación** (con los reintentos que ya marca la regla 10 dentro del Worker) y el botón queda desactivado hasta volver a abrir la pantalla. Nunca se llama sola.
- Ruta nueva `POST /cenas` en el Worker, mismo token, CORS y códigos de error (`limite_de_uso`, `google_caido`, `modelo_no_disponible`, `clave_ia`, `error_worker`), con el mismo reintento ante JSON inválido y la misma política de 5xx/respaldo que `/parse` y `/estimate`. Prompt y esquema en `worker/src/prompt.js` (`CENAS_SYSTEM_PROMPT`, `CENAS_SCHEMA`, `buildCenasPrompt`). Cliente: `ideasCena({ alimentos, deficits })` en `ai-client.js`. Lo que vaya a `npm run worker:logs`, sin claves.
- **Qué viaja**: `{ alimentos, deficits }`.
  - `alimentos`: la lista compacta del catálogo (`buildCompactList`, sin `incluir=no`), quitando además los alimentos sin datos.
  - `deficits`: **solo los nombres** (la etiqueta de `data/nutrients.json`, p. ej. `["Fibra", "Magnesio", "Proteína"]`) de los nutrientes con déficit del día, como mucho 8, ordenados por % por cubrir. Nunca cantidades, %, objetivos, nutrientes por alimento ni el diario. El Worker valida que `deficits` sea una lista de cadenas cortas (≤ 40 caracteres, ≤ 8) y rechaza números dentro (`/\d/`).
  - **No viajan** nutrientes por alimento, densidad, cantidades consumidas, objetivos, fechas ni cenas del diario.
- Instrucción del prompt: «propón 5 cenas españolas típicas de proteína + hidrato + verdura (+ postre de yogur griego) usando solo ids del catálogo, con gramos típicos en crudo; da preferencia a alimentos ricos en estos nutrientes: …». La IA no calcula nada: el código decide con los valores de mi documento.
- Respuesta: `{ cenas: [{ nombre, lineas: [{ id, gramos }] }] }` (máximo 5 cenas, 8 líneas cada una). `cenas-validate.js` descarta ids que no estén en la lista enviada, gramos ≤ 0 o > `MAX_GRAMS`, y cenas sin proteína. Las válidas entran al motor como candidatos (`ideasIA`) con `S_hab = 0`, mismo escalado, puntuación y UL; se muestran hasta 3 más, con la etiqueta «Idea de la IA».
- Errores: el mensaje propio de cada código (los de `ai-client.js`), las propuestas deterministas siguen en pantalla.

## 9. Pantalla y punto de entrada

La app ya no tiene Inicio: abre en el Diario, con la barra inferior **Diario · Alimentos · [+] · Más** (`ui/nav.js`, `css/navegacion.css`; ver «Navegación» en `CLAUDE.md`).

- **Dos entradas, las dos para el día que muestra el Diario (`state.day`)**:
  1. **Tarjeta de Cena del Diario** (`mealCard` con `data-meal="cena"`): un botón visible «¿Qué ceno?» (clase `link`, icono `spark` de `nav.js`, zona táctil ≥ 44 px) dentro de la tarjeta, bajo sus líneas (o bajo la cabecera si la cena está vacía). Solo en la tarjeta de Cena.
  2. **Tres puntos del Diario** (`popMenu`): entrada «¿Qué ceno?» (icono `spark`) tras «Ver informe diario» y «Copiar día anterior».
- `state.screen = 'cenas'`, pestaña activa Diario (`TAB_OF.cenas = 'diary'`); lleva la barra inferior (no va en `SIN_BARRA`) porque «Añadir a la cena» está en cada tarjeta, no en una barra propia. «‹ Volver» (cabecera con `header(title, back)`) vuelve al Diario del mismo día. `app.js` solo registra la pantalla, las dos entradas y las acciones (abrir, «Añadir a la cena», «Más ideas»); la pantalla en `ui/cenas-screen.js` solo pinta, como las demás.
- Contenido: cabecera «¿Qué ceno?» y el día (`dayLabel`); bloque «Te falta» en un `panel` (kcal y macros con los colores fijos de macro, y los micros principales); avisos (§7); 3 tarjetas `card meal` con `meal-head` (origen y kcal), `lines` (`line-name`, `line-grams`, `line-kcal`, `sep` « · » oculto en el DOM), kcal y macros, «Completa: …», «Cubre la mitad de: …», «Sigue faltando: …», avisos de parcial e incompleto, y «Añadir a la cena» (botón `primary`). Debajo, «Más ideas» (`secondary`) y, si hay, las ideas de la IA con la etiqueta «Idea de la IA».
- «Añadir a la cena» → borrador nuevo (`draftFromLines` o equivalente en `draft.js`, sin `editing`) con `meal = 'cena'`, `date = día`, líneas con `confidence 'manual'` y `source_text = '¿Qué ceno?: <origen>'`, `text = '¿Qué ceno?'`; abre la confirmación de siempre (`confirmScreen`, sin barra inferior). **No se guarda nada hasta «Guardar».** Al guardar, al Diario del día en que queda (como siempre).
- Estética (CLAUDE.md §3, «Estética» y «Navegación»): mismo estilo que las demás pantallas: paleta de `:root` (incluidos `--link`, `--soft`, `--fab`), componentes y clases existentes (`card`, `panel`, `card meal` + `meal-head`, `lines`, `alert-ul`, `menu-*` si hace falta), estilos propios solo en `css/cenas.css` (después de `navegacion.css` en `index.html`, y en `ASSETS` del service worker con `VERSION` subido). Nunca colores sueltos; zonas táctiles ≥ 44 px; sin scroll horizontal a 375 px; el contenido no queda tapado por la barra inferior ni por la cabecera fija; claro y oscuro.

## 10. Casos límite

| Caso | Comportamiento |
|---|---|
| Día vacío | Modo normal con `E*` limitado por los factores (≤ 1,5 × la cena habitual) y aviso `dia_vacio`. |
| Sin historial en la app | Semilla + plantillas + recetas; aviso `semilla`. |
| ≥ 21 días con cena | Solo historial, plantillas, recetas (y sus variantes); sin aviso `semilla`. |
| Sin plan de objetivos | `targetsForDate` con referencias; aviso `sin_plan`. |
| Alimento sin datos / `incluir=no` / borrado | Fuera del candidato; motivo en `descartados`. |
| Alimento incompleto (< 80 %) | Se propone; aviso «pendiente de completar» en la tarjeta. |
| Lo consumido tiene alimentos sin datos | Aviso `consumido_parcial`. |
| Ya hay cena registrada | Cuenta como consumido; aviso `cena_registrada`. |
| UL ya superado | Aviso `ul_superado`; no descarta por ese UL, penaliza. |
| Ningún candidato válido | `estado = 'sin_candidatos'`, sin tarjetas, «Más ideas» disponible. |
| R < 150 / R ≤ 0 | §6.1, modo cubierto. |
| Sin conexión | Todo funciona salvo «Más ideas» (mensaje de sin conexión). |

## 11. Criterios de aceptación

1. `core/cenas.js` es puro (sin DOM ni `fetch`) y está cubierto por `tests/cenas.test.js`.
2. Determinismo: dos llamadas con las mismas entradas devuelven propuestas idénticas.
3. Para cada propuesta, kcal, proteína, hidratos y grasa son exactamente `sumLines` de sus líneas con los valores de `data/foods.csv` (test que lo recalcula).
4. Con la semilla y el catálogo real, ninguna propuesta contiene `tortilla_patata`, `crema_calabacin`, `yogur_griego_vainilla`, `queso_monterey_jack`, `pan_integral` (equivalencia), ni ningún alimento `incluir=no` o sin datos; `descartados` los nombra.
5. Ninguna propuesta hace superar un UL no superado antes (test con un día cerca del UL de un micro que aporte una cena habitual).
6. Con `R ≥ 400`, kcal de cada propuesta ≤ `R + max(50, 5 % R)`; con un día típico (desayuno + comida + merienda ≈ 1.400 kcal y meta 2.400), las 3 están a ±10 % de `R`.
7. Con < 21 días de cena en el historial se usa la semilla (aviso `semilla`); con ≥ 21, no (test con historial sintético).
8. Plantillas de cena y recetas con datos aparecen como candidatos (test).
9. Cada propuesta normal lleva yogur griego natural; los gramos de proteína e hidrato están entre 0,6 y 1,5 × los base y redondeados a 5 g.
10. Hasta 3 propuestas; si hay al menos 3 proteínas habituales distintas, las 3 tienen proteína principal distinta.
11. `R` entre 150 y 400 → modo ligero, todas ≤ límite de kcal; `R < 150` y `R ≤ 0` → mensaje honesto y nada de cenas normales (tests).
12. Avisos `dia_vacio`, `sin_plan`, `cena_registrada`, `consumido_parcial`, `ul_superado`, `semilla` y `sin_candidatos` aparecen exactamente en su caso (tests).
13. UI (jsdom): el botón «¿Qué ceno?» de la tarjeta de Cena y la entrada de los tres puntos abren la pantalla para el día mostrado en el Diario (probado con un día distinto de hoy); ninguna otra tarjeta de comida tiene el botón; no queda ninguna referencia a Inicio (`home`) en el código nuevo; «‹ Volver» lleva al Diario de ese día; la barra inferior se ve con Diario activo. «Añadir a la cena» abre la confirmación con `meal = 'cena'`, la fecha del día y los gramos de la propuesta, **sin guardar** hasta «Guardar»; al guardar, el registro está en el diario de ese día.
14. «Más ideas»: una sola llamada al cliente por pulsación, botón desactivado después; el cuerpo enviado tiene **solo** `alimentos` (lista compacta, sin nutrientes, sin `incluir=no` ni sin datos) y `deficits` (≤ 8 nombres, sin ningún dígito); el Worker rechaza `deficits` con números o demasiado largos; un 429 muestra el mensaje de siempre y conserva las propuestas; respuesta con ids inventados o gramos inválidos → descartados. Tests del Worker y del servidor local con el modelo simulado; ninguna llamada real en los tests.
15. `cenas.css` enlazado en `index.html` tras `navegacion.css` y en la caché del service worker, `VERSION` subido; capturas a 375 px en claro y oscuro (Diario con la tarjeta de Cena, menú de los tres puntos y la pantalla «¿Qué ceno?») sin scroll horizontal, sin colores sueltos y sin contenido tapado por la barra inferior.
16. `npm test` en verde (410 tests previos + los nuevos), en Windows.
17. `docs/cenas/notas.md` contiene la propuesta de nueva regla 6 con la redacción de Victor y el resto de cambios propuestos a `CLAUDE.md`, sin aplicarlos.
