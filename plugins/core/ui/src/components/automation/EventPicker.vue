<template>
  <v-card style="margin-bottom: 16px">
    <v-card-title
      class="small-header red-gradient white--text font-weight-light subtitle-2"
      >Trigger</v-card-title
    >

    <v-flex xs12>
      <Select2
        v-model="lazyValue.selected"
        :options="events"
        :unselected="unselected"
        @input="onInput"
        label="Event"
      ></Select2>
      <component
        v-if="lazyValue.selected.component && lazyValue.selected.event"
        :is="lazyValue.selected.component"
        v-model="lazyValue.model"
        :events="events"
        :interfaces="interfaces"
        @input="onInput"
      ></component>
      <v-text-field
        label="Trigger Condition (optional)"
        v-model="lazyValue.condition"
        persistent-hint
        hint="OnOff example: eventData === true"
        @input="onInput"
      ></v-text-field>
    </v-flex>
  </v-card>
</template>

<script>
import cloneDeep from "lodash/cloneDeep";

import Select2 from "../../common/Select2.vue";
import Scheduler from "../../interfaces/automation/Scheduler.vue";
import CustomValue from "../../common/CustomValue.vue";
import Webhook from "../../interfaces/automation/Webhook.vue";
import FaceDetector from "../../interfaces/automation/FaceDetector.vue";

function unassigned() {
  return {
    id: "unassigned",
    text: "Select Event Trigger",
    component: "Unassigned",
    model: {},
  };
}

export default {
  props: {
    events: Array,
    interfaces: Array,
    unselected: {
      type: Object,
      default: unassigned,
    },
  },
  mixins: [CustomValue],
  components: {
    Select2,
    Scheduler,
    Webhook,
    FaceDetector,
  },
  methods: {
    createLazyValue() {
      let selected =
        !this.value.id || this.value.id === "unassigned"
          ? unassigned()
          : this.events.find((e) => e.id === this.value.id);
      selected = cloneDeep(selected) || unassigned();
      const condition = this.value.condition;
      return {
        selected,
        condition,
        model: cloneDeep(this.value.model),
      };
    },
    createInputValue() {
      return {
        condition: this.lazyValue.condition,
        id: this.lazyValue.selected.id,
        model: this.lazyValue.model,
      };
    },
  },
};
</script>
