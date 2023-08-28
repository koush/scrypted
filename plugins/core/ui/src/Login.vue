<template>
  <v-dialog :value="true" persistent max-width="300px">
    <v-form @submit.prevent="doLogin">
      <v-card>
        <v-card-text>
          <v-card-title style="justify-content: center;" class="headline text-uppercase">Scrypted
          </v-card-title>
          <v-card-subtitle v-if="$store.state.hasLogin === false" style="display: flex; justify-content: center;" class="text-uppercase">Create Account
          </v-card-subtitle>
          <v-card-subtitle v-if="$store.state.loginHostname"
                    style="text-align: center; font-weight: 300; font-size: .75rem !important; font-family: Quicksand, sans-serif!important;"
                    class="text-subtitle-2 text-uppercase">Log into: {{ $store.state.loginHostname }}</v-card-subtitle>
          <v-container grid-list-md>
            <v-layout wrap>
              <v-flex xs12>
                <v-text-field dense outlined v-model="username" label="User Name"></v-text-field>
                <v-text-field dense outlined v-model="password" type="password" label="Password">
                </v-text-field>
                <v-checkbox dense v-if="$store.state.hasLogin === true" v-model="changePassword"
                  label="Change Password"></v-checkbox>
                <v-text-field dense outlined v-model="newPassword" v-if="changePassword" type="password"
                  label="New Password"></v-text-field>
                <v-text-field dense outlined v-model="confirmPassword"
                  v-if="changePassword || $store.state.hasLogin === false" type="password" label="Confirm Password"
                  :rules="[
                    (
                      changePassword
                        ? confirmPassword !== newPassword
                        : confirmPassword !== password
                    )
                      ? 'Passwords do not match.'
                      : true,
                  ]"></v-text-field>
              </v-flex>
            </v-layout>
            <div v-if="loginResult">{{ loginResult }}</div>
          </v-container>
        </v-card-text>
        <v-card-actions>
          <v-tooltip bottom>
            <template v-slot:activator="{ on }">
              <v-btn v-on="on" icon href="https://discord.gg/DcFzmBHYGq">
                <v-icon small>fab fa-discord</v-icon>
              </v-btn>
            </template>
            <span>Discord</span>
          </v-tooltip>

          <v-tooltip bottom>
            <template v-slot:activator="{ on }">
              <v-btn v-on="on" icon href="https://www.reddit.com/r/Scrypted/">
                <v-icon small>fab fa-reddit</v-icon>
              </v-btn>
            </template>
            <span>Reddit</span>
          </v-tooltip>

          <v-tooltip bottom>
            <template v-slot:activator="{ on }">
              <v-btn v-on="on" icon href="https://github.com/koush/scrypted">
                <v-icon small>fab fa-github</v-icon>
              </v-btn>
            </template>
            <span>Github</span>
          </v-tooltip>

          <v-spacer></v-spacer>
          <v-btn type="submit" text @click.prevent="doLogin">Log In</v-btn>
        </v-card-actions>
      </v-card>
    </v-form>
  </v-dialog>
</template>
<script>
import store from "./store";
import "./client";
import { loginScrypted } from './client';

export default {
  name: "Login",
  methods: {
    async doLogin() {
      const body = {
        username: this.username,
        password: this.password,
      };

      if (this.changePassword || this.$store.state.hasLogin === false) {
        if (
          this.$store.state.hasLogin === false &&
          this.password !== this.confirmPassword
        ) {
          this.loginResult = "Passwords do not match.";
          return;
        } else if (
          this.changePassword &&
          this.newPassword !== this.confirmPassword
        ) {
          this.loginResult = "Passwords do not match.";
          return;
        }
        body.change_password = this.confirmPassword;
      }

      this.loginResult = "";
      try {
        const response = await loginScrypted(this.username, this.password, this.confirmPassword || undefined);
        if (response.error) {
          this.loginResult = response.error;
          return;
        }
        try {
          const redirect_uri = new URL(window.location).searchParams.get('redirect_uri');
          if (redirect_uri) {
            window.location = redirect_uri;
            return;
          }

        }
        catch (e) {

        }
        window.location.reload();
      }
      catch (e) {
        this.loginResult = e.toString();
        // cert may need to be reaccepted? Server is down? Go to the
        // server root to force the network error to bypass the PWA cache.
        if (
          e.toString().includes("Network Error") &&
          window.location.href.startsWith("https:")
        ) {
          window.location = "/";
        }
      }
    },
  },
  store,
  data() {
    const self = this;
    return {
      changePassword: false,
      username: null,
      password: null,
      confirmPassword: null,
      newPassword: null,
      loginResult: undefined,
      passwordRules: [
        () => {
          if (self.password != self.confirmPassword && self.changePassword) {
            return "Passwords do not match.";
          }
          return true;
        },
      ],
    };
  },
};
</script>
