// 좌표는 전부 [lng, lat] 순서, bbox는 [minx, miny, maxx, maxy].

export function bboxOfFeature(feature) {
  if (Array.isArray(feature.bbox) && feature.bbox.length === 4) return feature.bbox.slice();
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  const visit = (c) => {
    if (typeof c[0] === 'number') {
      if (c[0] < minx) minx = c[0];
      if (c[0] > maxx) maxx = c[0];
      if (c[1] < miny) miny = c[1];
      if (c[1] > maxy) maxy = c[1];
    } else c.forEach(visit);
  };
  visit(feature.geometry.coordinates);
  return [minx, miny, maxx, maxy];
}

function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const crosses = (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

function pointInPolygon(pt, rings) {
  if (!pointInRing(pt, rings[0])) return false;
  for (let i = 1; i < rings.length; i++) if (pointInRing(pt, rings[i])) return false;
  return true;
}

export function pointInGeometry(pt, geometry) {
  if (geometry.type === 'Polygon') return pointInPolygon(pt, geometry.coordinates);
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.some((rings) => pointInPolygon(pt, rings));
  return false;
}

export function splitBbox([minx, miny, maxx, maxy]) {
  const cx = (minx + maxx) / 2;
  const cy = (miny + maxy) / 2;
  return [[minx, miny, cx, cy], [cx, miny, maxx, cy], [minx, cy, cx, maxy], [cx, cy, maxx, maxy]];
}
