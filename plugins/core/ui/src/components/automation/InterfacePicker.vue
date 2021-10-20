<template>
  <v-card style="margin-bottom: 16px">
    <v-card-title
      class="small-header red-gradient white--text font-weight-light subtitle-2"
      >Action</v-card-title
    >

    <v-flex xs12>
      <Select2
        v-model="lazyValue.selected"
        :options="interfaces"
        :unselected="unselected"
        @input="onInput"
      ></Select2>

      <component
        :is="lazyValue.selected.component"
        :properties="lazyValue.selected.properties"
        v-model="lazyValue.model"
        @input="onInput"
      ></component>
    </v-flex>
  </v-card>
</template>

<script>
import cloneDeep from "lodash/cloneDeep";
import CustomValue from "../../common/CustomValue.vue";

import Unassigned from "../../interfaces/Unassigned.vue";

import UpdatePlugins from "../../interfaces/automation/UpdatePlugins.vue";
import Timer from "../../interfaces/automation/Timer.vue";
import Scriptable from "../../interfaces/automation/Scriptable.vue";
import ShellScriptable from "../../interfaces/automation/ShellScriptable.vue";

import EventListener from "../../interfaces/EventListener.vue";
import OnOff from "../../interfaces/OnOff.vue";
import Lock from "../../interfaces/Lock.vue";
import Notifier from "../../interfaces/Notifier.vue";
import SoftwareUpdate from "../../interfaces/SoftwareUpdate.vue";
import ColorSettingHsv from "../../interfaces/ColorSettingHsv.vue";
import StartStop from "../../interfaces/StartStop.vue";
import Dock from "../../interfaces/Dock.vue";
import Pause from "../../interfaces/Pause.vue";
import Scene from "../../interfaces/Scene.vue";
import Program from "../../interfaces/Program.vue";
import ColorSettingRgb from "../../interfaces/ColorSettingRgb.vue";
import ColorSettingTemperature from "../../interfaces/ColorSettingTemperature.vue";
import Brightness from "../../interfaces/Brightness.vue";

import Select2 from "../../common/Select2.vue";
function unassigned() {
  return {
    id: "unassigned",
    text: "Select Action",
    component: "Unassigned",
  };
}

export default {
  props: {
    name: String,
    interfaces: Array,
    unselected: {
      type: Object,
      default: unassigned,
    },
  },
  mixins: [CustomValue],
  components: {
    Unassigned,
    CustomValue,

    UpdatePlugins,
    Timer,
    Scriptable,
    ShellScriptable,

    EventListener,
    OnOff,
    Brightness,
    Lock,
    Notifier,
    SoftwareUpdate,
    ColorSettingHsv,
    ColorSettingRgb,
    ColorSettingTemperature,
    StartStop,
    Dock,
    Pause,
    Scene,
    Program,

    Select2,
  },
  watch: {
    "lazyValue.selected.component"() {
      this.lazyValue.model = {};
    },
  },
  methods: {
    createLazyValue() {
      let selected =
        (this.value.id == "unassigned"
          ? unassigned()
          : this.interfaces.find((e) => e.id == this.value.id)) || unassigned();
      selected = cloneDeep(selected) || unassigned();
      return {
        selected,
        model: cloneDeep(this.value.model),
      };
    },
    createInputValue() {
      return {
        id: this.lazyValue.selected.id,
        model: this.lazyValue.model,
      };
    },
  },
};
</script>
