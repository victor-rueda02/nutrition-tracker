// Esquema del documento de alimentos (ver data/SCHEMA.md).

// Columnas básicas, en el orden en que se exportan.
export const CORE_COLUMNS = ['id', 'nombre', 'alias', 'porciones', 'estado', 'variante_por_defecto', 'grupo', 'densidad_g_ml', 'peso_en_crudo'];

// Densidad (g/ml) para convertir volúmenes. Fuera de este rango se avisa (casi seguro un error de unidad).
export const DENSIDAD_RANGO = [0.3, 2.5];

// Nombres antiguos aceptados al importar (se exportan con el nombre nuevo).
export const LEGACY_HEADERS = { porciones_sugeridas: 'porciones' };

// Columnas de trabajo: se conservan al importar/exportar y no intervienen en ningún cálculo.
export const WORK_COLUMNS = [
  'termino_busqueda_usda', 'tipo', 'incluir', 'notas', 'cantidad_habitual_g', 'dias_de_uso_en_8',
  'fdc_id', 'fuente_usda', // los rellena scripts/usda.mjs (de dónde sale cada dato)
];

export const ESTADOS = ['crudo', 'cocinado', 'procesado', 'tostado'];
export const ESTADO_SYNONYMS = { cocido: 'cocinado', cocida: 'cocinado', cruda: 'crudo' };

// ids: minúsculas, números y guiones bajos (slug estable).
export const ID_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;
