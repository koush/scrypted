'use strict';

const url = require('url')
  , axios = require('axios')
  , Transport = require('node-hue-api/lib/api/http/Transport')
  , Api = require('node-hue-api/lib/api/Api')
;

const DEBUG = /node-hue-api/.test(process.env.NODE_DEBUG);

/**
 * @typedef {import('./Api)} Api
 * @type {LocalBootstrap}
 */
module.exports = class LocalBootstrap {

  /**
   * Create a Local Netowrk Bootstrap for connecting to the Hue Bridge. The connection is ALWAYS over TLS/HTTPS.
   *
   * @param {String} hostname The hostname or ip address of the hue bridge on the lcoal network.
   * @param {number=} port The port number for the connections, defaults to 443 and should not need to be specified in the majority of use cases.
   */
  constructor(hostname, port) {
    this._baseUrl = url.format({protocol: 'https', hostname: hostname, port: port || 443});
    this._hostname = hostname;
  }

  /**
   * Gets the Base URL for the local connection to the bridge.
   * @returns {String}
   */
  get baseUrl() {
    return this._baseUrl;
  }

  /**
   * Gets the hostname being used to connect to the hue bridge (ip address or fully qualified domain name).
   * @returns {String}
   */
  get hostname() {
    return this._hostname;
  }

  /**
   * Connects to the Hue Bridge using the local network.
   *
   * The connection will perform checks on the Hue Bridge TLS Certificate to verify it is correct before sending any
   * sensitive information.
   *
   * @param {String=} username The username to use when connecting, can be null, but will severely limit the endpoints that you can call/access
   * @param {String=} clientkey The clientkey for the user, used by the entertainment API, can be null
   * @param {Number=} timeout The timeout for requests sent to the Hue Bridge. If not set will default to 20 seconds.
   * @returns {Promise<Api>} The API for interacting with the hue bridge.
   */
  connect(username, clientkey, timeout) {
    const self = this
      , hostname = self.hostname
      , baseUrl = self.baseUrl
    ;

    return axios.get(`${baseUrl}/api/config`)
      .then(res => {
        const bridgeId = res.data.bridgeid.toLowerCase();

        const apiBaseUrl = `${baseUrl}/api`
        , transport = new Transport(username, axios.create({baseURL: apiBaseUrl}))
        , config = {
          remote: false,
          baseUrl: apiBaseUrl,
          clientkey: clientkey,
          username: username,
        }
      ;

      return new Api(config, transport);

      });
  }
};

function getTimeout(timeout) {
  return timeout || 20000;
}
