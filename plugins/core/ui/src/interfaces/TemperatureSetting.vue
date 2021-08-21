<template>
  <v-flex>
    <v-label>Temperature</v-label>
    <v-range-slider
      color="purple"
      thumb-color="purple"
      thumb-label="always"
      v-if="lazyValue.thermostatMode === HeatCool"
      :max="90"
      :min="0"
      v-model="range"
      @change="setThermostatSetpointRange"
    ></v-range-slider>
    <v-slider
      color="purple"
      thumb-color="purple"
      v-else
      thumb-label="always"
      v-model="lazyValue.thermostatSetpoint"
      :max="90"
      :min="0"
      @change="setThermostatSetpoint"
    ></v-slider>
    <v-select
      outlined
      v-model="lazyValue.thermostatMode"
      :items="lazyValue.thermostatAvailableModes"
      label="Mode"
      @change="onChangeMode"
    ></v-select>
  </v-flex>
</template>
<script>
import RPCInterface from "./RPCInterface.vue";
import throttle from "lodash.throttle";
import cloneDeep from "lodash.clonedeep";
import { ThermostatMode } from "@scrypted/sdk/types";

export default {
  mixins: [RPCInterface],
  data() {
    return {
      HeatCool: ThermostatMode.HeatCool
    };
  },
  methods: {
    setThermostatSetpoint() {
      if (this.device) {
        this.debounceSetThermostatSetpoint();
        return;
      }
      this.onChange();
    },
    debounceSetThermostatSetpoint: throttle(function() {
      this.rpc().setThermostatSetpoint(this.lazyValue.thermostatSetpoint);
    }, 500),
    setThermostatSetpointRange() {
      if (this.device) {
        this.debounceSetThermostatSetpointRange();
        return;
      }
      this.onChange();
    },
    debounceSetThermostatSetpointRange: throttle(function() {
      this.rpc().setThermostatSetpointLow(this.lazyValue.thermostatSetpointLow);
      this.rpc().setThermostatSetpointHigh(
        this.lazyValue.thermostatSetpointHigh
      );
    }, 500),
    onChange() {
      if (this.device) {
        return;
      }
      this.rpc().setThermostatMode(this.lazyValue.thermostatMode);
      if (this.lazyValue.thermostatMode == ThermostatMode.HeatCool) {
        this.rpc().setThermostatSetpoint(this.lazyValue.thermostatSetpoint);
      } else {
        this.rpc().setThermostatSetpoint(this.lazyValue.thermostatMode);
      }
    },
    onChangeMode() {
      if (this.device) {
        this.rpc().setThermostatMode(this.lazyValue.thermostatMode);
        return;
      }
      this.onChange();
    },
    createLazyValue() {
      var ret = cloneDeep(this.value);
      ret = Object.assign(
        {
          thermostatMode: "Off",
          thermostatSetpoint: 22.2
        },
        ret
      );
      return ret;
    }
  },
  computed: {
    range: {
      get() {
        return [
          this.lazyValue.thermostatSetpointLow,
          this.lazyValue.thermostatSetpointHigh
        ];
      },
      set(val) {
        this.lazyValue.thermostatSetpointLow = val[0];
        this.lazyValue.thermostatSetpointHigh = val[1];
      }
    }
  }
};
</script>