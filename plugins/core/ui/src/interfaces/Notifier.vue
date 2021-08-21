<template>
  <v-form>
    <v-container>
      <v-layout>
        <v-flex xs12>
          <v-text-field
            label="Notification Title"
            outlined
            v-model="lazyValue.notificationTitle"
            @input="onChange"
          ></v-text-field>
          <v-text-field
            label="Notification Body"
            outlined
            v-model="lazyValue.notificationBody"
            @input="onChange"
          ></v-text-field>
          <v-text-field
            label="Notification Media URL"
            outlined
            v-model="lazyValue.notificationMediaUrl"
            @input="onChange"
          ></v-text-field>
          <v-text-field
            label="Notification Media Mime Type"
            outlined
            v-model="lazyValue.notificationMediaMime"
            @input="onChange"
          ></v-text-field>
        </v-flex>
      </v-layout>
    </v-container>
    <v-card-actions v-if="device">
      <v-spacer></v-spacer>
      <v-btn text @click="send">Send</v-btn>
    </v-card-actions>
  </v-form>
</template>

<script>
import RPCInterface from "./RPCInterface.vue";
import cloneDeep from "lodash/cloneDeep";

export default {
  mixins: [RPCInterface],
  methods: {
    ensureString(str, def) {
      return str === undefined ? def : str;
    },
    update() {
      if (this.lazyValue.notificationMediaUrl.length) {
        this.rpc().sendNotification(
          this.lazyValue.notificationTitle,
          this.lazyValue.notificationBody,
          this.lazyValue.notificationMediaUrl,
          this.lazyValue.notificationMediaMime
        );
      } else {
        this.rpc().sendNotification(
          this.lazyValue.notificationTitle,
          this.lazyValue.notificationBody
        );
      }
    },
    createLazyValue() {
      var ret = cloneDeep(this.value);
      ret.notificationTitle = this.ensureString(
        ret.notificationTitle,
        "Scrypted Notification"
      );
      ret.notificationBody = this.ensureString(
        ret.notificationBody,
        "This is a message from Scrypted"
      );
      ret.notificationMediaUrl = this.ensureString(
        ret.notificationMediaUrl,
        "https://home.scrypted.app/_punch/web_hi_res_512.png"
      );
      ret.notificationMediaMime = this.ensureString(
        ret.notificationMediaMime,
        "image/png"
      );
      return ret;
    },
    onChange: function() {
      if (this.device) {
        return;
      }
      this.update();
    },
    send() {
      this.update();
    }
  }
};
</script>
