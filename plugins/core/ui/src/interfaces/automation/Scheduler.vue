<template>
  <v-layout row wrap justify-center align-center>
    <v-flex xs3 md2 lg2 xl1 v-for="day of days" :key="day">
      <v-btn
        block
        class="white--text"
        @click="toggleDay(day)"
        color="info"
        small
        :text="!lazyValue[day]"
      >{{ day.substring(0, 3) }}</v-btn>
    </v-flex>
    <v-flex xs12>
      <v-layout justify-center align-center>
        <v-time-picker v-model="time" format="24hr" @input="onChange"></v-time-picker>
      </v-layout>
    </v-flex>
    <v-flex xs12>
      <v-layout justify-center align-center>
        <v-flex xs12 md8 lg6 xl4>
          <v-select
            xs3
            reverse
            :items="clockTypes"
            solo
            item-value="id"
            v-model="lazyValue.clockType"
            @input="onChange"
          ></v-select>
        </v-flex>
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
const clockTypes = [
  {
    id: "AM",
    text: "AM"
  },
  {
    id: "PM",
    text: "PM"
  },
  {
    text: "24 Hour Clock",
    id: "TwentyFourHourClock"
  },
  {
    text: "Before Sunrise",
    id: "BeforeSunrise"
  },
  {
    text: "After Sunrise",
    id: "AfterSunrise"
  },
  {
    text: "Before Sunset",
    id: "BeforeSunset"
  },
  {
    text: "After Sunset",
    id: "AfterSunset"
  }
];

zeroPrefix(hours, 24);
zeroPrefix(minutes, 59);

export default {
  mixins: [RPCInterface],
  data: function() {
    return {
      clockTypes,
      days,
    };
  },
  computed: {
    time: {
      get() {
        return `${this.lazyValue.hour}:${this.lazyValue.minute}`;
      },
      set(value) {
        this.lazyValue.hour = value.split(":")[0];
        this.lazyValue.minute = value.split(":")[1];
        this.onChange();
      }
    }
  },
  methods: {
    toggleDay: function(day) {
      this.lazyValue[day] = !this.lazyValue[day];
      this.onChange();
    },
    createLazyValue() {
      var ret = cloneDeep(this.value);
      ret.hour = ret.hour || 0;
      ret.minute = ret.minute || 0;
      return ret;
    },
    onChange: function() {
      const schedule = {
        hour: parseInt(this.lazyValue.hour) || 0,
        minute: parseInt(this.lazyValue.minute) || 0,
        clockType: this.lazyValue.clockType || "AM",
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
</style>