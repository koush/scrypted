<template>
  <div>
    <v-slider @input="onChange" v-model="hours" label="Hours" thumb-label="always" min="0" max="23"></v-slider>
    <v-slider
      @input="onChange"
      v-model="minutes"
      label="Minutes"
      thumb-label="always"
      min="0"
      max="59"
    ></v-slider>
    <v-slider
      @input="onChange"
      v-model="seconds"
      label="Seconds"
      thumb-label="always"
      min="0"
      max="59"
    ></v-slider>
    <v-btn outlined color="indigo">{{ time }}</v-btn>
  </div>
</template>

<script>
import RPCInterface from "../RPCInterface.vue";

export default {
  mixins: [RPCInterface],
  methods: {
    update(hours, minutes, seconds) {
      this.lazyValue.seconds = hours * 60 * 60 + minutes * 60 + seconds;
    },
    onChange() {
      this.rpc({
        varargs: true
      }).create(parseInt((this.lazyValue.seconds || 0) * 1000));
    }
  },
  computed: {
    hours: {
      get() {
        return Math.floor(this.lazyValue.seconds / 60 / 60) || 0;
      },
      set(value) {
        this.update(value, this.minutes, this.seconds);
      }
    },
    minutes: {
      get() {
        return (Math.floor(this.lazyValue.seconds / 60) % 60) || 0;
      },
      set(value) {
        this.update(this.hours, value, this.seconds);
      }
    },
    seconds: {
      get() {
        return (this.lazyValue.seconds % 60) || 0;
      },
      set(value) {
        this.update(this.hours, this.minutes, value);
      }
    },
    time() {
      var ret = [];
      if (this.hours) {
        ret.push(`${this.hours} hours`);
      }
      if (this.minutes) {
        ret.push(`${this.minutes} minutes`);
      }
      if (this.seconds) {
        ret.push(`${this.seconds} seconds`);
      }
      if (!ret.length) {
        return "Adjust the sliders to set the timer.";
      }
      return "Timer: " + ret.join(", ");
    }
  }
};
</script>
