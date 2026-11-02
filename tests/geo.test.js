import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bboxOfFeature, pointInGeometry, splitBbox } from '../lib/geo.js';

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
