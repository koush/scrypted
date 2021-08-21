<template>
  <v-layout wrap>
    <v-flex xs12 md6 lg6 v-if="!loading">
      <v-flex>
        <v-card raised class="header-card">
          <v-card-title
            class="orange-gradient subtitle-1 text--white  font-weight-light"
          >Google Home</v-card-title>

          <div v-if="settings.loginEmail">
            <v-card-text>
              Google Home can be linked with the Google Home
              <a
                href="https://play.google.com/store/apps/details?id=com.google.android.apps.chromecast.app&amp;hl=en_US"
              >Android</a> or
              <a href="https://itunes.apple.com/us/app/google-home/id680819774?mt=8">iOS</a> application using the following information:
            </v-card-text>
            <v-card-text>Login Email ({{ settings.loginType }}): {{ settings.loginEmail }}</v-card-text>
            <v-card-text>Google Home Service: Scrypted Home Automation</v-card-text>
          </div>
          <v-card-text v-else>You must enable Remote Management to use Google Home.</v-card-text>
        </v-card>
      </v-flex>
    </v-flex>

    <v-flex xs12 v-if="!loading && settings.loginEmail">
      <v-flex xs12 sm6 md6 lg4>
        <v-card raised class="header-card">
          <v-card-title
            class="green-gradient subtitle-1  font-weight-light"
          >Default Passcode</v-card-title>
          <v-form>
            <v-container>
              <v-layout>
                <v-flex>
                  <v-text-field
                    label="Default Passcode"
                    v-model="settings['default-passcode']"
                    persistent-hint
                    hint="The default passcode to use on security devices such as locks and garage doors. Must be 4 or 6 digits."
                  ></v-text-field>
                </v-flex>
              </v-layout>
            </v-container>
          </v-form>

          <v-card-actions>
            <v-spacer></v-spacer>
            <v-btn outlined color="green" @click="updatePasscode">Update Passcode</v-btn>
          </v-card-actions>
        </v-card>
        <v-alert
          v-model="showPasscodeSaved"
          dismissible
          dark
          color="green-gradient"
        >Passcode updated.</v-alert>
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
      showPasscodeSaved: false
    };
  },
  computed: {
    componentWebPath() {
      return getComponentWebPath("home");
    }
  },
  methods: {
    refresh() {
      axios.get(`${this.componentWebPath}/settings`).then(response => {
        this.$data.settings = response.data;
        this.loading = false;
      });
    },
    updatePasscode() {
      axios
        .post(
          `${this.componentWebPath}/`,
          qs.stringify({
            "default-passcode": this.settings["default-passcode"]
          })
        )
        .then(() => (this.showPasscodeSaved = true));
    }
  },
  mounted() {
    this.refresh();
  }
};
</script>