import VueRouter from "vue-router";

import Device from "./components/Device.vue";
import Devices from "./components/Devices.vue";
import AggregateComponent from "./components/aggregate/AggregateComponent.vue";
import AutomationComponent from "./components/automation/AutomationComponent.vue";
import WebPushComponent from "./components/webpush/WebPushComponent.vue";
import ScriptComponent from "./components/script/ScriptComponent.vue";
import InstallPlugin from "./components/script/InstallPlugin.vue";
import RemoteManagementComponent from "./components/builtin/RemoteManagementComponent.vue";
import LogComponent from "./components/builtin/LogComponent.vue";
import GoogleHomeComponent from "./components/builtin/GoogleHomeComponent.vue";
import AlexaComponent from "./components/builtin/AlexaComponent.vue";
import HomeKitComponent from "./components/builtin/HomeKitComponent.vue";
import MailComponent from "./components/mail/MailComponent.vue";
import SettingsComponent from "./components/builtin/SettingsComponent.vue";
import Zwave from "./components/zwave/Zwave.vue";
import Dashboard from "./components/dashboard/Dashboard.vue";

let router = new VueRouter({
    routes: [
      {
        path: "/device",
        component: Devices
      },
      {
        path: "/",
        component: Devices
      },
      // {
      //   path: "/",
      //   component: Dashboard
      // },
      {
        path: "/component/automation",
        component: AutomationComponent
      },
      {
        path: "/component/script",
        component: ScriptComponent
      },
      {
        path: "/component/script/install",
        component: InstallPlugin
      },
      {
        path: "/component/aggregate",
        component: AggregateComponent
      },
      {
        path: "/component/webpush",
        component: WebPushComponent
      },
      {
        path: "/component/remote",
        component: RemoteManagementComponent
      },
      {
        path: "/component/home",
        component: GoogleHomeComponent
      },
      {
        path: "/component/homekit",
        component: HomeKitComponent
      },
      {
        path: "/component/alexa",
        component: AlexaComponent
      },
      {
        path: "/component/settings",
        component: SettingsComponent
      },
      {
        path: "/component/mail",
        component: MailComponent
      },
      {
        path: "/component/zwave",
        component: Zwave,
        children: Zwave.childRoutes
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