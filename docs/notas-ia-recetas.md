# Notas de la rama `ia-recetas`: «Estimar con IA» y «Guardar como receta»

Rama `ia-recetas`, avanzada (fast-forward) a `main` en `1fcddd2` antes de empezar. Sin merge, push ni despliegue.
Tests: **341 pasan** (`npm test`), todos con IA y USDA simulados. `npm run worker:check` empaqueta el Worker (sin publicar).

## 1. Qué hace

Cuando dictas algo que no está en tu documento («300 g de lasaña»), la línea «sin resolver» tiene el botón
**«Estimar con IA»**:

1. **Gemini** (una llamada, más el único reintento si el JSON es inválido) propone ingredientes y gramos típicos en
   España **del plato terminado**, primero con alimentos de tu documento y, si falta alguno, con un término de búsqueda
   de USDA. Nunca nutrientes.
2. El **código valida**: ids que existen, gramos > 0, repetidos sumados y suma dentro de ±10 % de lo dicho (si no, se
   **reescala** en proporción, con aviso). La cantidad la lee el código del texto («300 g», «0,5 kg», «300 de»); si no
   la dijiste («un plato de paella»), vale la ración de la IA, marcada «ración estimada».
3. El **Worker busca en USDA** (solo Foundation y SR Legacy, una búsqueda por término que falta, ordenados por
   completitud, con el sugerido del script) solo lo que no está en la **caché del iPhone**.
4. **Pantalla de revisión**: cada ingrediente con gramos editables, total del plato (reescala todo), origen («Tu
   documento» / «USDA · nuevo» / «USDA · ya en tu documento») y alimento cambiable: candidatos de USDA con su
   completitud n/31, «Buscar en USDA» con otro término y «Usar uno de mi documento». Avisos de fortificación con la
   opción «sin enriquecer», e incompletos.
   - **Preselección del documento**: si el nombre o el término de USDA que propone la IA *es* el nombre o un alias de
     un alimento tuyo (sin acentos, mayúsculas ni plurales, y con el estado compatible), se preselecciona el tuyo y
     USDA queda como alternativa («Usar USDA en su lugar»). Ese término no se busca en USDA. Ejemplo:
     «leche entera» → Leche entera.
   - **Sugerencia**: si solo lo *contiene* («queso mozzarella» contiene tu alias «queso»), aparece el botón «Usar
     «Queso tierno en lonchas» de tu documento», sin cambiar nada.
   - Nunca a partir del término en inglés: «…pan-browned» no es «pan». Lo cocinado solo casa con lo cocinado: tu
     pasta seca no vale para pasta cocida.
5. **Confirmar** descarga la ficha de los elegidos (una llamada), añade al documento los alimentos nuevos y sustituye
   la línea por las de sus ingredientes («Estimado con IA»). Vuelves a la **confirmación normal**: nada va al diario
   hasta pulsar «Guardar».
6. Opción **«Guardar también como receta»** (nombre y alias): crea la fila de receta para dictarla directamente la
   próxima vez. La comida se guarda igualmente como sus ingredientes.

**«Guardar como receta»** también está en el Diario (en cada comida) y en Documento → Pulir el documento → **Recetas**
(lista de `data/recetas.json` + las del dispositivo, «Nueva receta», «Editar», «Recalcular todas» y
«Exportar recetas.json»). El formulario pide el nombre, los alias, los ingredientes con sus gramos y el peso final
(opcional) y enseña el cálculo en vivo: kcal por 100 g, obligatorios n/31 y qué ingrediente deja sin dato cada
nutriente.

**Pendientes de revisar**: los alimentos añadidos con IA aparecen en Documento → Pulir el documento → «Añadidos con IA,
pendientes de revisar (N)», con su fuente y «Revisado» para quitar la marca.

## 2. Diseño

### Endpoints del Worker (`worker/src/index.js`)
Todos con el mismo CORS, el mismo `X-App-Token` y el mismo patrón de errores. **`/parse` no cambia** (hay un test de
regresión del contrato). `/health` tampoco: su ejemplo del README sigue siendo exacto.

| Endpoint | Entrada | Salida |
|---|---|---|
| `POST /estimate` | `{ texto, alimentos }` (la lista compacta de siempre) | `{ plato, gramos, total_estimado, ajustado, ingredientes: [{ origen: 'catalogo', food_id, nombre, gramos } \| { origen: 'usda', termino, nombre, estado, gramos }], warnings, model, attempts }` |
| `POST /usda/search` | `{ terminos: [≤ 15] }` (tantos como ingredientes) | `{ resultados: [{ termino, estado, motivo, sugerido, candidatos: [{ fdcId, descripcion, tipo, obligatorios, total, coincidencia, fortificacion }] }] }` |
| `POST /usda/foods` | `{ fdcIds: [≤ 20] }` | `{ fichas: [{ fdcId, descripcion, tipo, values (por 100 g, columnas del documento), notas, fuente, fortificacion, sospechosos, enriquecibles }], faltan }` |

