# Esquema del documento de alimentos

Un fichero **CSV** (editable desde una hoja de cálculo) o **JSON**, con una fila/objeto por alimento.
Es la única fuente de nutrientes de la app. La app no consulta ninguna base de datos en internet.

## Formato del CSV
- UTF-8 (con o sin BOM). Separador: coma, punto y coma o tabulador (se detecta solo, así vale el CSV de Excel en español).
- Números con punto o con coma decimal (`16.9` o `16,9`). Nada de `<0.1`, `tr` o `n/d`: si no hay dato, **celda vacía**.
- **Celda vacía = dato no disponible. Un `0` escrito = cero real** (p. ej. B12 en un vegetal).
- Las cabeceras no distinguen mayúsculas. El orden de las columnas da igual.

## Columnas básicas
| Columna | Obligatoria | Descripción |
|---|---|---|
| `id` | sí | Slug estable y único: minúsculas, números y `_` (`arroz_blanco_crudo`). No lo cambies una vez usado en el diario. |
| `nombre` | sí | Nombre legible. |
| `alias` | no | Variantes coloquiales separadas por `\|` (`pan\|barra de pan`). |
| `porciones` | no | `nombre:gramos` separadas por `\|` (`huevo grande:50\|clara:33`). Vacío = "pendiente de definir porción". Las entradas mal formadas (`rodaja:`) se ignoran con aviso. (Nombre antiguo `porciones_sugeridas` aceptado al importar.) |
| `estado` | no | `crudo`, `cocinado`, `tostado` o `procesado` (`cocido`/`cocida` se normalizan a `cocinado`, `cruda` a `crudo`). Lo usa la regla de variantes. |
| `variante_por_defecto` | no | `si`/`no`. Qué variante se elige cuando no dices el estado. |
| `grupo` | no | Slug común a las variantes del mismo alimento (`arroz_blanco` para `arroz_blanco_crudo` y `arroz_blanco_cocido`). Con 2 o más miembros, debe haber exactamente una con `variante_por_defecto=si`. |
| `densidad_g_ml` | no | Gramos por mililitro (`0.91` aceite de oliva, `1.03` leche entera). Si dictas un volumen ("5 ml de aceite"), la app lo convierte a gramos con este valor: gramos = ml × densidad. Sin densidad, la línea va a "no reconocido" con motivo `sin_densidad` y pones los gramos a mano. La densidad no se envía a la IA. Un valor no numérico o ≤ 0 se ignora con aviso; fuera de 0,3–2,5 se avisa. |
| `peso_en_crudo` | no | `si`/`no` (vacío = `no`). `si` = este alimento lo pesas siempre en crudo: si dictas "a la plancha", "al horno"... se queda en esta fila, sin bajar la confianza ni avisar ("a la plancha" dice cómo lo cocinaste, no cómo lo pesaste). Se envía a la IA solo cuando es `si`. |

## Columnas de nutrientes (valor por 100 g)
Nombre en `snake_case` con la unidad al final: `_g`, `_mg`, `_ug` (µg) o `_kcal`. La lista completa y las etiquetas
están en `data/nutrients.json` (61 columnas: energía, macros, grasas, vitaminas, minerales, 18 aminoácidos...).
Para añadir un nutriente, añade una entrada a ese fichero.

## Columnas de trabajo y desconocidas
`termino_busqueda_usda`, `tipo`, `incluir`, `notas`, `cantidad_habitual_g`, `dias_de_uso_en_8`, `fdc_id`, `fuente_usda` (estas dos las rellenan `scripts/usda.mjs` y «Estimar con IA»: de qué alimento de USDA salen los nutrientes y qué alternativas se usaron), `pendiente_revisar`, `rol_cena` y `nombre_corto` se conservan al
importar y exportar y no intervienen en ningún cálculo. Cualquier otra cabecera desconocida también se conserva,
con un aviso (si parece un nutriente con la unidad cambiada, el aviso sugiere la correcta).

### Columnas de «¿Qué ceno?»: `rol_cena` y `nombre_corto` (opcionales)
Viven aquí, en tu documento, para que al añadir un alimento (a mano o con «Estimar con IA») todo quede en un solo sitio.
- **`rol_cena`**: el papel del alimento en una cena. Valores: `proteina`, `hidrato`, `verdura`, `plato` (receta o plato
  completo), `grasa`, `salsa`, `postre_base` (yogur), `postre_extra` (chía, nueces, chocolate), `fruta` y `otro`.
  Se ignoran mayúsculas y espacios; un valor desconocido cuenta como vacío. **Vacío**: una receta se trata como `plato` y
  cualquier otro alimento como `otro` (nunca se propone como proteína, hidrato ni verdura). Un alimento nuevo solo entra
  en las propuestas de «¿Qué ceno?» con su rol: los añadidos con «Estimar con IA» llegan sin rol (ponlo al revisarlos).
  Si ningún alimento del documento tiene rol, «¿Qué ceno?» avisa de que falta la columna.
- **`nombre_corto`**: nombre breve para los **títulos** de las propuestas («Cena ligera: salmón con pepino»). Vacío =
  el `nombre`. Las líneas de la propuesta y todo lo demás siguen con el nombre completo.
