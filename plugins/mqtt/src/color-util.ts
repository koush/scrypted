export function getXyYFromHsvColor(h: number, s: number, v: number, hueModelId: string = null) {
    if (s > 1 || v > 1 || h > 360)
        throw new Error('invalid hsv color, h must not be greater than 360, and s and v must not be greater than 1');

    const rgb = hsvToRgb(h, s, v);
    const xyz = rgbToXyz(rgb.r, rgb.g, rgb.b);
    const { x, y, z } = xyz;

    let xyY = {
        x: x / (x + y + z),
        y: y / (x + y + z),
        brightness: y
    };

    if (!xyIsInGamutRange(xyY, hueModelId)) {
        xyY = getClosestColor(xyY, hueModelId);
    }

    return xyY;
}

export function getHsvFromXyColor(x: number, y: number, brightness: number) {
    if (x > 1 || y > 1 || brightness > 1)
        throw new Error('invalid xy color, x, y, and brightness must not be greater than 1');

    const Y = brightness;
    const z = 1 - x - Y;
    const X = (Y / y) * x;
    const Z = (Y / y) * z;
    const rgb = xyzToRgb(X, Y, Z);
    const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);

    const h: number = hsv[0];
    const s: number = hsv[1];
    const v: number = hsv[2];

    return {
        h, s, v
    };
}

export function getRgbFromXyColor(x: number, y: number, brightness: number) {
    if (x > 1 || y > 1 || brightness > 1)
        throw new Error('invalid xy color, x, y, and brightness must not be greater than 1');

    const Y = brightness;
    const z = 1 - x - Y;
    const X = (Y / y) * x;
    const Z = (Y / y) * z;
    const rgb = xyzToRgb(X, Y, Z);

    return rgb;
}

export function getXyFromRgbColor(r: number, g: number, b: number, hueModelId: string = null) {
    if (r > 255 || g > 255 || b > 255)
        throw new Error('invalid rgb color, r, g, and b must not be greater than 255');

    const xyz = rgbToXyz(r, g, b);
    const { x, y, z } = xyz;

    let xyY = {
        x: x / (x + y + z),
        y: y / (x + y + z),
        brightness: y
    };

    if (!xyIsInGamutRange(xyY, hueModelId)) {
        xyY = getClosestColor(xyY, hueModelId);
    }

    return xyY;
}

function xyzToRgb (x: number, y: number, z: number) {
	let r = (x * 3.2406) + (y * -1.5372) + (z * -0.4986);
	let g = (x * -0.9689) + (y * 1.8758) + (z * 0.0415);
	let b = (x * 0.0557) + (y * -0.2040) + (z * 1.0570);

	// Assume sRGB
	r = r > 0.0031308
		? ((1.055 * (r ** (1.0 / 2.4))) - 0.055)
		: r * 12.92;

	g = g > 0.0031308
		? ((1.055 * (g ** (1.0 / 2.4))) - 0.055)
		: g * 12.92;

	b = b > 0.0031308
		? ((1.055 * (b ** (1.0 / 2.4))) - 0.055)
		: b * 12.92;

	r = Math.min(Math.max(0, r), 1);
	g = Math.min(Math.max(0, g), 1);
	b = Math.min(Math.max(0, b), 1);

	return {
        r: r * 255, 
        g: g * 255, 
        b: b * 255
    };
}

function hsvToRgb (h: number, s: number, v: number) {
    h /= 60;

	const hi = Math.floor(h) % 6;

	const f = h - Math.floor(h);
	const p = 255 * v * (1 - s);
	const q = 255 * v * (1 - (s * f));
	const t = 255 * v * (1 - (s * (1 - f)));
	v *= 255;

	switch (hi) {
		case 0:
			return { r:v, g:t, b:p };
		case 1:
            return { r:q, g:v, b:p };
		case 2:
            return { r:p, g:v, b:t };
		case 3:
			return { r:p, g:q, b:v };
		case 4:
			return { r:t, g:p, b:v };
		case 5:
			return { r:v, g:p, b:q };
	}
}

function rgbToXyz(r: number, g: number, b: number) {
    r /= 255;
    g /= 255; 
    b /= 255;
  
    r = r > 0.04045 ? Math.pow((r + 0.055) / 1.055, 2.4) : r / 12.92;
    g = g > 0.04045 ? Math.pow((g + 0.055) / 1.055, 2.4) : g / 12.92; 
    b = b > 0.04045 ? Math.pow((b + 0.055) / 1.055, 2.4) : b / 12.92;
  
    const x = r * 0.4124 + g * 0.3576 + b * 0.1805;
    const y = r * 0.2126 + g * 0.7152 + b * 0.0722;
    const z = r * 0.0193 + g * 0.1192 + b * 0.9505;
  
    return {
        x, y, z
    };
}

