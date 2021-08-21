<template>
  <div>
    <div>Webhook Address:</div>
    <a target="webhook" :href="webhookAddress">{{ webhookAddress }}</a>
  </div>
</template>
<script>
import RPCInterface from "../RPCInterface.vue";
import cloneDeep from "lodash/cloneDeep";

function makeid(length) {
  var result = "";
  var characters =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  var charactersLength = characters.length;
  for (var i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
}

export default {
  mixins: [RPCInterface],
  computed: {
    webhookAddress() {
      var url = new URL(
        `/endpoint/webhook/public/?id=${this.lazyValue.webhookId}`,
        window.location.toString()
      );
      return url.toString();
    }
  },
  methods: {
    createLazyValue() {
      var ret = cloneDeep(this.value);
      if (!ret.webhookId) {
        ret.rpc = undefined;
        ret.webhookId = makeid(16);
      }
      return ret;
    },
    onChange() {
      this.rpc().listenWebhook(this.lazyValue.webhookId);
    }
  }
};
</script>