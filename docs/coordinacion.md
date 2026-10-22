# Registro de coordinación

Una fila por encargo. Estado: `pendiente`, `en curso`, `en revisión`, `cambios (ronda N)`, `integrado`, `bloqueado (Victor)`. Rondas = revisiones hechas.

| Fecha | Encargo | Subagente | Rama | Rondas | Estado | Pendiente de Victor |
|---|---|---|---|---|---|---|
| 2026-10-21 | Montar modo coordinador (agentes, permisos, CLAUDE.md §8) y limpiar worktrees | coordinador | main | – | integrado | – (carpetas nt-* borradas) |
| 2026-10-21 | A · Botón Guardar tapado por la barra inferior en pantallas de edición | desarrollador | dev/a-guardar-visible | 1 | integrado | – |
| 2026-10-21 | B · Aviso de totales parciales con nutrientes afectados (macros vs micros) | desarrollador | dev/b-aviso-parciales | 2 | integrado | – |
| 2026-10-21 | C · «Más ideas» de ¿Qué ceno? descarta todas las ideas | desarrollador | dev/c-mas-ideas | 2 | integrado y publicado | – (regla 6 aprobada) |
| 2026-10-21 | D · Receta `atun_lata_con_aceite` | catalogo | cat/d-e-atun-huecos | 2 | integrado | – (decidido: solo «lata de atún») |
| 2026-10-21 | E · Huecos de chía, corn flakes, chocolate 85 %, muesli y pasta seca (BEDCA/CIQUAL) | catalogo | cat/d-e-atun-huecos | 2 | integrado | – |
| 2026-10-21 | F · Salteados de verduras (normal y asadas, Hacendado) | catalogo | cat/f-salteados | 2 | integrado | – (Victor: opción a; roles: jamones y chorizo proteina, pan integral y avena hidrato; sin rol lentejas, muslo, almendras) |
| 2026-10-21 | G · «null» en la vista previa de receta; robustez de chrome-cdp y NT_SIN_CHROME | desarrollador | dev/g-null-receta-cdp | 1 | integrado | – |
| 2026-10-21 | H · Aviso «alias más específico» (salteado ⊂ salteado asadas, pan ⊂ pan de molde…) | desarrollador | dev/h-alias-especifico | 2 | integrado y publicado | – (aprobado por Victor) |
| 2026-10-21 | I · Campo «etiqueta» en las recetas (valores de etiqueta que recalcular no pierde) | desarrollador | dev/i-etiqueta-recetas | 1 | integrado | – |
| 2026-10-21 | J · Icono de la app (anillos + hoja morada) | coordinador | main | – | integrado y publicado | Al reinstalar en el iPhone: exportar diario y documento antes |
| 2026-10-21 | K1 · Info de nutrientes: general, hidratos, grasas y aminoácidos (data/nutrientes-info.json) | redactor-salud (emulado) | salud/k1-macros-aminoacidos | 2 | integrado | – |
| 2026-10-21 | K2 · Info de nutrientes: vitaminas y minerales | redactor-salud (emulado) | salud/k2-vitaminas-minerales | 2 | integrado (fusionado con K1 por clave; "completo": true) | – |
| 2026-10-21 | L · Detalle de alimento y detalle de nutriente (pantallas, navegación, cálculo, rango, «En tu catálogo») | desarrollador | dev/l-detalle-alimento-nutriente | 2 | integrado | – (decidido por el coordinador: «Guardar» de gramos desde el Diario) |
| 2026-10-21 | M · UL de vitamina A y folato solo informativo (no avisa en Diario ni descarta en ¿Qué ceno?) + menores de L | desarrollador | dev/m-ul-informativo | 1 | integrado | – (Victor: opción b) |
| 2026-10-22 | N · «Repetir de ayer» sin nada marcado y casilla por comida (tri-estado) | desarrollador | dev/n-repetir-casillas | 0 | en curso | – (coordinador: «Repetir esta comida» y plantillas siguen todo marcado) |

## Notas
- 2026-10-21: los agentes de `.claude/agents/` solo se cargan al iniciar sesión; en la sesión en que se crearon se emularon con `general-purpose` + mismo modelo, effort y worktree, siguiendo su fichero.
- 2026-10-21, F · etiquetas de Victor (por 100 g). Victor: «si no digo nada, es el salteado de verduras; si digo salteado de verduras asadas, el de asadas».
  - **Salteado de verduras** (ultracongelado, 600 g; judía verde, brócoli, pimiento rojo, champiñón cultivado y cebolla, proporción variable): 31 kcal (128 kJ), grasa 0,3 g (saturadas 0,1), hidratos 3,8 g (azúcares 3,0), fibra 2,3 g, proteína 2,0 g, sal 0,02 g. Fila nueva.
  - **Salteado de verduras asadas** (ultracongelado, 450 g; calabacín, cebolla, berenjena, pimiento rojo y amarillo, proporción variable): 46 kcal (194 kJ), grasa 0,1 g (saturadas 0,0), hidratos 8,0 g (azúcares 6,6), fibra 2,9 g, proteína 1,8 g, sal 0,03 g («sodio natural»). Ya existe como receta `verduras_asadas_hacendado` (20 g de cada verdura cruda, 27 kcal calculadas: falta la pérdida de agua del asado).
- 2026-10-21 10:18: `git worktree remove` del worktree de B siguió el enlace `node_modules` (symlinkDirectories) y vació el del repo principal. Restaurado con `npm ci`; quitado `symlinkDirectories` y los enlaces; regla en CLAUDE.md §8.
- 2026-10-21, K/L: K1 y K2 escriben claves disjuntas de data/nutrientes-info.json en ramas distintas; al integrar, fusionar por clave (no textual) y poner "completo": true. Revisor: ≥ 8 nutrientes contra fuentes y recálculo a mano de un alimento con cantidad no redonda; revisor-estetica con docs/referencia-cronometer/datalle-alimento (errata en el nombre) y detalle-nutriente.
- 2026-10-21, hallazgo de K2 para Victor: UL de vitamina A (3000, solo retinol) y de folato (1000, solo ácido fólico) se comparan con el total (RAE / DFE) en el Diario y en «¿Qué ceno?» (descarta cenas): falsos avisos. Victor eligió b (encargo M). Victor confirma cantidad_habitual_g = 460 g del muslo.
- 2026-10-21, L · revisor-estetica ronda 1: CAMBIOS (BLOQUEANTE: UL superado solo por color en detalle de nutriente; MENORES: tarjetas plegables, filas sin objetivo alineadas y sangría, títulos de grupo, cabecera, etiquetas de marcas 13 px, leyenda y Mín.=Ref., títulos de sección). Se envía junto con la revisión de código.
- 2026-10-21, L: el revisor de código aprobó (recálculo del chorizo a 123 g y 37,5 g correcto). Nota para Victor: cantidad_habitual_g del muslo de pollo es 460 g (sale primero en «En tu catálogo»): confirmar.
- 2026-10-22: git push de K1, K2, L y M (detalle de alimento y nutriente, información de nutrientes, UL informativo). Worker sin cambios (no hace falta deploy).
