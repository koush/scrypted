<template>
  <div>
    <v-card
      raised
      v-if="device.automationType !== 'Scene'"
      style="margin-bottom: 60px"
    >
      <v-card-title
        class="green-gradient subtitle-1 text--white font-weight-light"
      >
        <v-icon x-small>fa-bolt</v-icon>
        <span class="title font-weight-light"
          >&nbsp;&nbsp;Automation Triggers</span
        >
      </v-card-title>

      <v-card-text
        >Specify the events (and optional conditions) that will trigger the
        automation.</v-card-text
      >

      <v-flex xs12>
        <EventsPicker
          :name="device.triggers.name"
          :events="availableEvents"
          :interfaces="availableInterfaces"
          v-model="device.triggers"
          @input="onChange"
        ></EventsPicker>
      </v-flex>
      <v-card-actions>
        <v-spacer></v-spacer>
        <v-btn color="primary" text @click="$emit('save')">
          Save Triggers
        </v-btn>
      </v-card-actions>
    </v-card>

    <v-card raised style="margin-bottom: 60px">
      <v-card-title
        class="green-gradient subtitle-1 text--white font-weight-light"
      >
        <v-icon x-small>fa-play</v-icon>
        <span v-if="device.automationType !== 'Scene'"
          >&nbsp;&nbsp;Automation Actions</span
        >
        <span v-else>&nbsp;&nbsp;Scene Activation Actions</span>
      </v-card-title>

      <v-card-text v-if="device.automationType !== 'Scene'"
        >Specify action(s) to take when the automation is
        triggered.</v-card-text
      >
      <v-card-text v-else
        >Specify action(s) to take when the scene is activated.</v-card-text
      >

      <v-flex xs12>
        <InterfacesPicker
          :name="device.actions.name"
          :interfaces="contextualInterfaces"
          v-model="device.actions"
          @input="onChange"
        ></InterfacesPicker>
      </v-flex>
      <v-card-actions>
        <v-spacer></v-spacer>
        <v-btn color="primary" text @click="$emit('save')">
          Save Actions
        </v-btn>
      </v-card-actions>
    </v-card>

    <v-card raised v-if="device.automationType === 'Scene'">
      <v-card-title
        class="green-gradient subtitle-1 text--white font-weight-light"
      >
        <v-icon x-small>fa-play</v-icon>
        <h5 class="card-title">&nbsp;&nbsp;Scene Deactivation Actions</h5>
      </v-card-title>
      <v-card-text
        >Specify action(s) to take when the scene deactivated.</v-card-text
      >

      <v-flex xs12>
        <InterfacesPicker
          :name="device.deactivateActions.name"
          :interfaces="contextualInterfaces"
          v-model="device.deactivateActions.actions"
          @input="onChange"
        ></InterfacesPicker>
      </v-flex>
      <v-card-actions>
        <v-spacer></v-spacer>
        <v-btn color="primary" text @click="$emit('save')">
          Save Actions
        </v-btn>
      </v-card-actions>
    </v-card>
  </div>
</template>
<script>
import InterfacesPicker from "./InterfacesPicker.vue";
import EventsPicker from "./EventsPicker.vue";
import { ScryptedInterface } from "@scrypted/sdk/types";
import { actionableEvents, actionableInterfaces } from "./interfaces";

const includeContextual = [
  ScryptedInterface.OnOff,
  ScryptedInterface.Lock,
  ScryptedInterface.StartStop,
  ScryptedInterface.Scene,
  ScryptedInterface.Entry,
  ScryptedInterface.TemperatureSetting,
];

export default {
  data() {
    let device;
    try {
      device = JSON.parse(this.value);
    } catch (e) {
      device = {
        triggers: [],
        actions: [],
        staticEvents: false,
        denoiseEvents: false,
        runToCompletion: false,
        automationType: "Automation",
      };
    }

    return {
      device,
    };
  },
  props: ["value", "id"],
  components: {
    InterfacesPicker,
    EventsPicker,
  },
  computed: {
    availableEvents() {
      const ret = [
        {
          id: "scheduler",
          text: "Scheduler",
          component: "Scheduler",
          event: true,
        },
      ];

      for (const id of Object.keys(
        this.$scrypted.systemManager.getSystemState()
      )) {
        const device = this.$scrypted.systemManager.getDeviceById(id);
        for (const iface of [...new Set(device.interfaces)]) {
          if (!actionableEvents.includes(iface)) continue;
          ret.push({
            id: `${id}#${iface}`,
            text: `${device.name} (${iface})`,
            component: iface,
          });
        }
      }
      return ret;
    },
    availableInterfaces() {
      const ret = [
        {
          id: "scriptable",
          text: "Run Javascript",
          component: "Scriptable",
        },
        {
          id: "shell-scriptable",
          text: "Run Shell Script",
          component: "ShellScriptable",
        },
        {
          id: "timer",
          text: "Wait",
          component: "Timer",
        },
        {
          id: 'update-plugins',
          text: 'Update Plugins',
          component: 'UpdatePlugins',
        }
      ];

      for (const id of Object.keys(
        this.$scrypted.systemManager.getSystemState()
      )) {
        const device = this.$scrypted.systemManager.getDeviceById(id);
        for (const iface of [...new Set(device.interfaces)]) {
          if (!actionableInterfaces.includes(iface)) continue;
          ret.push({
            id: `${id}#${iface}`,
            text: `${device.name} (${iface})`,
            component: iface,
          });
        }
      }
      return ret;
    },
    contextualInterfaces: {
      get: function () {
        return this.availableInterfaces;

        var ret = [];
        var triggeredEvents = {};
        for (var trigger of this.device.triggers.triggers) {
          trigger = this.mappedEvents[trigger.id];
          if (!trigger || !trigger.component) continue;
          triggeredEvents[trigger.component] = trigger.component;
        }
        var contextual = Object.values(triggeredEvents)
          .filter((component) => includeContextual.includes(component))
          .map((component) => ({
            component: component,
            id: `AutomationTrigger#${component}`,
            properties: {},
            text: `Automation Trigger (${component})`,
            action: true,
          }));
        Array.prototype.push.apply(ret, contextual);
        Array.prototype.push.apply(
          ret,
          this.deviceProps.automationData.interfaces
        );
        return ret;
      },
    },
  },
  methods: {
    onChange() {
      this.$emit("input", JSON.stringify(this.device));
    },
  },
};
</script>
