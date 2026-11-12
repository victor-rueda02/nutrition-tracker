// Semana v15 (la publicada) con las palancas que el optimizador puede mover. Lo fijo no lleva palanca: bebida de avena 600 ml,
// bote de tomate frito (90/90+70/70/60), pimiento entero (jue 100, vie 100), lentejas caseras 625, salmón 200, sardinillas 130,
// atún 60 ×2, huevos 108 lun/mié/jue/vie, chía 3 por comida, chocolate 8, kiwi 100, yogur ligero 125 ×2, pan con tomate.
const k = (min, max, step, w = 0.02, cero = false) => ({ min, max, step, w, cero });
const desayuno = () => [['avena_copos', 90, k(70, 100, 5, 0.05)], ['cacao_polvo', 5], ['bebida_de_avena', 300], ['crema_cacahuete', 10]];
// Aceite del pan con tomate 5-10 g y 1-3 mandarinas (70 g cada una): energía y calcio con poca proteína.
const almuerzo = () => [['pan_integral', 70], ['tomate', 60], ['aceite_oliva', 5, k(5, 10, 1, 0.15)], ['almendras_crudas', 15], ['anacardos', 10], ['mandarina', 70, k(70, 210, 70, 0.004)]];
const merienda = () => [['corn_flakes', 60, k(30, 80, 5, 0.03)], ['muesli', 25], ['bebida_de_avena', 300], ['manzana_con_piel', 150], ['platano', 100]];
const postreComida = () => [['yogur_griego_ligero', 125], ['semillas_chia', 3], ['chocolate_negro_85', 8], ['kiwi_verde', 100]];
const postreCena = (extra) => [['yogur_griego_ligero', 125], ['semillas_chia', 3], ['datiles_deglet_noor', 18, k(0, 36, 9, 0.05)], ...extra];
const basePatata = (p, a) => [['patata_cruda', p, k(200, 500, 10)], ['verduras_asadas_hacendado', 200], ['zanahoria', 50], ['aceite_oliva', a, k(3, 15, 1, 0.1)]];
const pollo = (g, min = 60, max = 250, cero = false) => ['pechuga_pollo_cruda', g, k(min, max, 10, 0.03, cero)];
const dia = (comida, cena) => ({ desayuno: [...desayuno(), ...almuerzo()], comida, merienda: merienda(), cena });

export const semanaBase = () => ({
  lunes: dia(
    [['lentejas_caseras', 625], ['arroz_blanco_crudo', 70, k(50, 120, 5, 0.02, true)], ...postreComida()],
    [...basePatata(400, 10), ['huevo', 108], ['atun_lata_aceite', 60], ...postreCena([['nueces', 10, k(0, 20, 5, 0.1)]])]),
  martes: dia(
    [['arroz_blanco_crudo', 135, k(60, 220, 5)], ['verduras_asadas_hacendado', 150], pollo(110), ['aceite_oliva', 7, k(3, 15, 1, 0.1)], ['salsa_tomate_frito', 90], ...postreComida()],
    [...basePatata(330, 4), ['salmon_atlantico', 200], ['sal', 0.3], ...postreCena([['almendras_crudas', 15, k(0, 20, 5, 0.1)]])]),
  miercoles: dia(
    [['arroz_blanco_crudo', 95, k(60, 220, 5)], ['verduras_asadas_hacendado', 150], pollo(200), ['aceite_oliva', 10, k(3, 15, 1, 0.1)], ['salsa_tomate_frito', 90], ...postreComida()],
    [['pasta_seca', 100, k(70, 150, 5)], ['salteado_verduras_hacendado', 150], ['huevo', 108], ['aceite_oliva', 6, k(3, 15, 1, 0.1)], ['salsa_tomate_frito', 70], ...postreCena([['nueces', 10, k(0, 20, 5, 0.1)], ['almendras_crudas', 10, k(0, 20, 5, 0.1)]])]),
  jueves: dia(
    [['lentejas_secas', 120, k(80, 120, 10, 0.1)], ['arroz_blanco_crudo', 55, k(30, 120, 5)], ['zanahoria', 120], ['cebolla', 120], ['pimiento_rojo', 100], ['aceite_oliva', 13, k(8, 15, 1, 0.1)], ...postreComida()],
    [...basePatata(330, 6), ['huevo', 108], ['atun_lata_aceite', 60], pollo(60, 40, 120, true), ['salsa_tomate_frito', 70], ...postreCena([['nueces', 10, k(0, 20, 5, 0.1)]])]),
  viernes: dia(
    [['arroz_blanco_crudo', 140, k(60, 220, 5)], ['verduras_asadas_hacendado', 150], ['pimiento_rojo', 100], pollo(90, 60, 250, true), ['huevo', 108], ['aceite_oliva', 3, k(3, 15, 1, 0.1)], ['salsa_tomate_frito', 60], ...postreComida()],
    [...basePatata(330, 10), ['sardina_lata_reducida_sal', 130], ...postreCena([['almendras_crudas', 10, k(0, 20, 5, 0.1)]])]),
});
