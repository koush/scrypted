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
