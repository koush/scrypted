import ssl
from socket import setdefaulttimeout
import requests
from requests_toolbelt.adapters import host_header_ssl
import scrypted_arlo_go

from .logging import logger


setdefaulttimeout(15)


def pick_host(hosts, hostname_to_match, endpoint_to_test):
    setdefaulttimeout(5)

    try:
        session = requests.Session()
        session.mount('https://', host_header_ssl.HostHeaderSSLAdapter())

        for host in hosts:
            try:
                c = ssl.get_server_certificate((host, 443))
                scrypted_arlo_go.VerifyCertHostname(c, hostname_to_match)
                r = session.post(f"https://{host}{endpoint_to_test}", headers={"Host": hostname_to_match})
                r.raise_for_status()
                return host
            except Exception as e:
                logger.warning(f"{host} is invalid: {e}")
        raise Exception("no valid hosts found!")
    finally:
        setdefaulttimeout(15)
