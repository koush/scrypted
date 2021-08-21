<template>
  <v-btn text color="primary" @click="onClick">Login</v-btn>
</template>
<script>
import RPCInterface from "./RPCInterface.vue";
import qs from 'query-string';

export default {
  mixins: [RPCInterface],
  methods: {
    onChange() {},
    onClick: function() {
      this.rpc()
        .getOauthUrl()
        .then(data => {
          var url = new URL(data);
          var querystring = qs.parse(url.search.replace("?", ""));
          querystring.redirect_uri = `https://home.scrypted.app/web/oauth/callback`;
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