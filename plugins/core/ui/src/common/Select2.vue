<template>
  <v-autocomplete
    outlined
    :multiple="multiple"
    :chips="multiple"
    :items="sortedOptions"
    v-model="lazyValue"
    :label="label"
    item-value="id"
    return-object
    ref="autocomplete"
    @input="onInput"
    :hint="hint"
    persistent-hint
  >
    <template v-slot:message="{ message }">
      <span v-html="message"></span>
    </template>
  </v-autocomplete>
</template>
</v-autocomplete>
</template>

<script>
import CustomValue from "./CustomValue.vue";
import cloneDeep from "lodash/cloneDeep";

export default {
  props: ["label", "options", "unselected", "multiple", "hint"],
  mixins: [CustomValue],
  computed: {
    sortedOptions() {
      var selected = this.lazyValue;
      if (!this.multiple) {
        if (selected) {
          selected = [selected];
        } else {
          selected = [];
        }
      }
      const selectedIds = selected.map((item) => item.id);
      const sortedOptions = cloneDeep(this.options).filter(
        (item) => !selectedIds.includes(item.id)
      );

      sortedOptions.unshift(...selected);
      if (this.unselected) {
        sortedOptions.unshift(this.unselected);
      }
      return sortedOptions;
    },
  },
};
</script>