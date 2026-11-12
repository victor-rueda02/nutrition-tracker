// Aviso de versión nueva de la app (frontend/js/sw-update.js) con un service worker falso: sin red ni navegador real.
import test from 'node:test';
import assert from 'node:assert/strict';
import { vigilarVersion, INTERVALO_MS } from '../frontend/js/sw-update.js';

const jsdom = await import('jsdom').catch(() => null);
const skip = jsdom ? false : 'falta jsdom (npm install)';

function montar({ controller = {}, registerFalla = false } = {}) {
  const dom = new jsdom.JSDOM('<!doctype html><body><div id="app"></div></body>');
  const doc = dom.window.document;
  let visible = 'visible';
  Object.defineProperty(doc, 'visibilityState', { get: () => visible });
  const sw = new dom.window.EventTarget();
  sw.controller = controller;
  const reg = { updates: 0, update() { this.updates++; return Promise.resolve(); } };
  sw.register = (url) => (registerFalla ? Promise.reject(new Error('sin sw')) : Promise.resolve(Object.assign(reg, { url })));
  let t = 1000;
  const recargas = [];
  const errores = [];
  const p = vigilarVersion({ sw, doc, reload: () => recargas.push(1), now: () => t, log: (...a) => errores.push(a) });
  const cambiar = () => sw.dispatchEvent(new dom.window.Event('controllerchange'));
  const volver = () => { visible = 'hidden'; doc.dispatchEvent(new dom.window.Event('visibilitychange')); visible = 'visible'; doc.dispatchEvent(new dom.window.Event('visibilitychange')); };
  return { doc, sw, reg, p, recargas, errores, cambiar, volver, avanzar: (ms) => { t += ms; } };
}

test('aviso de versión nueva: solo si ya había una versión; uno solo; «Ahora no» lo quita sin recargar; «Recargar» recarga', { skip }, async () => {
  const primera = montar({ controller: null }); // primera instalación: no es «versión nueva»
  await primera.p;
  primera.cambiar();
  assert.equal(primera.doc.querySelector('.aviso-version'), null);

  const t = montar();
  await t.p;
  assert.equal(t.reg.url, 'sw.js');
  t.cambiar();
  t.cambiar();
  assert.equal(t.doc.querySelectorAll('.aviso-version').length, 1);
  const aviso = t.doc.querySelector('.aviso-version');
  assert.match(aviso.textContent, /Hay una versión nueva de la app\. Guarda lo que tengas a medias antes de recargar\./);
  const [luego, recargar] = [...aviso.querySelectorAll('button')];
  assert.deepEqual([luego.textContent, recargar.textContent], ['Ahora no', 'Recargar']);
  luego.click();
  assert.equal(t.doc.querySelector('.aviso-version'), null);
  assert.equal(t.recargas.length, 0); // nunca recarga solo
  t.cambiar(); // otra versión más tarde: vuelve a avisar
  t.doc.querySelector('.aviso-version button:last-child').click();
  assert.equal(t.recargas.length, 1);
});

test('busca versión nueva al volver a primer plano, como mucho cada 5 minutos; un fallo no se traga', { skip }, async () => {
  const t = montar();
  await t.p;
  t.volver();
  assert.equal(t.reg.updates, 0); // recién abierta
  t.avanzar(INTERVALO_MS - 1);
  t.volver();
  assert.equal(t.reg.updates, 0);
  t.avanzar(1);
  t.volver();
  assert.equal(t.reg.updates, 1);
  t.volver();
  assert.equal(t.reg.updates, 1); // el reloj vuelve a empezar
  const mal = montar({ registerFalla: true });
  await mal.p;
  assert.match(String(mal.errores[0]?.[0]), /No se pudo registrar el service worker/);
  assert.equal(vigilarVersion({ sw: null }), undefined); // sin service worker (http con la IP): no hace nada
});