- La semilla `data/cenas-semilla.json` ya no lleva roles: solo las cenas de Cronometer y las verduras crudas (`crudas`).

### Filas añadidas desde la app con «Estimar con IA»
Cuando confirmas una estimación con ingredientes que no tenías, cada alimento de USDA elegido se añade al documento
del dispositivo como una fila nueva: `id` a partir del nombre que confirmaste (único), `alias` vacío, `estado` el del
ingrediente en el plato (normalmente `cocinado`: gramos del plato terminado), `grupo` = su id,
`variante_por_defecto=si`, `incluir=si` (así la próxima estimación lo usa y no se duplica), `tipo=usda_app`,
`termino_busqueda_usda` (el término usado), `fdc_id` y `fuente_usda` (mismo formato que `scripts/usda.mjs filas`;
con «sin enriquecer», vacíos B9, B1, B2, B3 y hierro), `notas` («Añadido con «Estimar con IA» el AAAA-MM-DD (plato)»)
y **`pendiente_revisar=si`**: aparecen en Documento → Pulir el documento → «Añadidos con IA, pendientes de revisar»
hasta que pulses «Revisado» (la marca se borra). Ponles alias o fúndelos con tus variantes en tu documento. Si el
`fdc_id` ya está en el documento, se reutiliza esa fila. Para publicarlas, exporta el documento y cópialo a
`data/foods.csv`; mientras tanto, «Buscar actualización del documento» las conserva (no son conflicto).

## Validación al importar
**Error (la fila se rechaza):** id vacío, con formato inválido o duplicado; nombre vacío; valor de nutriente no
numérico o negativo. **Error de documento:** falta `id` o `nombre`, cabecera repetida, documento vacío.
**Aviso (la fila se importa):** cabecera desconocida, porción mal formada, estado/variante no reconocidos, densidad no válida o fuera de rango,
más celdas que cabeceras, coma decimal en CSV separado por comas, valores imposibles (>100 g por 100 g, >950 kcal),
grupo sin variante por defecto (o con varias), alias o nombre que identifica a varios alimentos.

## Completitud
`data/settings.json` define `requiredNutrients` (los nutrientes que cuentan) y `completenessThreshold` (0.8 = 80 %).
Completitud = obligatorios rellenos / obligatorios totales (un `0` cuenta). Por debajo del umbral, el alimento es
"incompleto". Los nutrientes que no están en la lista se guardan y se muestran, pero no cuentan.

## JSON
Lista de objetos (o `{"foods": [...]}`) con las mismas claves que las columnas. `alias` y `porciones` pueden ser
texto (`"a|b"`) o listas (`["a","b"]`, `[{"nombre":"vaso","gramos":250}]`). Un nutriente ausente o `null` = sin dato.
`variante_por_defecto` puede ser `true`/`false`.

## Ficheros
- `foods.template.csv`: solo las cabeceras.
- `foods.sample.csv`: 10 alimentos de ejemplo. **Valores aproximados, no verificados contra USDA; no usar como catálogo.**
  Se regeneran con `npm run build:templates`.
- `recetas.json`: recetas del catálogo (ver abajo). Las filas de receta de `foods.csv` se calculan desde aquí.
- `retirados.json`: alimentos que se quitan del documento «como si no hubiesen estado nunca» (ver abajo).

## Alimentos retirados (`data/retirados.json`)
```json
{ "version": 1, "retirados": [ { "id": "coca_cola", "fecha": "2026-10-23", "motivo": "sin datos, no se usa" } ] }
```
- `id`: el `id` del alimento retirado. `fecha` (AAAA-MM-DD) y `motivo` son informativos.
- Al quitar un alimento del `foods.csv` se añade aquí su `id`. La app lo carga como los demás `data/*.json` (va en la caché
  del service worker; si el fichero falta o no es válido, se ignora y nada se elimina).
- Al «Buscar actualización del documento», un alimento del dispositivo cuyo `id` esté en la lista y **no** en el
  `foods.csv` publicado se elimina del catálogo del dispositivo al pulsar «Actualizar», aunque se hubiera cambiado desde
  la app. La revisión los enseña antes y avisa de las líneas del diario y de las recetas que los usan. El diario y las
  recetas no se tocan (las líneas quedan como «alimento borrado»). Es la única excepción a «la actualización nunca borra
  alimentos». Si el `foods.csv` publicado vuelve a traer un `id` de la lista, no se borra.

## Recetas (`data/recetas.json`)
Una receta es **una fila más del catálogo**: la app la trata como cualquier alimento (dictas "300 g de lentejas").
Sus nutrientes por 100 g de plato cocinado **no se escriben a mano**: los calcula `scripts/recetas.mjs` con los
nutrientes de sus ingredientes en el propio catálogo. Nada de red ni de IA.

