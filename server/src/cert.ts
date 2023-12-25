// import libraries
import forge from 'node-forge';
import crypto from 'crypto';

const { pki } = forge;


export const CURRENT_SELF_SIGNED_CERTIFICATE_VERSION = 'v2';
const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000;

export interface SelfSignedCertificate {
    serviceKey: string;
    certificate: string;
    version: string,
};

export function createSelfSignedCertificate(existing?: SelfSignedCertificate): SelfSignedCertificate {
    let serviceKey: ReturnType<typeof pki.privateKeyFromPem>;
    // check if existing key is usable
    if (existing?.certificate && existing?.serviceKey && existing?.version === CURRENT_SELF_SIGNED_CERTIFICATE_VERSION) {
        try {
            const certificate = pki.certificateFromPem(existing.certificate);
            if (certificate.validity.notAfter.getTime() > Date.now() + SIXTY_DAYS_MS)
                return existing;
            serviceKey = pki.privateKeyFromPem(existing.serviceKey);
        }
        catch (e) {
        }
    }

    const certificate = pki.createCertificate();

    if (existing?.serviceKey) {
        certificate.publicKey = pki.rsa.setPublicKey(serviceKey.n, serviceKey.e);
    }
    else {
        // generate a keypair and create an X.509v3 certificate
        const keys = pki.rsa.generateKeyPair(2048);
        serviceKey = keys.privateKey;
        certificate.publicKey = keys.publicKey;
    }


    // NOTE: serialNumber is the hex encoded value of an ASN.1 INTEGER.
    // Conforming CAs should ensure serialNumber is:
    // - no more than 20 octets
    // - non-negative (prefix a '00' if your value starts with a '1' bit)
    certificate.serialNumber = '01' + crypto.randomBytes(19).toString("hex"); // 1 octet = 8 bits = 1 byte = 2 hex chars
    certificate.validity.notBefore = new Date();
    certificate.validity.notAfter = new Date();
    certificate.validity.notAfter.setFullYear(certificate.validity.notBefore.getFullYear() + 5); // adding 5 years of validity from now
    const attrs = [{
        name: 'commonName',
        value: 'localhost'
    }];
    certificate.setSubject(attrs);
    certificate.setIssuer(attrs);
    certificate.setExtensions([{
        name: 'basicConstraints',
        cA: true
    }, {
        name: 'keyUsage',
        keyCertSign: true,
        digitalSignature: true,
        nonRepudiation: true,
        keyEncipherment: true,
        dataEncipherment: true
    }, {
        name: 'extKeyUsage',
        serverAuth: true,
        clientAuth: true,
        codeSigning: true,
        emailProtection: true,
        timeStamping: true
    }, {
        name: 'nsCertType',
        client: true,
        server: true,
        email: true,
        objsign: true,
        sslCA: true,
        emailCA: true,
        objCA: true
    }, {
        name: 'subjectAltName',
        altNames: [{
            type: 7, // IP
            ip: '127.0.0.1'
        }]
    }, {
        name: 'subjectKeyIdentifier'
    }]);

    // self-sign certificate
    certificate.sign(serviceKey);
    return {
        serviceKey: pki.privateKeyToPem(serviceKey),
        certificate: pki.certificateToPem(certificate),
        version: CURRENT_SELF_SIGNED_CERTIFICATE_VERSION,
    };
}