Errores nuevos: `usda_sin_configurar` (500, falta el secreto), `limite_usda` (429), `usda_clave` (502, USDA rechaza la
clave), `usda` (502). La app los traduce a mensajes claros (`frontend/js/ai-client.js`: `estimateDish`, `usdaSearch` y
`usdaFoods`; la app sigue hablando con el Worker solo desde ahí).

### Respuesta de Gemini (`worker/src/prompt.js`: `ESTIMATE_SYSTEM_PROMPT`, `ESTIMATE_SCHEMA`)
```json
{ "plato": "lasaña", "gramos_total": 300, "ingredientes": [
  { "food_id": null, "termino_usda": "Pasta, cooked, unenriched, without added salt", "nombre": "pasta de lasaña cocida", "estado": "cocinado", "gramos": 90 },
  { "food_id": "salsa_tomate_frito", "termino_usda": null, "nombre": "tomate frito", "estado": "procesado", "gramos": 60 } ] }
```
Reglas del prompt: gramos del plato terminado que suman `gramos_total`; **catálogo primero** (los que se usan tal cual,
como leche, aceite, queso o tomate frito, siempre del catálogo; para lo cocinado, el mismo estado: nunca una fila
cruda o con `peso_en_crudo`); cortes y especies distintos no se aproximan; términos de USDA en inglés, genéricos, sin
enriquecer y sin sal; salsas caseras en sus ingredientes; como mucho 12; especias de menos de 1 g fuera.
Validación en código: `frontend/js/core/estimate-validate.js` (la usan el Worker y la app).

### Código compartido de USDA
La parte pura de `scripts/usda-lib.mjs` se ha movido a **`frontend/js/core/usda-core.js`**, sin Node: mapeo con
`data/usda-map.json`, candidatos, sugerido, cliente HTTP con fetch y caché inyectables, fortificación, valores
sospechosos y la **ficha** (`fichaUsda`: valores, notas y `fuente_usda`, que ahora también usa `applyUsda`).
`usda-lib.mjs` lo reexporta y conserva lo del script (caché en disco, `eleccion.csv`, filas e informe): el script
funciona igual. El Worker importa `data/usda-map.json` y `data/settings.json` como módulos JSON (wrangler los empaqueta).
Para el Worker, `findCandidates` tiene la opción `fndds: false`: solo Foundation y SR Legacy.

### Caché (en el iPhone)
La Cache API no funciona en `*.workers.dev` y KV obligaría a crear un namespace, así que la caché está en el
dispositivo: ajuste `usda_cache` (`frontend/js/core/usda-cache.js`), con 200 términos y 300 fichas como máximo. Un
término o un fdcId ya consultados no vuelven a USDA. El servidor local usa además la caché en disco del script
(`usda/cache/`).

### Cómo se guardan los alimentos nuevos (ver `data/SCHEMA.md`)
Son filas del documento del dispositivo:

| Columna | Valor |
|---|---|
| `id` | a partir del nombre, único |
| `alias` | vacío |
| `estado` | el del ingrediente en el plato |
| `grupo` | su id |
| `variante_por_defecto` | si |
| `incluir` | si |
| `tipo` | usda_app |
| `termino_busqueda_usda` | el término usado |
| `fdc_id`, `fuente_usda` | mismo formato que el script |
| `notas` | «Añadido con «Estimar con IA» el AAAA-MM-DD (plato). Gramos del plato terminado.» |
| `pendiente_revisar` | **si** (columna de trabajo nueva, en `schema.js`) |

Si el `fdc_id` ya está en el documento, se reutiliza esa fila. «Sin enriquecer» deja vacíos B9, B1, B2, B3 y hierro
(sin dato, nunca 0).

### Recetas
`scripts/recetas-lib.mjs` → **`frontend/js/core/recetas.js`** (el script y su test importan de ahí). Funciones nuevas:
- `recetaToFood`: la misma fila que `aplicarRecetas`; un test lo compara campo a campo.
- `recetaFromLines`, `recetaErrors` (no se anidan, no pisa un alimento) y `slugId`.
- `cleanRecetas`, `mergeRecetas` (repositorio + dispositivo; gana el dispositivo) y `recetasToJSON`.

