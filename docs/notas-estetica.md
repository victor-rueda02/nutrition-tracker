# Notas de estética (rama `estetica`)

Objetivo: que la app recuerde a la de referencia (Cronometer) en colores y en cómo presenta los datos, sin usar su nombre, logo ni iconos. Solo cambia la presentación: los textos y el comportamiento son los mismos y los 233 tests pasan sin tocarlos.

## Paleta

Todos los colores están en un único `:root` de `frontend/css/styles.css`. La versión oscura los redefine dentro de `@media (prefers-color-scheme: dark)`.

| Token | Uso | Claro | Oscuro |
|---|---|---|---|
| `--bg` | fondo de página | `#f1f2f6` | `#11131c` |
| `--surface` | tarjetas, secciones, cabecera, barra inferior | `#ffffff` | `#232634` |
| `--fg` | texto | `#1b1d2a` | `#f3f4f8` |
| `--muted` | texto secundario, placeholder | `#5b6072` | `#a4a9ba` |
| `--line` | separadores | `#d5d8e1` | `#363a4c` |
| `--field` | borde de campos y botones secundarios | `#767b8e` | `#7a8098` |
| `--track` | parte vacía de la barra | `#e2e5ec` | `#3a3e51` |
| `--accent` | botón principal, enlaces, energía | `#b8410f` | `#ff7a4d` |
| `--on-accent` | texto sobre `--accent` | `#ffffff` | `#1a0b04` |
| `--c-energia` | energía (= `--accent`) | `#b8410f` | `#ff7a4d` |
| `--c-proteina` | proteína | `#1a7a43` | `#62d68e` |
| `--c-hidratos` | hidratos de carbono | `#0a7a87` | `#44cddb` |
| `--c-grasa` | grasa total | `#8b3fa6` | `#c584d9` |
| `--bar-under` | barra por debajo del objetivo | `#5b6072` | `#eceef3` |
| `--bar-met` | barra cumplida o dentro del rango; texto «ok» | `#1a7a43` | `#84dfa2` |
| `--bar-over` | barra por encima del máximo, del objetivo o del UL; errores | `#c62828` | `#ff6b5e` |
| `--warn` | avisos (parcial, sin dato, confianza media) | `#8a5300` | `#f0b44c` |

Hay además tokens que no son colores de la paleta: `--scrim` (fondo del selector), `--shadow`, `--radius` (16 px) y `--header-h` (60 px).

Manifest: `theme_color` y `background_color` = `#f1f2f6`. En `index.html` hay dos `<meta name="theme-color">` con `media`: `#f1f2f6` en claro y `#11131c` en oscuro.

### Contraste (WCAG AA), calculado

- Texto: todos los colores de texto superan 4,5:1 sobre `--surface` y sobre `--bg`, en los dos modos. El peor caso es `--c-proteina` en claro sobre `--bg`: 4,80.
- Barras: todos los rellenos superan 3:1 sobre `--track`. Los peores casos son la grasa en oscuro (3,86) y `--bar-over` en oscuro (3,78).
- Bordes de campos: `--field` supera 3:1 sobre `--surface` y `--bg`.
- Botón principal: 5,52 en claro y 7,45 en oscuro.

## Decisiones

1. **Tarjetas sobre un fondo un tono más oscuro.** Cabecera, secciones, comidas y líneas de la confirmación van en `--surface`, redondeadas a 16 px. El modo oscuro tira a azul marino, no a negro. La fuente es la del sistema (SF Pro en el iPhone), sin fuentes externas.
2. **Tres estados de barra, solo con CSS**, a partir de las clases que ya pone la lógica en `.meter`:
   - por debajo (`por_debajo`) → `--bar-under`;
   - cumplido (`cumplido`, `en_objetivo`, `dentro`) → `--bar-met`;
   - por encima (`excedido`, `por_encima`, o la fila con `over-ul`) → `--bar-over`.

   El texto de estado repite el color, en negrita, y el aviso de UL ya trae ⚠: el estado nunca depende solo del color. Superar el UL manda sobre cualquier otro color.
3. **Cada macro tiene su color fijo.** Energía, proteína, hidratos y grasa total usan su color en la barra del Diario (por `data-clave`) y en el borde izquierdo de su tarjeta en Objetivos (por `k-<clave>`). Si una macro se pasa, la barra conserva su color y lleva al final un remate rojo, separado por una línea del color de la tarjeta, además del texto de estado en rojo. Las grasas saturadas, los azúcares y la fibra usan los colores de estado normales.
4. **Lista de alimentos del Diario como en la referencia**: nombre en negrita, gramos debajo en gris y kcal a la derecha («sin dato» en `--warn`). Los separadores « · » siguen en el DOM, ocultos a la vista, así que el texto (y los tests) no cambian.
5. **Zonas táctiles ≥ 44 px**: todos los botones (incluidos `.icon` y `.link`), campos, `summary`, chips, filas del selector y la casilla «Confirmo … g».
6. **Sin scroll horizontal a 375 px**: `overflow-wrap:anywhere` en `main`, `min-width:0` en los hijos de `.row` y la cabecera de cada nutriente puede partirse en dos líneas. Comprobado con Chrome headless en un iframe de 375 px: ningún elemento sobresale en Inicio, Confirmar, Diario, Objetivos y Documento.
7. La cabecera es fija y respeta `safe-area-inset-top`. La barra de días queda fija justo debajo.

## Clases y contenedores añadidos (`frontend/js/ui/app.js`)

Ninguna clase existente se ha renombrado ni quitado.

| Dónde | Añadido |
|---|---|
| `header()` | `with-back` en la cabecera cuando tiene «‹ Volver» (título centrado) |
| `nutrientRow()` | `nut-head` (fila de etiqueta y valor), `nut-label`, `nut-valor`, `nut-estado` |
| Diario | `section.panel` alrededor de «Energía y macros» y de «Micronutrientes»; `panel` en «Otros nutrientes» (`details`) |
| Diario, comidas | `meal-head` (cabecera de la comida), `registro-actions` (Editar y Borrar) |
| Diario, líneas | `li.line` con `span.line-name`, `span.line-grams`, `span.line-kcal` (`sin-dato` si no hay kcal) y `span.sep` (« · », oculto a la vista) |
| Objetivos | `k-<clave>` en cada tarjeta (p. ej. `k-proteina_g`) |
| Documento | tres `section.panel`: documento, conexión con la IA y copia de seguridad |

## Cómo verlo

`npm run dev` sirve la app en http://localhost:8080/. En el iPhone, con `--lan`. Pantallas que revisar, en claro y en oscuro (Ajustes → Pantalla del iPhone, o el modo oscuro del sistema en el PC):

- **Diario** con comidas de varios días: barras, macros, aviso de UL y lista de alimentos.
- **Confirmar**, tras dictar: tarjetas, insignias de confianza, «Sin resolver» y barra inferior.
- **Objetivos**: bordes de color de las macros.
- **Documento**: las tres secciones.
- **Inicio** y el selector de alimentos («+ Añadir alimento»).
