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
      const pc = (this.pc = new RTCPeerConnection());

      pc.ontrack = (ev) => {
        if (ev.track.kind === "audio") {
          console.log("received audio track", ev.track);
          const mediaStream = new MediaStream([ev.track]);
          const remoteAudio = document.createElement("audio");
          remoteAudio.srcObject = mediaStream;
          remoteAudio.play();
        }
      };

      await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      const localSession = new BrowserSignalingSession(this.pc);
      const remoteSession = await this.rpc().createRTCSignalingSession();
      connectRTCSignalingClients(
        localSession,
        {
          audio: {
            direction: "sendrecv",
          },
          video: {
            direction: "sendrecv",
          },
          type: "offer",
        },
        remoteSession,
        {
          audio: {
            direction: "sendrecv",
          },
          video: {
            direction: "sendrecv",
          },
          type: "answer",
        }
      );
    },
  },
};
</script>