La app carga `data/recetas.json` al arrancar. Las definiciones propias se guardan en el ajuste `recetas` y van en la
copia del diario: al importar se añaden las nuevas y no se pisan las tuyas.

### Actualizar el documento publicado
`planCatalogUpdate` distingue los alimentos **creados en el dispositivo** (`propios`: no estaban en la base; sin base,
`tipo=usda_app`) de los «ya no publicados». Unos y otros se conservan, ninguno es conflicto, y la pantalla dice «N
creados en este dispositivo: se mantienen». Test con un alimento `usda_app` y una receta creada en la app, con base y
sin base. Si después publicas tu documento con esas filas, tampoco hay conflictos.

## 3. Reglas propuestas para CLAUDE.md (aprobadas; que las pase el coordinador)

1. **La app calcula los nutrientes solo desde mi documento.** La app solo consulta USDA a través del Worker, tras una
   acción mía, para añadir alimentos que reviso y confirmo; nunca en segundo plano ni como fallback. Para mantener el
   catálogo con scripts manuales se usan USDA, BEDCA, CIQUAL (solo desempates) y mis etiquetas.
2. **La IA solo identifica alimento y cantidad**; con «Estimar con IA» (acción mía) propone además ingredientes y gramos
   típicos de un plato. Nunca calcula calorías ni nutrientes ni inventa alimentos del catálogo: lo que no está va a «no
   reconocido» o, al estimar, a un término de USDA que yo confirmo.
6. **Qué viaja a internet.** A Gemini, solo mi frase (o el fragmento que estimo) y la lista compacta del catálogo (id,
   nombre, alias, porciones, estado, grupo, defecto y `peso_en_crudo` cuando está marcado). A USDA, solo términos de
   búsqueda y fdcId. Nunca nutrientes, densidad ni el diario.
7. **Ninguna clave ni token en el repositorio ni en el frontend.** Las claves de Gemini y de USDA son secrets del Worker.
10. **La cuota de Gemini es gratuita pero limitada.** Una llamada por dictado y una por «Estimar» (más el único
    reintento si el JSON es inválido). Nada de llamadas en segundo plano, de autocompletado ni en los tests (los tests
    usan siempre el modelo simulado). Un 429 se muestra con un mensaje claro, conserva el texto y deja añadir a mano. El
    nombre del modelo sigue en una sola variable. USDA (gratuito, 1000 llamadas por hora): solo lo que falta en la caché
    del iPhone.

### Otros cambios propuestos para CLAUDE.md
- **Sección 3 (Arquitectura)**:
  - Worker: `POST /parse`, `/estimate`, `/usda/search`, `/usda/foods` y `GET /health`. Proveedores aislados en
    `worker/src/providers/gemini.js` y `usda.js`. Prompts de dictado y de estimar en `worker/src/prompt.js`.
  - `frontend/js/core/usda-core.js` es la lógica de USDA compartida por el script y el Worker.
  - `frontend/js/core/recetas.js` es la de recetas, compartida por `scripts/recetas.mjs` y la app.
  - `data/usda-map.json` ya no es «solo para el script»: también lo usa el Worker.
  - La prueba en local atiende también `/estimate` y `/usda/*` con `USDA_API_KEY` de `.env`.
- **Sección 4**: nueva subsección «Estimar con IA» con:
  - los gramos del plato terminado (la misma excepción que las recetas);
  - el ±10 % con reescalado;
  - las filas `tipo=usda_app` con `pendiente_revisar=si`;
  - «catálogo primero»;
  - que la comida se guarda como ingredientes.
- **Sección 5**: hecho «Estimar con IA» y «Guardar como receta» desde la app. Hay que retirar la línea «Asignado a la
  rama `ia-recetas` (ola 2)» de la sección 6, punto 5.5.
- **Sección 7**: presupuesto de pruebas reales de esta función: 10 llamadas a Gemini y 30 a USDA por sesión.

## 4. Despliegue (lo haces tú; yo no he desplegado nada)

1. **Revisa la línea `USDA_API_KEY` de `.env`**: el valor que lee Node es `="<40 caracteres>"`, con un `=` y dos
   comillas de más (probablemente `USDA_API_KEY=="…"`). Debe quedar `USDA_API_KEY=` y los 40 caracteres, sin comillas.
   Para la prueba real usé solo los 40 alfanuméricos, en un script temporal. El servidor local avisa si ve espacios o
   comillas, y `scripts/usda.mjs` también la rechaza así.
2. **Secreto del Worker**: `npm run worker:secret:usda` y pega solo la clave (40 letras y números, sin comillas). El
   Worker quita los espacios y saltos de línea de los extremos.