```json
{ "recetas": [
  { "id": "lentejas_caseras", "nombre": "Lentejas caseras", "alias": ["lentejas"],
    "peso_final_g": 2400,
    "ingredientes": [ { "food_id": "lentejas_secas", "gramos": 400 }, { "food_id": "chorizo", "gramos": 100 } ],
    "notas": "Texto libre que se añade a la columna notas" }
] }
```
| Campo | Obligatorio | Descripción |
|---|---|---|
| `id` | sí | Id de la fila en `foods.csv` (mismas reglas que `id`). Si la fila no existe, se crea. |
| `nombre` | sí | Nombre de la fila. |
| `alias` | no | Lista (o texto `a\|b`). Si se omite, se conservan los alias de la fila. |
| `ingredientes` | sí | `food_id` (cualquier alimento del catálogo, también con `incluir=no`; no otra receta del fichero: no se anidan) y `gramos` (> 0) **en crudo**, de la tanda entera. |
| `peso_final_g` | no | Peso del plato cocinado entero (olla llena − olla vacía). Sin él, el peso final es la suma de los ingredientes: así los `gramos` pueden ser **proporciones** (p. ej. un producto comercial: 20 g de cada verdura). |
| `etiqueta` | no | Para productos con etiqueta: objeto `{ "<clave de nutriente>": número ≥ 0 }` con los valores **declarados**, por 100 g del plato. Sustituyen a los calculados (también si el cálculo los dejaba sin dato); el resto sigue calculándose de los ingredientes. Ver «Valores de etiqueta» abajo. |
| `ejemplo` | no | `true` = receta de ejemplo/plantilla: se calcula pero **nunca** se escribe en el catálogo. |
| `notas` | no | Se añade tras "Gramos del plato cocinado." en la columna `notas`. |

**Valores de etiqueta** (`etiqueta`, opcional). Un producto con etiqueta (p. ej. un salteado de verduras de
Hacendado) se modela como receta: los micronutrientes salen de las verduras a partes iguales y los valores declarados
(kcal, grasa, saturadas, hidratos, azúcares, fibra, proteína y sodio) sustituyen a los calculados. Así sobreviven a
`recetas.mjs --aplicar`, a «Recalcular todas» y a Editar → Guardar, que antes los pisaban:
```json
{ "id": "salteado_verduras_hacendado", "nombre": "Salteado de verduras",
  "ingredientes": [ { "food_id": "calabacin", "gramos": 20 }, { "food_id": "pimiento_rojo", "gramos": 20 } ],
  "etiqueta": { "energia_kcal": 36, "grasa_total_g": 1.2, "proteina_g": 1.8, "sodio_mg": 120 } }
```
Las claves tienen que ser nutrientes del catálogo (`energia_kcal`, `sodio_mg`...) y los valores números ≥ 0 (un `0` es
un 0 real). La fila del catálogo anota en `fuente_usda`: `...; etiqueta: energia_kcal, grasa_total_g...; resto calculado de la
receta`. En la app, el formulario de la receta no edita la etiqueta (la conserva y la muestra en una línea); se edita
en el JSON. Va también en la copia de seguridad y en «Exportar recetas.json».

**Cálculo** (por nutriente): suma de (valor por 100 g × gramos / 100) de los ingredientes ÷ peso final × 100.
- Si un ingrediente **no tiene dato** de un nutriente, la receta queda **sin dato** en ese nutriente (nunca un total
  parcial que parezca completo); el script dice qué ingrediente lo bloquea. Un `0` escrito cuenta como dato.
- El cambio de peso al cocinar se asume que es **agua**: agua final = agua de los ingredientes + (peso final − peso de
  los ingredientes). No se aplican factores de retención de vitaminas.

**Fila de receta en `foods.csv`** (la escribe el script con `--aplicar`): `estado=cocinado` (se pesa el plato
cocinado: es la excepción a "todo en crudo"), `peso_en_crudo` vacío, `incluir=si`, notas que empiezan por "Gramos del
plato cocinado", `termino_busqueda_usda` = `(receta: data/recetas.json)` (así `usda.mjs` no la pisa), `fdc_id` vacío
y `fuente_usda` con los ingredientes y el peso final. Las columnas de nutrientes se sobrescriben todas; el resto de la
fila y del documento se conserva (separador, BOM, fin de línea; coma decimal si el separador es `;`). Una fila nueva
lleva `grupo` = su id, `variante_por_defecto=si` y `tipo=receta`.

```
node scripts/recetas.mjs              # informe: obligatorios por receta y qué ingrediente deja huecos; no escribe
node scripts/recetas.mjs --aplicar    # escribe las filas en data/foods.csv (--foods y --recetas para otras rutas)
```
**Desde la app** («Guardar como receta» en el Diario o al estimar con IA, y Documento → Pulir el documento →
«Recetas»): mismo formato y mismo cálculo (`frontend/js/core/recetas.js`, que también usa el script). La fila se
escribe en el documento del dispositivo con los mismos campos que `--aplicar`, y la definición se guarda en el
dispositivo (va en la copia del diario). La lista muestra las de `data/recetas.json` más las tuyas (con el mismo id,
gana la tuya); «Exportar recetas.json» da el fichero completo para copiarlo en `data/`, y «Recalcular todas» vuelve a
calcular las filas con los nutrientes actuales. Una receta estimada con IA usa los gramos del plato terminado (en
proporción, sin `peso_final_g`).
