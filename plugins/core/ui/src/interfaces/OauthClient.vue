<template>
  <v-btn text color="primary" @click="onClick">Login</v-btn>
</template>
<script>
import qs from 'query-string';
import RPCInterface from "./RPCInterface.vue";
import { getCurrentBaseUrl } from '../../../../../packages/client/src';

export default {
  mixins: [RPCInterface],
  methods: {
    onChange() { },
    isIFrame() {
      try {
        return window.self !== window.top;
      } catch (e) {
        return true;
      }
    },
    onClick: async function () {
      // must escape iframe for login.
      if (this.isIFrame()) {
        const endpointManager = this.$scrypted.endpointManager;
        const ep = await endpointManager.getPublicLocalEndpoint();
        const u = new URL(ep);
        u.hash = window.location.hash;
        u.pathname = '/endpoint/@scrypted/core/public/';
        window.open(u.toString(), '_blank');
        return;
      }

      this.rpc()
        .getOauthUrl()
        .then(data => {
          var url = new URL(data);
          var querystring = qs.parse(url.search.replace("?", ""));
          let { redirect_uri } = querystring;
          if (redirect_uri) {
            let u;
            try {
              u = new URL(redirect_uri);
            }
            catch (e) {
              const baseURI = new URL(document.baseURI);
              const scryptedRootURI = new URL('../../../../', baseURI);
              u = new URL('.' + redirect_uri, scryptedRootURI);
              u.hostname = 'localhost';
            }
            if (u.hostname === 'localhost') {
              u.hostname = new URL(window.location.href).hostname;
              redirect_uri = u.toString();
            }
          }
          else {
            redirect_uri = `https://home.scrypted.app/web/oauth/callback`;
          }
          querystring.redirect_uri = redirect_uri;
          querystring.state = JSON.stringify({
            d: this.device.id,
            s: querystring.state,
            r: window.location.toString(),
          });
          url.search = qs.stringify(querystring);
          window.location = url.toString();
        });
    }
  }
};
</script>