3. **Worker**: `npm run worker:check` (empaqueta sin publicar) y después `npm run worker:deploy`.
4. **App**: `git push` (se ve en la segunda apertura en el iPhone; el service worker sube a `nt-v7`).
5. **Probar**: «Probar» (Documento → Conexión) no comprueba USDA. Para comprobarlo, dicta algo que no esté en tu
   documento y pulsa «Estimar con IA». Sin el secreto verás «El Worker no tiene la clave de USDA…».
6. **README**: ya tiene el paso `npm run worker:secret:usda` junto al de Gemini y una fila en «Problemas frecuentes».
   Las rutas nuevas no cambian el ejemplo de `/health`.

## 5. Prueba real (18-10-2026)

Tu `data/foods.csv` (69 alimentos, 55 a la IA) y el modelo `gemini-3.1-flash-lite`.

**Llamadas en total: Gemini 6 (de 10) y USDA 11 (de 30).**
- Ronda 1 (Gemini 2, USDA 2): sin pantalla, solo Gemini; USDA rechazó la clave antigua.
- Ronda 2 (Gemini 2): corrección del prompt.
- Ronda 3 (Gemini 2, USDA 9 de un tope de 10): la app de verdad en jsdom, pulsando «Estimar con IA», con Gemini y
  USDA reales a través del código del Worker. Solo el dictado inicial se simuló.

### Rondas 1 y 2 (prompt)
- Primera ronda: la leche iba a USDA teniéndola en tu documento, y el azafrán salía con 5 g para no quitarlo.
- Corrección del prompt: «catálogo primero» y especias de menos de 1 g fuera, sin inflarlas. El azafrán desapareció;
  la leche siguió yendo a USDA. Por eso la **preselección del documento** (sección 1) la resuelve el código.

### Ronda 3: «300 g de lasaña», tal como sale en la pantalla de revisión
Total del plato: 300 g · Suma de ingredientes: 300 g de 300 g.

| Ingrediente | g | Origen | Elegido en USDA (completitud) | Notas |
|---|---|---|---|---|
| pasta de lasaña cocida | 90 | USDA · nuevo | Pasta, cooked, unenriched, without added salt · SR Legacy · 31/31 | 4 alternativas |
| carne picada de ternera cocinada | 80 | USDA · nuevo | Beef, ground, 85% lean meat / 15% fat, crumbles, cooked, pan-browned · SR Legacy · 31/31 | |
| Tomate frito | 60 | Tu documento | | |
| **Leche entera** | 35 | **Tu documento** | | «Preseleccionado de tu documento: la IA lo buscaba en USDA («Milk, whole, 3.25% milkfat»)» · «Usar USDA en su lugar» |
| harina de trigo | 10 | USDA · nuevo | Wheat flour, white, all-purpose, unenriched · SR Legacy · 31/31 | |
| queso mozzarella | 20 | USDA · nuevo | Cheese, mozzarella, low moisture, part-skim · SR Legacy · 31/31 | botón «Usar «Queso tierno en lonchas» de tu documento» |
| Aceite de oliva | 3 | Tu documento | | |
| sal | 2 | USDA · nuevo | Salt, table · SR Legacy · 31/31 | |

Al pulsar «Añadir a la comida», la confirmación dice «Añadidos a tu documento: pasta de lasaña cocida, carne picada
de ternera cocinada, harina de trigo, queso mozzarella, sal (pendientes de revisar en Documento)». Las 8 líneas van
marcadas «Estimado con IA»:

| Línea | g | kcal | Proteína |
|---|---|---|---|
| pasta de lasaña cocida | 90 | 142 | 5,2 g |
| carne picada | 80 | 205 | 22,2 g |
| tomate frito | 60 | 30 | 0,8 g |
| leche | 35 | 21 | 1,1 g |
| harina | 10 | 36 | 1 g |
| mozzarella | 20 | 59 | 4,8 g |
| aceite | 3 | 27 | 0 g |
| sal | 2 | 0 | 0 g |
| **Total** | 300 | **520** (173 por 100 g) | **35,1 g** |

### Ronda 3: «un plato de paella», tal como sale en la pantalla de revisión
Aviso: «No dijiste la cantidad: ración estimada de 450 g. Cámbiala si no es así.» Total del plato (ración estimada):
450 g · Suma 450 g de 450 g.

