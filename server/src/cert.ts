// import libraries
import forge from 'node-forge';
import crypto from 'crypto';

const { pki } = forge;


export const CURRENT_SELF_SIGNED_CERTIFICATE_VERSION = 'v2';

export function createSelfSignedCertificate() {

    // generate a keypair and create an X.509v3 certificate
    const keys = pki.rsa.generateKeyPair(2048);
    const cert = pki.createCertificate();
    cert.publicKey = keys.publicKey;

    // NOTE: serialNumber is the hex encoded value of an ASN.1 INTEGER.
    // Conforming CAs should ensure serialNumber is:
    // - no more than 20 octets
    // - non-negative (prefix a '00' if your value starts with a '1' bit)
    cert.serialNumber = '01' + crypto.randomBytes(19).toString("hex"); // 1 octet = 8 bits = 1 byte = 2 hex chars
    cert.validity.notBefore = new Date();
    cert.validity.notAfter = new Date();
    cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1); // adding 1 year of validity from now
    const attrs = [{
        name: 'commonName',
        value: 'localhost'
    }];
    cert.setSubject(attrs);
    cert.setIssuer(attrs);
    cert.setExtensions([{
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
    cert.sign(keys.privateKey);
    return {
        serviceKey: pki.privateKeyToPem(keys.privateKey),
        certificate: pki.certificateToPem(cert),
        version: CURRENT_SELF_SIGNED_CERTIFICATE_VERSION,
    };
}
