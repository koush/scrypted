import ssl
from socket import setdefaulttimeout
import requests
from requests_toolbelt.adapters import host_header_ssl
from cryptography import x509
from cryptography.x509.oid import ExtensionOID

setdefaulttimeout(5)

def pick_host(hosts, hostname_to_match, endpoint_to_test):
    session = requests.Session()
    session.mount('https://', host_header_ssl.HostHeaderSSLAdapter())

    for host in hosts:
        try:
            c = ssl.get_server_certificate((host, 443))
            c = x509.load_pem_x509_certificate(c.encode("utf-8"))
            if hostname_to_match in c.subject.rfc4514_string() or \
                hostname_to_match in c.extensions.get_extension_for_oid(ExtensionOID.SUBJECT_ALTERNATIVE_NAME).value.get_values_for_type(x509.DNSName):
                r = session.post(f"https://{host}{endpoint_to_test}", headers={"Host": hostname_to_match})
                r.raise_for_status()
                return host
        except Exception as e:
            print(f"{host} is invalid: {e}")
    raise Exception("no valid hosts found!")