import ssl
from socket import setdefaulttimeout
from cryptography import x509
from cryptography.x509.oid import ExtensionOID

setdefaulttimeout(5)

def pick_host(hosts, hostname_to_match):
    for host in hosts:
        try:
            c = ssl.get_server_certificate((host, 443))
            c = x509.load_pem_x509_certificate(c.encode("utf-8"))
            if hostname_to_match in c.subject.rfc4514_string() or \
                hostname_to_match in c.extensions.get_extension_for_oid(ExtensionOID.SUBJECT_ALTERNATIVE_NAME).value.get_values_for_type(x509.DNSName):
                return host
        except:
            print(f"{host} is invalid")
    raise Exception("no valid hosts found!")