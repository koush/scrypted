export const ONE_DAY_MILLISECONDS = 86400000;
export const ONE_YEAR_MILLISECONDS = ONE_DAY_MILLISECONDS * 365;

export class UserToken {
    constructor(public username: string, public timestamp = Date.now(), public duration = ONE_DAY_MILLISECONDS) {
    }

    static validateToken(token: string): UserToken {
        let json: any;
        try {
            json = JSON.parse(token);
        }
        catch (e) {
            throw new Error('Token malformed, unparseable.');
        }
        let { u, t, d } = json;
        u = u?.toString();
        t = parseInt(t);
        d = parseInt(d);
        if (!u || !t || !d)
            throw new Error('Token malformed, missing properties.');
        if (d > ONE_YEAR_MILLISECONDS)
            throw new Error('Token duration too long.')
        if (t > Date.now())
            throw new Error('Token from the future.');
        if (t + d < Date.now())
            throw new Error('Token expired.');
        return new UserToken(u, t, d);
    }

    toString(): string {
        return JSON.stringify({
            u: this.username,
            t: this.timestamp,
            d: this.duration,
        })
    }
}
