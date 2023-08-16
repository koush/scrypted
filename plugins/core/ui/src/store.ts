
import Vue from "vue";
import Vuex from "vuex";
Vue.use(Vuex);

const store = new Vuex.Store({
  state: {
    version: undefined,
    menu: undefined,
    systemState: {},
    scrypted: {
      devices: [],
      alerts: []
    },
    username: undefined,
    isLoggedIn: undefined,
    isLoggedIntoCloud: undefined,
    isConnected: undefined,
    hasLogin: undefined,
    loginHostname: undefined,
  },
  mutations: {
    setSystemState: function (store, systemState) {
      store.systemState = systemState;
    },
    setDevices(store, devices) {
      store.scrypted.devices = devices;
    },
    setAlerts(store, alerts) {
      store.scrypted.alerts = alerts;
    },
    removeAlert(store, alertId) {
      store.scrypted.alerts = store.scrypted.alerts.filter(
        alert => alert._id != alertId
      );
    },
    addAlert(store, alert) {
      const alerts = store.scrypted.alerts.filter(
        existing => existing.id != alert.id
      );
      alerts.push(alert);
      store.scrypted.alerts = alerts;
    },
    addDevice(store, id) {
      var devices = store.scrypted.devices.filter(device => device !== id);
      devices.push(id);
      store.scrypted.devices = devices;
    },
    removeDevice(store, id) {
      store.scrypted.devices = store.scrypted.devices.filter(
        device => device !== id
      );
    },
    setIsLoggedIntoCloud(store, isLoggedIntoCloud) {
      store.isLoggedIntoCloud = isLoggedIntoCloud;
    },
    setIsLoggedIn(store, isLoggedIn) {
      store.isLoggedIn = isLoggedIn;
    },
    setUsername(store, username) {
      store.username = username;
    },
    setIsConnected(store, isConnected) {
      store.isConnected = isConnected;
    },
    setHasLogin(store, hasLogin) {
      store.hasLogin = hasLogin;
    },
    setLoginHostname(store, hostname) {
      store.loginHostname = hostname;
    },
    setVersion(store, version) {
      store.version = version;
    },
    setMenu(store, menu) {
      Vue.set(store, 'menu', menu);
    },
    clearMenu(store) {
      Vue.delete(store, 'menu');
    }
  }
});

export interface Menu {
  title: string;
  subtitle?: string;
  icon?: string;
  click: Function;
}

export default store;