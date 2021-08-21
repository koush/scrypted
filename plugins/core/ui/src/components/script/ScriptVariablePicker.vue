<template>
  <v-layout row wrap>
    <v-flex xs12 md5>
      <v-text-field
        outlined
        v-model="lazyValue.variableName"
        placeholder="variableName"
        label="Variable Name"
        @input="onInput"
      ></v-text-field>
    </v-flex>
    <v-flex xs12 md7>
      <Select2
        label="Variable"
        v-model="lazyValue.variableValue"
        :options="combinedActions"
        :unselected="unselected"
        @input="onInput"
      ></Select2>
    </v-flex>
  </v-layout>
</template>

<script>
import cloneDeep from "lodash.clonedeep";
import Select2 from "../../common/Select2.vue";
import CustomValue from "../../common/CustomValue.vue";

function unassigned() {
  return {
    id: "unassigned",
    text: "Assign Device to Variable"
  };
}

export default {
  mixins: [CustomValue],
  props: {
    scriptType: String,
    actions: Array,
    unselected: {
      type: Object,
      default: unassigned
    }
  },
  computed: {
    combinedActions: {
      get: function() {
        var actions = [];
        if (this.scriptType == "Library") {
          actions.push({
            id: "library",
            text: "Library Method Parameter"
          });
        }
        actions = actions.concat(this.actions);
        return actions;
      }
    }
  },
  components: {
    Select2
  },
  methods: {
    createLazyValue() {
      return {
        variableName: this.value.key,
        variableValue:
          cloneDeep(this.actions.find(e => e.id == this.value.value)) ||
          unassigned()
      };
    },
    createInputValue() {
      return {
        key: this.lazyValue.variableName,
        value: this.lazyValue.variableValue.id
      };
    }
  }
};
</script>
