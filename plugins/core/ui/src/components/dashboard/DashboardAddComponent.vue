<template>
  <v-dialog v-model="showDialog" dark max-width="500px">
    <v-card color="purple" raised>
      <v-card-title>
        <font-awesome-icon size="sm" icon="sliders-h" color="white" style="margin-right: 20px" />
        <span >Add Card Item</span>
      </v-card-title>

      <v-list flat color="purple">
        <v-list-item-group>
          <v-list-item
            ripple
            v-for="(component, vueIndex) of getCardComponentSettings().keys()"
            :key="vueIndex"
            @click="onInput(component)"
          >
            <v-list-item-title class="text-center">{{ component }}</v-list-item-title>
          </v-list-item>
        </v-list-item-group>
      </v-list>
    </v-card>
    <template v-slot:activator="{ on }">
      <v-btn small color="pink" dark absolute bottom left fab v-on="on">
        <v-icon>add</v-icon>
      </v-btn>
    </template>
  </v-dialog>
</template>
<script>
import { getCardComponentSettings } from "./layout";

export default {
  data() {
    return {
      showDialog: false
    };
  },
  methods: {
    getCardComponentSettings,
    onInput(component) {
      this.showDialog = false;
      this.$emit("input", component);
    }
  }
};
</script>