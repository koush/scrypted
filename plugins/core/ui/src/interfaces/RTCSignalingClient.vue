<template>
  <v-container>
    <v-btn block @click="streamCamera">Stream Web Camera</v-btn>
  </v-container>
</template>
<script>
import RPCInterface from "./RPCInterface.vue";
import {
  BrowserSignalingSession,
  connectRTCSignalingClients,
} from "@scrypted/common/src/rtc-signaling";

export default {
  mixins: [RPCInterface],
  data() {
    return {
      pc: null,
    };
  },
  destroyed() {
    this.cleanupPeerConnection();
  },
  methods: {
    cleanupPeerConnection() {
      this.pc?.close();
      this.pc = undefined;
    },
    async streamCamera() {
      this.cleanupPeerConnection();
      this.pc = new RTCPeerConnection();
      await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      const localSession = new BrowserSignalingSession(this.pc);
      const remoteSession = await this.rpc().createRTCSignalingSession();
      connectRTCSignalingClients(
        localSession,
        {
          audio: {
            direction: "sendonly",
          },
          video: {
            direction: "sendonly",
          },
          type: "offer",
        },
        remoteSession,
        {
          audio: {
            direction: "recvonly",
          },
          video: {
            direction: "recvonly",
          },
          type: "answer",
        }
      );
    },
  },
};
</script>
