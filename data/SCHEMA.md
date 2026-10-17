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
`termino_busqueda_usda`, `tipo`, `incluir`, `notas`, `cantidad_habitual_g`, `dias_de_uso_en_8`, `fdc_id` y `fuente_usda` (las dos últimas las rellena `scripts/usda.mjs`: de qué alimento de USDA salen los nutrientes y qué alternativas se usaron) se conservan al
importar y exportar y no intervienen en ningún cálculo. Cualquier otra cabecera desconocida también se conserva,
con un aviso (si parece un nutriente con la unidad cambiada, el aviso sugiere la correcta).

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