function rgbToHsv (r: number, g: number, b: number) {
    r /= 255;
    g /= 255;
    b /= 255;

	const v = Math.max(r, g, b);
	const diff = v - Math.min(r, g, b);
	const diffc = function (c) {
		return (v - c) / 6 / diff + 1 / 2;
	};

	let rdif: number;
	let gdif: number;
	let bdif: number;
	let h: number;
	let s: number;

	if (diff === 0) {
		h = 0;
		s = 0;
	} else {
		s = diff / v;
		rdif = diffc(r);
		gdif = diffc(g);
		bdif = diffc(b);

		if (r === v) {
			h = bdif - gdif;
		} else if (g === v) {
			h = (1 / 3) + rdif - bdif;
		} else if (b === v) {
			h = (2 / 3) + gdif - rdif;
		}

		if (h < 0) {
			h += 1;
		} else if (h > 1) {
			h -= 1;
		}
	}

	return [
		h * 360, s, v
	];
}

export function xyIsInGamutRange(xy: any, hueModelId: string = null) {
    let gamut = getLightColorGamutRange(hueModelId);
    if (Array.isArray(xy)) {
        xy = {
            x: xy[0],
            y: xy[1]
        };
    }

    let v0 = [gamut.blue[0] - gamut.red[0], gamut.blue[1] - gamut.red[1]];
    let v1 = [gamut.green[0] - gamut.red[0], gamut.green[1] - gamut.red[1]];
    let v2 = [xy.x - gamut.red[0], xy.y - gamut.red[1]];

    let dot00 = (v0[0] * v0[0]) + (v0[1] * v0[1]);
    let dot01 = (v0[0] * v1[0]) + (v0[1] * v1[1]);
    let dot02 = (v0[0] * v2[0]) + (v0[1] * v2[1]);
    let dot11 = (v1[0] * v1[0]) + (v1[1] * v1[1]);
    let dot12 = (v1[0] * v2[0]) + (v1[1] * v2[1]);

    let invDenom = 1 / (dot00 * dot11 - dot01 * dot01);

    let u = (dot11 * dot02 - dot01 * dot12) * invDenom;
    let v = (dot00 * dot12 - dot01 * dot02) * invDenom;

    return ((u >= 0) && (v >= 0) && (u + v < 1));
}

export function getLightColorGamutRange(hueModelId: string = null): any {

    // legacy LivingColors Bloom, Aura, Light Strips and Iris (Gamut A) 
    let gamutA = {
        red: [0.704, 0.296],
        green: [0.2151, 0.7106],
        blue: [0.138, 0.08]
    };

    // older model hue bulb (Gamut B)
    let gamutB = {
        red: [0.675, 0.322],
        green: [0.409, 0.518],
        blue: [0.167, 0.04]
    };

    // newer model Hue lights (Gamut C) 
    let gamutC = {
        red: [0.692, 0.308],
        green: [0.17, 0.7],
        blue: [0.153, 0.048]
    };

    let defaultGamut ={
        red: [1.0, 0],
        green: [0.0, 1.0],
        blue: [0.0, 0.0]
    };

    let philipsModels = {
        "9290012573A": gamutB
    };

    if(!!philipsModels[hueModelId]){
        return philipsModels[hueModelId];
    }

    return defaultGamut;
}

export function getClosestColor(xy: any, hueModelId: string = null) {
    function getLineDistance(pointA, pointB){
        return Math.hypot(pointB.x - pointA.x, pointB.y - pointA.y);
    }

    function getClosestPoint(xy, pointA, pointB) {
        let xy2a = [xy.x - pointA.x, xy.y - pointA.y];
        let a2b = [pointB.x - pointA.x, pointB.y - pointA.y];
        let a2bSqr = Math.pow(a2b[0],2) + Math.pow(a2b[1],2);
        let xy2a_dot_a2b = xy2a[0] * a2b[0] + xy2a[1] * a2b[1];
        let t = xy2a_dot_a2b /a2bSqr;

        return {
            x: pointA.x + a2b[0] * t,
            y: pointA.y + a2b[1] * t,
            brightness: xy.brightness
        }
    }

    let gamut = getLightColorGamutRange(hueModelId);

    let greenBlue = {
        a: {
            x: gamut.green[0],
            y: gamut.green[1]
        },
        b: {
            x: gamut.blue[0],
            y: gamut.blue[1]
        }
    };

    let greenRed = {
        a: {
            x: gamut.green[0],
            y: gamut.green[1]
        },
        b: {
            x: gamut.red[0],
            y: gamut.red[1]
        }
    };

    let blueRed = {
        a: {
            x: gamut.red[0],
            y: gamut.red[1]
        },
        b: {
            x: gamut.blue[0],
            y: gamut.blue[1]
        }
    };

    let closestColorPoints = {
        greenBlue : getClosestPoint(xy,greenBlue.a,greenBlue.b),
        greenRed : getClosestPoint(xy,greenRed.a,greenRed.b),
        blueRed : getClosestPoint(xy,blueRed.a,blueRed.b)
    };

    let distance = {
        greenBlue : getLineDistance(xy,closestColorPoints.greenBlue),
        greenRed : getLineDistance(xy,closestColorPoints.greenRed),
        blueRed : getLineDistance(xy,closestColorPoints.blueRed)
    };

    let closestDistance;
    let closestColor;
    for (let i in distance){
        if(distance.hasOwnProperty(i)){
            if(!closestDistance){
                closestDistance = distance[i];
                closestColor = i;
            }

            if(closestDistance > distance[i]){
                closestDistance = distance[i];
                closestColor = i;
            }
        }

    }
    return  closestColorPoints[closestColor];
}