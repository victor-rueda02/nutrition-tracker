# Notas del catálogo (rama `catalogo`)

Trabajo sobre `data/foods.csv` (y su copia `tests/fixtures/alimentos_iniciales.csv`) del 18-10-2026.
Este documento es para el coordinador que integra en `main`: qué cambió, qué decisiones de Victor deben pasar a
`CLAUDE.md` y qué queda pendiente (incluido lo que necesita código de la app, fuera del alcance de esta rama).

## Decisiones de Victor para pasar a CLAUDE.md

1. **Fuentes de nutrientes: USDA, etiquetas que pase Victor y BEDCA** (Base de Datos Española de Composición de
   Alimentos, https://www.bedca.net), aprobada para **alimentos españoles** que USDA no tiene bien. Nunca valores
   "típicos" de memoria. Cuando se usa BEDCA, el origen de cada valor va en `fuente_usda` y el
   `termino_busqueda_usda` queda vacío para que `scripts/usda.mjs` no lo pise. Consulta: `POST` de un XML a
   `https://www.bedca.net/bdpub/procquery.php` (nivel 1: buscar por `f_ori_name`; nivel 2: valores por `f_id`).
   Ojo: BEDCA da la niacina como *equivalentes de niacina* (incluye triptófano): no usarla como `vitamina_b3_mg`.
2. **Lo que dicta Victor es peso en crudo y sin hueso** (lo que realmente se come). Las palabras de cocinado
   ("a la plancha", "al horno", "hervido", "frito") describen el plato, no el peso: los alimentos que se cocinan
   llevan `peso_en_crudo=si`. Si alguna vez pesa cocinado o con hueso, lo dice y lo corrige en la confirmación.
   Generaliza la regla "Peso en crudo" de la sección 4 de CLAUDE.md (hoy dice "marcado en `pechuga_pollo_cruda`").
3. **Recetas: excepción a "todo en crudo".** Una receta es una fila del catálogo con `estado=cocinado`, sin
   `peso_en_crudo` y notas "Gramos del plato cocinado"; sus nutrientes se calculan con `scripts/recetas.mjs` desde
   `data/recetas.json` (formato en `data/SCHEMA.md`). Añadir el script a la sección 3 (herramientas de `scripts/`).
4. **"pan" a secas = barra de pan blanco**; "arroz" a secas = arroz blanco de grano largo; "jamón" a secas no
   identifica nada (come curado serrano y cocido). Generales con un solo alimento aceptados por Victor: "chocolate",
   "yogur", "griego", "queso", "galletas" (si come otro tipo, lo dirá).
