import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CatalogRepository } from '../src/application/catalog-repository.js';

const catalogRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'examples',
  'local-demo',
  'catalog'
);

test('local demo fixture is a one-product local-demo manifest', () => {
  const repository = new CatalogRepository(catalogRoot);
  assert.deepEqual(repository.stats(), {
    source: 'local-demo',
    totalProducts: 1,
    totalCompleted: 1,
    byCategory: { '귀걸이': 1 }
  });
});
