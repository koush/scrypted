<template>
  <div>
    <v-checkbox
      :readonly="lazyValue.readonly"
      v-if="lazyValue.type && lazyValue.type.toLowerCase() === 'boolean'"
      v-model="booleanValue"
      :label="lazyValue.title"
      :hint="lazyValue.description"
      :placeholder="lazyValue.placeholder"
      persistent-hint
      @change="save"
    ></v-checkbox>
    <v-select
      :readonly="lazyValue.readonly"
      v-else-if="lazyValue.choices"
      :items="lazyValue.choices"
      v-model="lazyValue.value"
      outlined
      :label="lazyValue.title"
      :hint="lazyValue.description"
      persistent-hint
    >
      <template v-slot:append-outer>
        <v-btn v-if="dirty" color="green" dark tile @click="save" class="shift-up">
          <v-icon>check</v-icon>
        </v-btn>
      </template>
    </v-select>
    <Grower
      v-else-if="lazyValue.type && lazyValue.type.toLowerCase().startsWith('device[]')"
      v-model="lazyValue.value"
    >
      <template v-slot:default="slotProps">
        <DevicePicker
          v-model="slotProps.item"
          @input="slotProps.onInput"
          :devices="devices"
          :title="lazyValue.title"
          :description="lazyValue.description"
        ></DevicePicker>
      </template>

      <template v-slot:append-outer>
        <v-btn v-if="dirty" @click="save" >
         Save
        </v-btn>
      </template>
    </Grower>

    <DevicePicker
      v-else-if="lazyValue.type && lazyValue.type.toLowerCase().startsWith('device')"
      v-model="lazyValue.value"
      :devices="devices"
      :title="lazyValue.title"
      :description="lazyValue.description"
    >
      <template v-slot:append-outer>
        <v-btn v-if="dirty" color="green" dark tile @click="save" class="shift-up">
          <v-icon>check</v-icon>
        </v-btn>
      </template>
    </DevicePicker>
    <v-text-field
      :readonly="lazyValue.readonly"
      v-else
      outlined
      v-model="lazyValue.value"
      :placeholder="lazyValue.placeholder"
      :label="lazyValue.title"
      :hint="lazyValue.description"
      persistent-hint
      :type="lazyValue.type && lazyValue.type.toLowerCase() === 'password' ? 'password' : undefined"
    >
      <template v-slot:append-outer>
        <v-btn v-if="dirty" color="green" dark tile @click="save" class="shift-up">
          <v-icon>check</v-icon>
        </v-btn>
      </template>
    </v-text-field>
  </div>
</template>
<script>
import RPCInterface from "./RPCInterface.vue";
import DevicePicker from "../common/DevicePicker.vue";
import Grower from "../common/Grower.vue";
import cloneDeep from "lodash.clonedeep";

export default {
  mixins: [RPCInterface],
  components: {
    DevicePicker,
    Grower
  },
  computed: {
    booleanValue: {
      get() {
        return (
          this.lazyValue.value && this.lazyValue.value.toLowerCase() === "true"
        );
      },
      set(val) {
        this.lazyValue.value = val.toString();
      }
    },
    dirty() {
      var type = this.value.type || "";
      if (type.indexOf("[]") == -1) {
        return this.lazyValue.value !== this.value.value;
      }
      return JSON.stringify(this.lazyValue.value) !== this.value.value;
    },
    devices() {
      var expression;
      try {
        expression = this.lazyValue.type.split(":")[1];
        // var interfaces = this.$scrypted.systemManager.getDeviceById(id).interfaces.map(iface => `var ${iface} = true`);
      } catch (e) {
        expression = "true;";
      }
      var ret = this.$store.state.scrypted.devices
        .map(id => this.$scrypted.systemManager.getDeviceById(id))
        .filter(device => {
          try {
            return eval(
              `(function() { var interfaces = ${JSON.stringify(
                device.interfaces
              )}; var type='${device.type}'; return ${expression} })`
            )();
          } catch (e) {
            return true;
          }
        })
        .map(device => ({
          id: device.id,
          text: device.name
        }));
        ret.splice(0, 0, {
          id: null,
          text: "Select a Device",
        })
        return ret;
    }
  },
  methods: {
    createLazyValue() {
      var type = this.value.type || "";
      if (type.indexOf("[]") == -1) {
        return cloneDeep(this.value);
      }

      var ret = cloneDeep(this.value);
      ret.value = JSON.parse(ret.value);
      return ret;
    },
    createInputValue() {
      var type = this.lazyValue.type || "";
      if (type.indexOf("[]") == -1) {
        return this.lazyValue;
      }

      var ret = cloneDeep(this.lazyValue);
      ret.value = JSON.stringify(ret.value.filter(id => id));
      return ret;
    },
    save() {
      this.rpc().putSetting(this.lazyValue.key, this.createInputValue().value);
      this.onInput();
    }
  }
};
</script>
<style>
.shift-up {
  margin-top: -8px;
}
</style>