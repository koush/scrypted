<template>
    <v-dialog :value="true" persistent max-width="600px">
        <v-form @submit.prevent="doLogin">
            <v-card>
                <v-toolbar dark dense color="deep-purple accent-4">
                    Scrypted Management Console
                </v-toolbar>
                <v-card-text>
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
                                <v-text-field dense v-model="confirmPassword"
                                    v-if="changePassword || $store.state.hasLogin === false" type="password"
                                    label="Confirm Password" :rules="[
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
                    <v-spacer></v-spacer>
                    <v-btn type="submit" text @click.prevent="doLogin">Log In</v-btn>
                </v-card-actions>
            </v-card>
        </v-form>
    </v-dialog>
</template>
<script>
import axios from "axios";
import Vue from "vue";
import store from "./store";
import "./client";
import { loginScrypted } from './client';

export default {
  name: "Launcher",
  methods: {
    doLogin() {
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
      loginScrypted(this.username, this.password, this.confirmPassword || undefined)
        .then((response) => {
          if (response.error) {
            this.loginResult = response.error;
            return;
          }
          window.location.reload();
        })
        .catch((e) => {
          this.loginResult = e.toString();
          // cert may need to be reaccepted? Server is down? Go to the
          // server root to force the network error to bypass the PWA cache.
          if (
            e.toString().includes("Network Error") &&
            window.location.href.startsWith("https:")
          ) {
            window.location = "/";
          }
        });
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
