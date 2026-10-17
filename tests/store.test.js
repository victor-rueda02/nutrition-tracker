import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../frontend/js/storage/store.js';
import { openIdbStore } from '../frontend/js/storage/idb-store.js';

const fake = await import('fake-indexeddb').catch(() => null);
const skip = fake ? false : 'falta fake-indexeddb (npm install)';

const meal = (id, date, createdAt) => ({ id, date, meal: 'comida', createdAt, text: 't', lines: [{ food_id: 'a', grams: 10, source_text: 's' }] });

async function contract(store) {
  assert.equal(await store.getCatalogRecord(), null);
  const rec = { foods: [{ id: 'a', nombre: 'A', nutrients: { energia_kcal: 0 }, extra: {} }], extraHeaders: ['notas'], name: 'x.csv', importedAt: '2026-10-16T10:00:00.000Z' };
  await store.putCatalogRecord(rec);
  assert.deepEqual(await store.getCatalogRecord(), rec);
  await store.putCatalogRecord({ ...rec, name: 'y.csv' });
  assert.equal((await store.getCatalogRecord()).name, 'y.csv');

  assert.equal(await store.getSetting('conn'), undefined);
  await store.setSetting('conn', { endpoint: 'https://w', token: 't' });
  assert.deepEqual(await store.getSetting('conn'), { endpoint: 'https://w', token: 't' });

  await store.addMeal(meal('2', '2026-10-16', '2026-10-16T13:00:00.000Z'));
  await store.addMeal(meal('1', '2026-10-16', '2026-10-16T08:00:00.000Z'));
  await store.addMeal(meal('3', '2026-10-17', '2026-10-17T08:00:00.000Z'));
  assert.deepEqual((await store.listMealsByDate('2026-10-16')).map((m) => m.id), ['1', '2']);
  assert.deepEqual((await store.allMeals()).map((m) => m.id), ['1', '2', '3']);
  await store.deleteMeal('2');
  assert.deepEqual((await store.listMealsByDate('2026-10-16')).map((m) => m.id), ['1']);
  assert.deepEqual(await store.listMealsByDate('2030-01-01'), []);
}

test('almacén en memoria cumple el contrato', () => contract(createMemoryStore()));

test('almacén IndexedDB cumple el mismo contrato', { skip }, async () => {
  const store = await openIdbStore({ indexedDB: new fake.IDBFactory(), name: 'test-1' });
  await contract(store);
  store.close();
});

test('IndexedDB conserva los datos al reabrir la base', { skip }, async () => {
  const idb = new fake.IDBFactory();
  const a = await openIdbStore({ indexedDB: idb, name: 'persist' });
  await a.addMeal(meal('1', '2026-10-16', '2026-10-16T08:00:00.000Z'));
  a.close();
  const b = await openIdbStore({ indexedDB: idb, name: 'persist' });
  assert.equal((await b.allMeals()).length, 1);
  b.close();
});
