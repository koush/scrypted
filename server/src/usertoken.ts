export const ONE_DAY_MILLISECONDS = 86400000;
export const ONE_YEAR_MILLISECONDS = ONE_DAY_MILLISECONDS * 365;

export class UserToken {
    constructor(public username: string, public aclId: string, public timestamp = Date.now(), public duration = ONE_DAY_MILLISECONDS) {
    }

    static validateToken(token: string): UserToken {
        if (!token)
            throw new Error('Token not found.');

        let json: {
            u: string,
            a: string,
            t: number,
            d: number,
        };
        try {
            json = JSON.parse(token);
        }
        catch (e) {
            throw new Error('Token malformed, unparseable.');
        }
        let { u, a, t, d } = json;
        u = u?.toString();
        t = parseInt(t?.toString());
        d = parseInt(d?.toString());
        a = a?.toString();
        if (!u || !t || !d)
            throw new Error('Token malformed, missing properties.');
        if (d > ONE_YEAR_MILLISECONDS)
            throw new Error('Token duration too long.')
        if (t > Date.now())
            throw new Error('Token from the future.');
        if (t + d < Date.now())
            throw new Error('Token expired.');
        return new UserToken(u, a, t, d);
    }

    toString(): string {
        return JSON.stringify({
            u: this.username,
            a: this.aclId,
            t: this.timestamp,
            d: this.duration,
        })
    }
}
