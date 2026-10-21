# Registro de coordinación

Una fila por encargo. Estado: `pendiente`, `en curso`, `en revisión`, `cambios (ronda N)`, `integrado`, `bloqueado (Victor)`. Rondas = revisiones hechas.

| Fecha | Encargo | Subagente | Rama | Rondas | Estado | Pendiente de Victor |
|---|---|---|---|---|---|---|
| 2026-10-21 | Montar modo coordinador (agentes, permisos, CLAUDE.md §8) y limpiar worktrees | coordinador | main | – | integrado | – (carpetas nt-* borradas) |
| 2026-10-21 | A · Botón Guardar tapado por la barra inferior en pantallas de edición | desarrollador | dev/a-guardar-visible | 1 | integrado | – |
| 2026-10-21 | B · Aviso de totales parciales con nutrientes afectados (macros vs micros) | desarrollador | dev/b-aviso-parciales | 2 | integrado | – |
| 2026-10-21 | C · «Más ideas» de ¿Qué ceno? descarta todas las ideas | desarrollador | dev/c-mas-ideas | 2 | integrado (falta worker:deploy) | ¿Aprobar regla 6 (rol a Gemini)? Victor vio el fallo con el Worker publicado |
| 2026-10-21 | D · Receta `atun_lata_con_aceite` | catalogo | cat/d-e-atun-huecos | 2 | integrado | – (decidido: solo «lata de atún») |
| 2026-10-21 | E · Huecos de chía, corn flakes, chocolate 85 %, muesli y pasta seca (BEDCA/CIQUAL) | catalogo | cat/d-e-atun-huecos | 2 | integrado | – |
| 2026-10-21 | F · Salteados de verduras (normal y asadas, Hacendado) | catalogo | cat/f-salteados | 1 | espera a I; ronda 2 tras integrar I (etiqueta en recetas.json, peso 58,7, roles) | – (Victor: opción a; roles: jamones y chorizo proteina, pan integral y avena hidrato; sin rol lentejas, muslo, almendras) |
| 2026-10-21 | G · «null» en la vista previa de receta; robustez de chrome-cdp y NT_SIN_CHROME | desarrollador | dev/g-null-receta-cdp | 1 | integrado | – |
| 2026-10-21 | H · Aviso «alias más específico» (salteado ⊂ salteado asadas, pan ⊂ pan de molde…) | desarrollador | dev/h-alias-especifico | 1 | cambios (ronda 2): rendimiento en el Worker | – (aprobado por Victor) |
| 2026-10-21 | I · Campo «etiqueta» en las recetas (valores de etiqueta que recalcular no pierde) | desarrollador | dev/i-etiqueta-recetas | 1 | integrado | – |
| 2026-10-21 | J · Icono de la app (anillos + hoja morada) | coordinador | main | – | integrado (sin publicar) | Al reinstalar en el iPhone: al reinstalar, exportar diario y documento antes |

## Notas
- 2026-10-21: los agentes de `.claude/agents/` solo se cargan al iniciar sesión; en la sesión en que se crearon se emularon con `general-purpose` + mismo modelo, effort y worktree, siguiendo su fichero.
- 2026-10-21, F · etiquetas de Victor (por 100 g). Victor: «si no digo nada, es el salteado de verduras; si digo salteado de verduras asadas, el de asadas».
  - **Salteado de verduras** (ultracongelado, 600 g; judía verde, brócoli, pimiento rojo, champiñón cultivado y cebolla, proporción variable): 31 kcal (128 kJ), grasa 0,3 g (saturadas 0,1), hidratos 3,8 g (azúcares 3,0), fibra 2,3 g, proteína 2,0 g, sal 0,02 g. Fila nueva.
  - **Salteado de verduras asadas** (ultracongelado, 450 g; calabacín, cebolla, berenjena, pimiento rojo y amarillo, proporción variable): 46 kcal (194 kJ), grasa 0,1 g (saturadas 0,0), hidratos 8,0 g (azúcares 6,6), fibra 2,9 g, proteína 1,8 g, sal 0,03 g («sodio natural»). Ya existe como receta `verduras_asadas_hacendado` (20 g de cada verdura cruda, 27 kcal calculadas: falta la pérdida de agua del asado).
- 2026-10-21 10:18: `git worktree remove` del worktree de B siguió el enlace `node_modules` (symlinkDirectories) y vació el del repo principal. Restaurado con `npm ci`; quitado `symlinkDirectories` y los enlaces; regla en CLAUDE.md §8.
