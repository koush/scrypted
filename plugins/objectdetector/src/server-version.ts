import semver from 'semver';
import sdk from '@scrypted/sdk';

export function serverSupportsMixinEventMasking() {
    try {
        if (!sdk.version)
            return false;
        return semver.gte(sdk.version, '0.5.0');
    }
    catch (e) {
    }
    return false;
}
