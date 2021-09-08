import VueRouter from "vue-router";

import Device from "./components/Device.vue";
import Devices from "./components/Devices.vue";
import AggregateComponent from "./components/aggregate/AggregateComponent.vue";
import AutomationComponent from "./components/automation/AutomationComponent.vue";
import ScriptComponent from "./components/script/ScriptComponent.vue";
import PluginComponent from "./components/plugin/PluginComponent.vue";
import InstallPlugin from "./components/plugin/InstallPlugin.vue";
import LogComponent from "./components/builtin/LogComponent.vue";
import SettingsComponent from "./components/builtin/SettingsComponent.vue";
import Dashboard from "./components/dashboard/Dashboard.vue";

let router = new VueRouter({
    routes: [
      {
        path: "/device",
        component: Devices
      },
      // {
      //   path: "/",
      //   component: Devices
      // },
      {
        path: "/",
        component: Dashboard
      },
      {
        path: "/component/automation",
        component: AutomationComponent
      },
      {
        path: "/component/plugin",
        component: PluginComponent
      },
      {
        path: "/component/script",
        component: ScriptComponent
      },
      {
        path: "/component/plugin/install",
        component: InstallPlugin
      },
      {
        path: "/component/aggregate",
        component: AggregateComponent
      },
      {
        path: "/component/settings",
        component: SettingsComponent
      },
      {
        path: "/component/log/:path*",
        component: LogComponent
      },
      {
        path: "/device/:id",
        component: Device
      }
    ]
  });
  
  export default router;