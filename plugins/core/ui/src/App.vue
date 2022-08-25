<template>
  <v-app>
    <Drawer v-model="$data"></Drawer>

    <v-app-bar app clipped-left>
      <v-app-bar-nav-icon @click.stop="drawer = !drawer"></v-app-bar-nav-icon>

      <v-toolbar-title class="headline text-uppercase" >
        <span style="cursor: pointer" @click="goHome">{{ title }}</span>
      </v-toolbar-title>
      <v-spacer></v-spacer>
      <v-menu left bottom>
        <template v-slot:activator="{ on }">
          <v-btn v-on="on" text>{{ $store.state.username }}</v-btn>
        </template>
        <v-list>
          <v-list-item @click="reload">
            <v-list-item-content>
              <v-list-item-title>Reload</v-list-item-title>
            </v-list-item-content>
          </v-list-item>
          <v-list-item @click="logout">
            <v-list-item-content>
              <v-list-item-title>Logout</v-list-item-title>
            </v-list-item-content>
          </v-list-item>
        </v-list>
      </v-menu>

      <v-btn icon small @click="toggleDarkMode"
        ><v-icon small>fa fa-sun</v-icon></v-btn
      >

      <v-menu left bottom>
        <template v-slot:activator="{ on }">
          <v-btn small icon v-on="on">
            <v-badge
              :value="$store.state.scrypted.alerts.length"
              color="red"
              overlap
            >
              <template v-slot:badge>{{
                $store.state.scrypted.alerts.length
              }}</template>
              <v-icon small>notifications</v-icon>
            </v-badge>
          </v-btn>
        </template>

        <v-list>
          <v-list-item
            v-for="alert in $store.state.scrypted.alerts"
            :key="alert.id"
            @click="doAlert(alert)"
          >
            <v-list-item-icon>
              <v-icon x-small style="color: #a9afbb">{{
                getAlertIcon(alert)
              }}</v-icon>
            </v-list-item-icon>
            <v-list-item-content>
              <v-list-item-title class="caption">{{
                alert.title
              }}</v-list-item-title>
              <v-list-item-subtitle class="caption">{{
                alert.message
              }}</v-list-item-subtitle>
              <v-list-item-subtitle class="caption">{{
                friendlyTime(alert.timestamp)
              }}</v-list-item-subtitle>
            </v-list-item-content>
          </v-list-item>
          <v-divider v-if="$store.state.scrypted.alerts.length"></v-divider>
          <v-list-item v-if="!$store.state.scrypted.alerts.length">
            <v-list-item-content>
              <v-list-item-title class="caption"
                >No notifications.</v-list-item-title
              >
            </v-list-item-content>
          </v-list-item>
          <v-list-item v-else @click="clearAlerts">
            <v-list-item-icon>
              <v-icon x-small style="color: #a9afbb">fa-trash</v-icon>
            </v-list-item-icon>
            <v-list-item-content>
              <v-list-item-title class="caption"
                >Clear All Alerts</v-list-item-title
              >
            </v-list-item-content>
          </v-list-item>
        </v-list>
      </v-menu>

      <v-menu left bottom v-if="$store.state.menu">
        <template v-slot:activator="{ on }">
          <v-btn small icon v-on="on">
            <v-icon small>more_vert</v-icon>
          </v-btn>
        </template>

        <v-list>
          <v-list-item
            v-for="(menuItem, index) in $store.state.menu"
            :key="index"
            @click="menuItem.click"
          >
            <v-list-item-icon v-if="menuItem.icon">
              <v-icon x-small style="color: #a9afbb">{{
                menuItem.icon
              }}</v-icon>
            </v-list-item-icon>
            <v-list-item-content>
              <v-list-item-title class="caption">{{
                menuItem.title
              }}</v-list-item-title>
              <v-list-item-subtitle class="caption">{{
                menuItem.subtitle
              }}</v-list-item-subtitle>
            </v-list-item-content>
          </v-list-item>
        </v-list>
      </v-menu>
    </v-app-bar>

    <Login
      v-if="$store.state.isLoggedIn === false"
    >
    </Login>
    <Reconnect v-else-if="$store.state.isConnected === false" ></Reconnect>


    <v-main elevation="-2">
      <v-container
        grid-list-xs
        grid-list-xl
        grid-list-md
        grid-list-sm
        grid-list-lg
        fluid
      >
        <v-fade-transition mode="out-in">
          <router-view v-if="$store.state.isConnected"></router-view>
        </v-fade-transition>
      </v-container>
    </v-main>
  </v-app>
</template>

<script>
import axios from "axios";
import Drawer from "./components/Drawer.vue";
import { removeAlert, getAlertIcon } from "./components/helpers";
import router from "./router";
import Login from "./Login.vue";
import Reconnect from "./Reconnect.vue";
import store from "./store";

export default {
  name: "App",
  components: {
    Drawer,
    Login,
    Reconnect,
  },
  mounted() {
    if (this.darkMode) this.$vuetify.theme.dark = true;
    this._timer = setInterval(
      function () {
        this.$data.now = Date.now();
      }.bind(this),
      1000
    );
  },
  destroyed: function () {
    clearInterval(this._timer);
  },
  methods: {
    goHome() {
      window.location ='/';
    },
    toggleDarkMode() {
      this.darkMode = !this.darkMode;
      this.$vuetify.theme.dark = this.darkMode;
      localStorage.setItem("darkMode", this.darkMode.toString());
    },
    reload() {
      window.location.reload();
    },
    logout() {
      axios.get("/logout").then(() => window.location.reload());
    },
    async clearAlerts() {
      const alerts = await this.$scrypted.systemManager.getComponent("alerts");
      await alerts.clearAlerts();
    },
    getAlertIcon,
    removeAlert,
    doAlert(alert) {
      this.$router.push(alert.path);
    },
    friendlyTime(timestamp) {
      var date = new Date(parseFloat(timestamp));

      var seconds = Math.floor((this.now - date) / 1000);

      var interval = Math.floor(seconds / 31536000);

      if (interval > 1) {
        return interval + " years ago";
      }
      interval = Math.floor(seconds / 2592000);
      if (interval > 1) {
        return interval + " months ago";
      }
      interval = Math.floor(seconds / 86400);
      if (interval > 1) {
        return interval + " days ago";
      }
      interval = Math.floor(seconds / 3600);
      if (interval > 1) {
        return interval + " hours ago";
      }
      interval = Math.floor(seconds / 60);
      if (interval > 1) {
        return interval + " minutes ago";
      }
      return Math.floor(seconds) + " seconds ago";
    },
    alertConvert(alertPath) {
      return alertPath.replace("/web/", "/");
    },
  },
  created() {
    router.beforeEach((to, from, next) => {
      this.title = to.name || "Scrypted";
      next();
    });
  },
  router,
  store,
  data() {
    const self = this;
    return {
      darkMode: localStorage.getItem("darkMode") === "true",
      now: 0,
      title: "Scrypted",
      drawer: this.$vuetify.breakpoint.lgAndUp,
    };
  },
};
</script>
