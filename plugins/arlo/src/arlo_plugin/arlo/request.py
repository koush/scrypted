##
# Copyright 2016 Jeffrey D. Walter
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#    http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
##

from functools import partialmethod
import requests
from requests.exceptions import HTTPError
from requests_toolbelt.adapters import host_header_ssl
import cloudscraper
from curl_cffi import requests as curl_cffi_requests
import time
import uuid

from .logging import logger



#from requests_toolbelt.utils import dump
#def print_raw_http(response):
#    data = dump.dump_all(response, request_prefix=b'', response_prefix=b'')
#    print('\n' * 2 + data.decode('utf-8'))

class Request(object):
    """HTTP helper class"""

    def __init__(self, timeout=5, mode="curl"):
        if mode == "curl":
            logger.debug("HTTP helper using curl_cffi")
            self.session = curl_cffi_requests.Session(impersonate="chrome110")
        elif mode == "cloudscraper":
            logger.debug("HTTP helper using cloudscraper")
            from .arlo_async import USER_AGENTS
            self.session = cloudscraper.CloudScraper(browser={"custom": USER_AGENTS["android"]})
        elif mode == "ip":
            logger.debug("HTTP helper using requests with HostHeaderSSLAdapter")
            self.session = requests.Session()
            self.session.mount('https://', host_header_ssl.HostHeaderSSLAdapter())
        else:
            logger.debug("HTTP helper using requests")
            self.session = requests.Session()
        self.timeout = timeout

    def gen_event_id(self):
        return f'FE!{str(uuid.uuid4())}'

    def get_time(self):
        return int(time.time_ns() / 1_000_000)

    def _request(self, url, method='GET', params={}, headers={}, raw=False, skip_event_id=False):

        ## uncomment for debug logging
        """
        import logging
        import http.client
        http.client.HTTPConnection.debuglevel = 1
        #logging.basicConfig()
        logging.getLogger().setLevel(logging.DEBUG)
        req_log = logging.getLogger('requests.packages.urllib3')
        req_log.setLevel(logging.DEBUG)
        req_log.propagate = True
        #"""

        if not skip_event_id:
            url = f'{url}?eventId={self.gen_event_id()}&time={self.get_time()}'

        if method == 'GET':
            #print('COOKIES: ', self.session.cookies.get_dict())
            r = self.session.get(url, params=params, headers=headers, timeout=self.timeout)
            r.raise_for_status()
        elif method == 'PUT':
            r = self.session.put(url, json=params, headers=headers, timeout=self.timeout)
            r.raise_for_status()
        elif method == 'POST':
            r = self.session.post(url, json=params, headers=headers, timeout=self.timeout)
            r.raise_for_status()
        elif method == 'OPTIONS':
            r = self.session.options(url, headers=headers, timeout=self.timeout)
            r.raise_for_status()
            return

        body = r.json()

        if raw:
            return body
        else:
            if ('success' in body and body['success'] == True) or ('meta' in body and body['meta']['code'] == 200):
                if 'data' in body:
                    return body['data']
            else:
                raise HTTPError('Request ({0} {1}) failed: {2}'.format(method, url, r.json()), response=r)

    def get(self, url, **kwargs):
        return self._request(url, 'GET', **kwargs)

    def put(self, url, **kwargs):
        return self._request(url, 'PUT', **kwargs)

    def post(self, url, **kwargs):
        return self._request(url, 'POST', **kwargs)

    def options(self, url, **kwargs):
        return self._request(url, 'OPTIONS', **kwargs)
