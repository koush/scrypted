import { Point } from '@scrypted/sdk';
import polygonClipping from 'polygon-clipping';

// const polygonOverlap = require('polygon-overlap');
// const insidePolygon = require('point-inside-polygon');

export function polygonOverlap(p1: Point[], p2: Point[]) {
    const intersect = polygonClipping.intersection([p1], [p2]);
    return !!intersect.length;
}

export function insidePolygon(point: Point, polygon: Point[]) {
    const intersect = polygonClipping.intersection([polygon], [[point, [point[0] + 1, point[1]], [point[0] + 1, point[1] + 1]]]);
    return !!intersect.length;
}

export function normalizeBox(boundingBox: [number, number, number, number], inputDimensions: [number, number]): [Point, Point, Point, Point] {
    let [x, y, width, height] = boundingBox;
    let x2 = x + width;
    let y2 = y + height;
    // the zones are point paths in percentage format
    x = x * 100 / inputDimensions[0];
    y = y * 100 / inputDimensions[1];
    x2 = x2 * 100 / inputDimensions[0];
    y2 = y2 * 100 / inputDimensions[1];
    return [[x, y], [x2, y], [x2, y2], [x, y2]];
}

export function polygonArea(p: Point[]): number {
    let area = 0;
    const n = p.length;
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        area += p[i][0] * p[j][1];
        area -= p[j][0] * p[i][1];
    }
    return Math.abs(area / 2);
}
