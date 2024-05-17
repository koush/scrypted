import os from 'os';

export const SCRYPTED_INSTALL_ENVIRONMENT_ANDROID = "android";

function ensureAndroidCompatibility() {
    /*
     * On Android, Scrypted can run within a standard Linux filesystem through proot.
     * However, os.networkInterfaces() is incompatible and will raise an error.
     * We can instead pass the required data through environment variables.
     *
     * The SCRYPTED_NETINTERFACES variable contains JSON-formatted data in the same
     * format as os.networkInterfaces().
     */
    let scryptedInterfaces: any = {};
    if (process.env.SCRYPTED_NETINTERFACES) {
        try {
            scryptedInterfaces = JSON.parse(process.env.SCRYPTED_NETINTERFACES);
        } catch (e) {
            console.error("Failed to parse SCRYPTED_NETINTERFACES: " + e);
        }
    }
    os.networkInterfaces = () => scryptedInterfaces;
}

export function ensureCompatibility() {
    if (process.env.SCRYPTED_INSTALL_ENVIRONMENT === SCRYPTED_INSTALL_ENVIRONMENT_ANDROID) {
        ensureAndroidCompatibility();
    }
}
