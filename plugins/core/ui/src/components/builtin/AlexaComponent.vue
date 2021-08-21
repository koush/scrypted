<template>
  <v-layout wrap>
    <v-flex xs12 md6 lg6 v-if="!loading">
      <v-flex>
        <v-card raised class="header-card">
          <v-card-title
            class="orange-gradient subtitle-1 text--white  font-weight-light"
          >Amazon Alexa</v-card-title>

          <div v-if="settings.loginEmail">
            <v-card-text>
              Amazon Alexa can be linked using the Amazon Alexa <a href="https://play.google.com/store/apps/details?id=com.amazon.dee.app&amp;hl=en_US">Android</a> or <a href="https://itunes.apple.com/us/app/amazon-alexa/id944011620?mt=8">iOS</a> application using the following information:
            </v-card-text>
            <v-card-text>Login Email ({{ settings.loginType }}): {{ settings.loginEmail }}</v-card-text>
            <v-card-text>Alexa Skill: Scrypted Home Automation</v-card-text>
          </div>
          <v-card-text v-else>You must enable Remote Management to use Google Home.</v-card-text>
        </v-card>
      </v-flex>
    </v-flex>
  </v-layout>
</template>
<script>
import axios from "axios";
import qs from "query-string";
import { getComponentWebPath } from "../helpers";

export default {
  data() {
    return {
      loading: true,
      settings: {},
      showPasscodeSaved: false,
    };
  },
  computed: {
    componentWebPath() {
      return getComponentWebPath("home");
    },
  },
  methods: {
    refresh() {
      axios.get(`${this.componentWebPath}/settings`).then(response => {
        this.$data.settings = response.data;
        this.loading = false;
      });
    },
    updatePasscode() {
      axios.post(
        `${this.componentWebPath}/`,
        qs.stringify({
          "default-passcode": this.settings["default-passcode"]
        })
      )
      .then(() => this.showPasscodeSaved = true);
    }
  },
  mounted() {
    this.refresh();
  }
};
</script>