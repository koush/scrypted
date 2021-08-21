import '@fortawesome/fontawesome-free/css/all.css'
import Vue from 'vue'
import Vuetify, {
} from 'vuetify/lib'
import 'vuetify/dist/vuetify.min.css'
Vue.use(Vuetify)

import Vuex from 'vuex'
Vue.use(Vuex)

import VueRouter from 'vue-router'
Vue.use(VueRouter)

export default new Vuetify({
  icons: {
    iconfont: 'fa'
  }
})