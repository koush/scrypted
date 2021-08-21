<template>
  <v-layout wrap>
    <v-flex xs12 md6 lg6 v-if="!loading">
      <v-flex>
        <v-card raised class="header-card">
          <v-card-title
            class="orange-gradient subtitle-1 text--white  font-weight-light"
          >{{ settings.name }}</v-card-title>
          <v-card-text>Home Id: {{ settings.homeId }} Node Id: {{ settings.nodeId }}</v-card-text>
          <v-card-actions>
            <v-btn text color="blue" @click="refreshNode">Refresh Node</v-btn>
            <v-btn text color="blue" @click="forceRemove">Force Remove</v-btn>
          </v-card-actions>

          <v-flex>
            <v-card
              style="margin-bottom: 16px;"
              v-for="(commandClass, key) in settings.commandClasses"
              :key="key"
            >
              <v-card-title
                class="small-header green-gradient white--text font-weight-light subtitle-2"
              >Command Class: 0x{{ parseInt(key).toString(16) }}</v-card-title>

              <v-simple-table>
                <thead>
                  <tr>
                    <th width="24px" class="text-xs-left">Instance</th>
                    <th width="24px" class="text-xs-left">Index</th>
                    <th class="text-xs-left">Label</th>
                    <th width="16px" class></th>
                  </tr>
                </thead>
                <tbody class="body-2 font-weight-light">
                  <tr v-for="node in commandClass" :key="node.id">
                    <td>{{ node.instance }}</td>
                    <td>{{ node.index }}</td>
                    <td>{{ node.label }}</td>
                    <td>
                      <a @click="getValue(key, node.instance, node.index)">
                        <v-icon>settings</v-icon>
                      </a>
                    </td>
                  </tr>
                </tbody>
              </v-simple-table>
            </v-card>
          </v-flex>
        </v-card>
      </v-flex>
    </v-flex>

    <v-dialog v-model="dialog" width="500">
      <v-card color="blue" dark>
        <v-card-title>{{ settings.name }}</v-card-title>
        <v-card-text>
          <div>Command Class: 0x{{ parseInt(dialogCommandClass).toString(16) }}</div>
          <div>Instance: {{ dialogInstance }}</div>
          <div>Index: {{ dialogIndex }}</div>
          <v-text-field v-if="!dialogChoices" v-model="dialogValue" label="Value"></v-text-field>
          <v-select v-else :items="dialogChoices" label="Value" v-model="dialogValue"></v-select>
        </v-card-text>
        <v-card-actions>
          <v-btn text @click="getValue(dialogCommandClass, dialogInstance, dialogIndex)">Get Value</v-btn>
          <v-btn text @click="setValue(dialogCommandClass, dialogInstance, dialogIndex)">Set Value</v-btn>
          <v-spacer></v-spacer>
          <v-btn text @click="dialog = false">Cancel</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

  </v-layout>
</template>

<script>
import { getComponentWebPath } from "../helpers";
import axios from "axios";
import qs from "query-string";

export default {
  data() {
    return {
      loading: true,
      settings: {},
      dialog: false,

      dialogCommandClass: undefined,
      dialogInstance: undefined,
      dialogIndex: undefined,
      dialogValue: undefined
    };
  },


  computed: {
    componentWebPath() {
      return getComponentWebPath("zwave");
    },
    dialogChoices() {
      if (!this.dialogCommandClass) {
        return undefined;
      }
      return this.settings.commandClasses[this.dialogCommandClass].find(
        value =>
          value.instance == this.dialogInstance &&
          value.index == this.dialogIndex
      ).choices;
    },
    homeId() {
      return this.$route.params.homeId;
    },
    homeIdInt() {
      return this.settings.homeIdInt;
    },
    nodeId() {
      return this.$route.params.nodeId;
    }
  },
  methods: {
    getComponentWebPath,
    refreshNode() {
      axios
        .post(`${this.componentWebPath}/node/${this.homeIdInt}/${this.nodeId}/refresh`)
        .then(response => {
          console.log(response.data);
        })
        .catch(e => {
          console.log(e);
        })
    },
    forceRemove() {
      axios
        .post(`${this.componentWebPath}/node/${this.homeIdInt}/${this.nodeId}/remove`)
        .then(response => {
          console.log(response.data);
        })
        .catch(e => {
          console.log(e);
        })
    },
    refresh() {
      axios
        .get(`${this.componentWebPath}/view/${this.homeId}/${this.nodeId}`)
        .then(response => {
          this.$data.settings = response.data;
          this.loading = false;
        });
    },
    getValue(commandClass, instance, index) {
      this.openValue(commandClass, instance, index);
      const cc = "0x" + parseInt(commandClass).toString(16);
      axios
        .post(
          `${this.componentWebPath}/node/${this.homeIdInt}/${this.nodeId}/${cc}/${instance}/${index}/refresh`
        )
        .then(response => {
          this.dialogValue = response.data;
          this.dialog = true;
        });
    },
    setValue(commandClass, instance, index) {
      const cc = "0x" + parseInt(commandClass).toString(16);
      axios
        .post(
          `${this.componentWebPath}/node/${this.homeIdInt}/${this.nodeId}/${cc}/${instance}/${index}`,
          qs.stringify(
            {
              value: this.dialogValue
            },
            {
              headers: {
                "Content-Type": "application/x-www-form-urlencoded"
              }
            }
          )
        )
        .then(() => {
          this.dialog = true;
        });
    },
    openValue(commandClass, instance, index) {
      this.dialogValue = undefined;
      this.dialogCommandClass = commandClass;
      this.dialogInstance = instance;
      this.dialogIndex = index;
      this.dialog = true;
    }
  },
  mounted() {
    this.refresh();
  }
};
</script>
