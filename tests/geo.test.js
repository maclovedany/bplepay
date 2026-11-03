import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bboxOfFeature, pointInGeometry, splitBbox, convexHull } from '../lib/geo.js';

const square = { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] };
const withHole = { type: 'Polygon', coordinates: [square.coordinates[0], [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]] };
const multi = { type: 'MultiPolygon', coordinates: [square.coordinates, [[[20, 20], [30, 20], [30, 30], [20, 30], [20, 20]]]] };

test('inside square', () => assert.equal(pointInGeometry([5, 5], square), true));
test('outside square', () => assert.equal(pointInGeometry([15, 5], square), false));
test('in hole is outside', () => assert.equal(pointInGeometry([5, 5], withHole), false));
test('second polygon of multi', () => assert.equal(pointInGeometry([25, 25], multi), true));
test('bbox from coordinates', () => assert.deepEqual(bboxOfFeature({ type: 'Feature', geometry: multi }), [0, 0, 30, 30]));
test('bbox prefers feature.bbox', () => assert.deepEqual(bboxOfFeature({ bbox: [1, 2, 3, 4], geometry: square }), [1, 2, 3, 4]));
test('splitBbox quarters', () => assert.deepEqual(splitBbox([0, 0, 10, 10]), [[0, 0, 5, 5], [5, 0, 10, 5], [0, 5, 5, 10], [5, 5, 10, 10]]));

test('convexHull keeps only the outer corners and closes the ring', () => {
  const g = convexHull([[0, 0], [10, 0], [5, 5], [10, 10], [0, 10], [3, 3]]);
  assert.equal(g.type, 'Polygon');
  const ring = g.coordinates[0];
  assert.equal(ring.length, 5);
  assert.deepEqual(ring[0], ring[4]);
  assert.deepEqual(ring.slice(0, 4).map(String).sort(), ['0,0', '0,10', '10,0', '10,10']);
  assert.equal(pointInGeometry([5, 5], g), true);
});

test('convexHull of fewer than 3 points is a padded box', () => {
  const g = convexHull([[128.6, 35.86], [128.601, 35.861]]);
  assert.equal(g.coordinates[0].length, 5);
  assert.equal(pointInGeometry([128.6005, 35.8605], g), true);
  assert.equal(pointInGeometry([128.61, 35.87], g), false);
});
