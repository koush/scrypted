<template>
  <div>
    <v-dialog v-model="loginDialog" max-width="300px">
      <v-card>
        <v-card-title>Login Required</v-card-title>
        <v-card-text>Scrypted Management Console is currently inside a browser iframe. For web security, a new tab will be
          opened, and the
          browser may prompt to log into this server again.
          <br />
          <br />
          <b>Home Assistant Addon installations must create a new Administrator user</b> within the Scrypted Users sidebar menu to log in from outside of Home Assistant.
        </v-card-text>
        <v-card-actions>
          <v-spacer>
          </v-spacer>
          <v-btn icon @click="loginDialog = false">Cancel</v-btn>
          <v-btn icon @click="onClickContinue">OK</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
    <v-btn text color="primary" @click="onClick">Login</v-btn>
  </div>
</template>
<script>
import qs from 'query-string';
import RPCInterface from "./RPCInterface.vue";

export default {
  mixins: [RPCInterface],
  data() {
    return {
      loginDialog: false,
    };
  },
  methods: {
    onChange() { },
    isIFrame() {
      try {
        return window.self !== window.top;
      } catch (e) {
        return true;
      }
    },
    onClickContinue: async function () {
      const endpointManager = this.$scrypted.endpointManager;
      const ep = await endpointManager.getPublicLocalEndpoint();
      const u = new URL(ep);
      u.hash = window.location.hash;
      u.pathname = '/endpoint/@scrypted/core/public/';
      window.open(u.toString(), '_blank');
    },
    onClick: async function () {
      // must escape iframe for login.
      if (this.isIFrame()) {
        this.loginDialog = true;
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