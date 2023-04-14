import Vue from 'vue';
import './plugins/icons';
import vuetify from './plugins/vuetify';
import './plugins/script2';
import './plugins/clipboard';
import './plugins/maps';
import './plugins/async-computed';
import './plugins/apexcharts';
import './plugins/is-mobile';
import Launcher from './Launcher.vue'
import './registerServiceWorker'

import VCalendar from 'v-calendar';

// Use v-calendar & v-date-picker components
Vue.use(VCalendar, {
  componentPrefix: 'vc',  // Use <vc-calendar /> instead of <v-calendar />
});

// STYLES
// Main Theme SCSS
// import './assets/scss/theme.scss'

Vue.directive('linkified', require('vue-linkify'))

Vue.config.productionTip = false

new Vue({
  render: h => h(Launcher),
  vuetify,
}).$mount('#app')
