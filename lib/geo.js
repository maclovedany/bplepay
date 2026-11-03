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

// 점들의 볼록 껍질(Andrew monotone chain)을 닫힌 Polygon 으로 돌려준다.
// 점이 3개 미만(또는 모두 한 줄)이면 bbox 를 pad 만큼 넓힌 사각형.
export function convexHull(points, pad = 0.0003) {
  const pts = [...new Map(points.map((p) => [p.join(','), [Number(p[0]), Number(p[1])]])).values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  let hull = [];
  if (pts.length >= 3) {
    const lower = [];
    for (const p of pts) { while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), p) <= 0) lower.pop(); lower.push(p); }
    const upper = [];
    for (const p of pts.slice().reverse()) { while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), p) <= 0) upper.pop(); upper.push(p); }
    hull = lower.slice(0, -1).concat(upper.slice(0, -1));
  }
  if (hull.length < 3) {
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const [minx, maxx, miny, maxy] = [Math.min(...xs) - pad, Math.max(...xs) + pad, Math.min(...ys) - pad, Math.max(...ys) + pad];
    hull = [[minx, miny], [maxx, miny], [maxx, maxy], [minx, maxy]];
  }
  return { type: 'Polygon', coordinates: [[...hull, hull[0]]] };
}
