<template>
  <v-btn text color="primary" @click="onClick">Login</v-btn>
</template>
<script>
import qs from 'query-string';
import RPCInterface from "./RPCInterface.vue";

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
    onClick: function () {
      // https://stackoverflow.com/a/39387533
      const windowReference = this.isIFrame() ? window.open(undefined, '_blank') : undefined;
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
              u = new URL(redirect_uri, window.location.href);
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
          if (windowReference)
            windowReference.location = url.toString();
          else
            window.location = url.toString();
        });
    }
  }
};
</script>