| Ingrediente | g | Origen | Elegido en USDA (completitud) | Notas |
|---|---|---|---|---|
| arroz cocido | 220 | USDA · nuevo | Rice, white, medium-grain, cooked, unenriched · SR Legacy · 24/31 | ⚠ «Incompleto en USDA: 24/31 nutrientes obligatorios» |
| pollo cocinado | 80 | USDA · nuevo | Chicken, broilers or fryers, breast, meat only, cooked, roasted · SR Legacy · 31/31 | |
| calamar cocinado | 50 | USDA · nuevo | **Mollusks, squid, mixed species, cooked, fried** · SR Legacy · 27/31 | ⚠ «Puede estar enriquecido (EE. UU.): ácido fólico añadido (431) = 9 µg» (es el rebozado) |
| gambas cocinadas | 40 | USDA · nuevo | — | «Sin buscar en USDA todavía» (tope de llamadas) |
| judías verdes cocinadas | 30 | USDA · nuevo | — | «Sin buscar en USDA todavía» (tope de llamadas) |
| Aceite de oliva | 25 | Tu documento | | |
| sal | 5 | Tu documento | | la fila que acababa de crear la lasaña: se reutiliza, no se duplica |

Pie: «Elige un alimento en los ingredientes marcados.» y «Añadir a la comida» desactivado. Con el tope de 10 llamadas
solo cupieron 3 de los 5 términos. Para completarla harían falta 3 llamadas más: 2 búsquedas y el detalle.

### Lo que enseña la prueba
- El flujo funciona de punta a punta: una llamada a Gemini por «Estimar», una búsqueda por término que falta, una de
  detalle al confirmar, filas nuevas reutilizadas en la siguiente estimación y nada en el diario hasta Guardar.
- **Calamar «fried» como sugerido** para «cooked»: el sugerido del script elige el más completo entre los más
  parecidos, y el frito lo es. El aviso de fortificación lo delata y se puede elegir otro en el selector. Una mejora
  posible en `suggest`: penalizar palabras de preparación («fried», «breaded») que no están en el término.
- El arroz cocido de SR Legacy solo tiene 24/31: la pantalla lo avisa.

## 6. Ficheros compartidos que toco (para integrar con la rama `objetivos`)
Cambios pequeños y localizados:
- `frontend/js/ui/app.js`:
  - imports;
  - `estimado_ia` en `FLAG_TEXT`;
  - una línea de estado (`estimate`, `recetas`, `recetasPropias`, `recetaForm`, `recetasMsg`);
  - `openDoc` carga las recetas propias para la copia;
  - recetas en exportar, importar y ver la copia;
  - botón «Estimar con IA» en la tarjeta «sin resolver» (solo `no_en_catalogo`);
  - «Guardar como receta» en el Diario;
  - «Recetas» y la lista de pendientes en «Pulir el documento»;
  - el bloque `ctx`/`rec`/`est` antes de `render()`;
  - dos pantallas en `screens`.

  La lógica está en `ui/estimate-screen.js` y `ui/recetas-screen.js`.
- `frontend/js/main.js`: carga `data/recetas.json` y lo pasa como `recetasBase`.
- `frontend/js/core/backup.js`: campo `recetas` en la copia (opcional al leer: las copias antiguas valen).
- `frontend/sw.js`: `VERSION` a `nt-v7` y 9 ficheros nuevos (incluido `../data/recetas.json`).
- `frontend/index.html`: `css/ia-recetas.css`.
- `frontend/js/core/draft.js`: `resolveUnmatchedWithLines`.
- `frontend/js/core/schema.js`: `pendiente_revisar` en `WORK_COLUMNS`.
- `frontend/js/core/catalog-update.js` y `ui/catalog-update-screen.js`: `propios`.
- `scripts/dev-server.mjs`: rutas nuevas, `USDA_API_KEY` y la caché en disco de USDA.
- `scripts/usda-lib.mjs`, `scripts/recetas.mjs` y `tests/recetas.test.js`: imports de los módulos movidos.

## 7. Pendiente o a vigilar
- Arreglar la línea `USDA_API_KEY` de `.env` (sección 4).
- Sugerido de USDA con preparaciones de más («fried» para «cooked»): ver la sección 5.
- **Precisión**: las proporciones son típicas, no las tuyas. Las kcal y los macros salen razonables, pero los
  micronutrientes pueden desviarse. Para lo que repitas, mejor «Guardar como receta» con tus gramos.
- Las filas cocinadas de USDA quedan en su propio grupo: fusionarlas con tus variantes es trabajo de «Pendientes de
  revisar».
- «Probar» no dice si el Worker tiene `USDA_API_KEY`. Se podría añadir a `/health`, pero cambia el ejemplo del README;
  lo dejo para cuando se toque el README.
- El registro de «Frases a revisar» anota una frase estimada como resuelta con su primer ingrediente.
