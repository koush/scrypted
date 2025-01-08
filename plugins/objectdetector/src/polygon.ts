import type { ClipPath, Point } from '@scrypted/sdk';

export type BoundingBox = [number, number, number, number];

// Helper function to determine if a point is inside a polygon using the ray-casting algorithm
function pointInPolygon(point: Point, polygon: ClipPath): boolean {
    let inside = false;
    const x = point[0], y = point[1];

    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i][0], yi = polygon[i][1];
        const xj = polygon[j][0], yj = polygon[j][1];

        const intersect = yi > y !== yj > y && x < (xj - xi) * (y - yi) / (yj - yi) + xi;
        if (intersect) inside = !inside;
    }

    return inside;
}

// Check if the polygon intersects the bounding box
export function polygonIntersectsBoundingBox(polygon: ClipPath, boundingBox: BoundingBox): boolean {
    const [bx, by, bw, bh] = boundingBox;

    // Check if any of the bounding box corners is inside the polygon
    const corners: Point[] = [
        [bx, by], [bx + bw, by], [bx, by + bh], [bx + bw, by + bh]
    ];

    for (const corner of corners) {
        if (pointInPolygon(corner, polygon)) {
            return true;
        }
    }

    // Check if the polygon edges intersect with the bounding box edges
    for (let i = 0; i < polygon.length; i++) {
        const p1 = polygon[i];
        const p2 = polygon[(i + 1) % polygon.length];

        if (lineIntersectsBoundingBox(p1, p2, boundingBox)) {
            return true;
        }
    }

    return false;
}

// Helper function to check if a line segment intersects the bounding box
function lineIntersectsBoundingBox(p1: Point, p2: Point, boundingBox: BoundingBox): boolean {
    const [bx, by, bw, bh] = boundingBox;

    const clip = (p: Point) => p[0] >= bx && p[0] <= bx + bw && p[1] >= by && p[1] <= by + bh;

    return clip(p1) || clip(p2) ||
        lineIntersectsLine(p1, p2, [bx, by], [bx + bw, by]) || // Top edge
        lineIntersectsLine(p1, p2, [bx + bw, by], [bx + bw, by + bh]) || // Right edge
        lineIntersectsLine(p1, p2, [bx + bw, by + bh], [bx, by + bh]) || // Bottom edge
        lineIntersectsLine(p1, p2, [bx, by + bh], [bx, by]); // Left edge
}

// Helper function to check if two line segments intersect
function lineIntersectsLine(p1: Point, p2: Point, q1: Point, q2: Point): boolean {
    const det = (p1[0] - p2[0]) * (q1[1] - q2[1]) - (p1[1] - p2[1]) * (q1[0] - q2[0]);
    if (det === 0) return false;

    const lambda = ((q1[1] - q2[1]) * (q1[0] - p1[0]) + (q2[0] - q1[0]) * (q1[1] - p1[1])) / det;
    const gamma = ((p1[1] - p2[1]) * (q1[0] - p1[0]) + (p2[0] - p1[0]) * (q1[1] - p1[1])) / det;

    return (lambda >= 0 && lambda <= 1) && (gamma >= 0 && gamma <= 1);
}

// Check if the polygon fully contains the bounding box
export function polygonContainsBoundingBox(polygon: ClipPath, boundingBox: BoundingBox): boolean {
    const [bx, by, bw, bh] = boundingBox;

    // Check if all four corners of the bounding box are inside the polygon
    const corners: Point[] = [
        [bx, by], [bx + bw, by], [bx, by + bh], [bx + bw, by + bh]
    ];

    return corners.every(corner => pointInPolygon(corner, polygon));
}

export function normalizeBox(boundingBox: [number, number, number, number], inputDimensions: [number, number]): BoundingBox {
    let [x, y, width, height] = boundingBox;
    let x2 = x + width;
    let y2 = y + height;
    // the zones are point paths in percentage format
    x = x  / inputDimensions[0];
    y = y  / inputDimensions[1];
    x2 = x2  / inputDimensions[0];
    y2 = y2  / inputDimensions[1];
    return [x, y, x2 - x, y2 - y];
}

export function fixLegacyClipPath(clipPath: ClipPath): ClipPath {
    if (!clipPath)
        return;

    // if any value is over abs 2, then divide by 100.
    // this is a workaround for the old scrypted bug where the path was not normalized.
    // this is a temporary workaround until the path is normalized in the UI.
    let needNormalize = false;
    for (const p of clipPath) {
        for (const c of p) {
            if (Math.abs(c) >= 2)
                needNormalize = true;
        }
    }

    if (!needNormalize)
        return clipPath;

    return clipPath.map(p => p.map(c => c / 100)) as ClipPath;
}
