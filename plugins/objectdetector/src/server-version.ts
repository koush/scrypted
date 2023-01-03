import semver from 'semver';
import sdk from '@scrypted/sdk';

export function serverSupportsMixinEventMasking() {
    try {
        if (!sdk.serverVersion)
            return false;
        return semver.gte(sdk.serverVersion, '0.5.0');
    }
    catch (e) {
    }
    return false;
}
