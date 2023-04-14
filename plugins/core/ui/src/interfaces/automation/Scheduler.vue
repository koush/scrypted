<template>
  <v-layout row wrap justify-center align-center>
    <v-flex xs3 md2 lg2 xl1 v-for="day of days" :key="day">
      <v-btn block class="white--text" @click="toggleDay(day)" color="info" small :text="!lazyValue[day]">{{
        day.substring(0, 3) }}</v-btn>
    </v-flex>
    <v-flex xs12>
      <v-layout justify-center align-center>
        <vc-date-picker v-model="time" class="hide-header" @input="onChange" mode="time"></vc-date-picker>
      </v-layout>
    </v-flex>
  </v-layout>
</template>
<script>
import RPCInterface from "../RPCInterface.vue";
import cloneDeep from "lodash/cloneDeep";
const days = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday"
];
const hours = [];
const minutes = [];

function zeroPrefix(arr, len) {
  for (var i = 0; i <= len; i++) {
    arr.push(i >= 10 ? i.toString() : "0" + i);
  }
}


zeroPrefix(hours, 24);
zeroPrefix(minutes, 59);

export default {
  mixins: [RPCInterface],
  data: function () {
    return {
      days,
    };
  },
  computed: {
    time: {
      get() {
        const date = new Date();
        date.setMilliseconds(0);
        date.setSeconds(0);
        date.setMinutes(this.lazyValue.minute);
        date.setHours(this.lazyValue.hour);
        return date;
      },
      set(value) {
        this.lazyValue.hour = value.getHours();
        this.lazyValue.minute = value.getMinutes();
        this.onChange();
      }
    }
  },
  methods: {
    toggleDay: function (day) {
      this.lazyValue[day] = !this.lazyValue[day];
      this.onChange();
    },
    createLazyValue() {
      var ret = cloneDeep(this.value);
      ret.hour = ret.hour || 0;
      ret.minute = ret.minute || 0;
      return ret;
    },
    onChange: function () {
      const schedule = {
        hour: parseInt(this.lazyValue.hour) || 0,
        minute: parseInt(this.lazyValue.minute) || 0,
      };
      days.forEach(day => {
        schedule[day] = this.lazyValue[day] || false;
      });

      this.rpc().schedule(schedule);
    }
  }
};
</script>

<style>
.no-arrow {
  -moz-appearance: none;
  -webkit-appearance: none;
  appearance: none;
}

.semicolon-pad {
  margin-left: 2px;
  margin-right: 2px;
  margin-top: 4px;
}


.hide-header .vc-date {
  display: none !important;
}
</style>