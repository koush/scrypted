<template>
  <div>
    <v-layout wrap v-if="!loading">
      <v-flex
        v-for="(card, cardIndex) in cards"
        :key="cardIndex"
        xs12
        :md6="cards.length > 1"
      >
        <v-card v-if="!card.hide" raised >
          <v-card-title
            class="orange-gradient subtitle-1 text--white font-weight-light"
            >{{ card.title }}</v-card-title
          >

          <v-card-text>{{ card.description }}</v-card-text>
          <component
            v-if="card.body"
            :is="card.body"
            v-model="card.value"
          ></component>

          <v-card-actions>
            <v-btn
              text
              color="orange"
              v-for="(cardButton, buttonIndex) in card.buttons"
              :key="buttonIndex"
              @click="cardButton.click && cardButton.click(card.value)"
              >{{ cardButton.title }}</v-btn
            >
          </v-card-actions>
        </v-card>
      </v-flex>

      <v-flex
        xs12
        :md6="deviceGroups.length > 1"
        v-for="deviceGroup in deviceGroups"
        :key="deviceGroup.name"
      >
        <v-card raised >
          <v-card-title
            class="red-gradient subtitle-1 text--white font-weight-light"
            >{{ deviceGroup.name }}</v-card-title
          >
          <DeviceTable
            :hideType="deviceGroup.hideType"
            :deviceGroup="deviceGroup"
            :getOwnerColumn="getOwnerColumn"
            :getOwnerLink="getOwnerLink"
            v-bind="deviceGroup.tableProps"
          >
            <template
              v-slot:extra-column-0="device"
              v-if="deviceGroup.extraColumn0"
            >
              <component
                :is="deviceGroup.extraColumn0"
                v-bind="device"
              ></component>
            </template>
            <template
              v-slot:extra-column-1="device"
              v-if="deviceGroup.extraColumn1"
            >
              <component
                :is="deviceGroup.extraColumn1"
                v-bind="device"
              ></component>
            </template>
          </DeviceTable>
        </v-card>
      </v-flex>
    </v-layout>
    <component v-if="footer" :is="footer" v-model="footerModel" />
  </div>
</template>
<script>
import {
  typeToIcon,
  getComponentWebPath,
  getDeviceViewPath,
  getComponentViewPath,
} from "./helpers";
import DeviceTable from "../common/DeviceTable.vue";
import axios from "axios";
import qs from "query-string";

export default {
  data() {
    return {
      footer: null,
      loading: false,
      settings: {},
    };
  },
  components: {
    DeviceTable,
  },
  methods: {
    typeToIcon,
    getOwnerColumn() {
      return null;
    },
    getOwnerLink() {
      return null;
    },
    newDevice(type) {
      axios
        .post(`/endpoint/@scrypted/core/api/new/${type}`)
        .then((response) => {
          const { id } = response.data;
          window.location.hash = "#" + getDeviceViewPath(id);
        });
    },
    refresh() {
      this.loading = true;
      axios.get(`${this.componentWebPath}/settings`).then((response) => {
        this.$data.settings = response.data;
        this.loading = false;
      });
    },
  },
  asyncComputed: {
    deviceGroups() {
      const ids = this.$store.state.scrypted.devices;
      const devices = ids
        .map((id) => this.$scrypted.systemManager.getDeviceById(id))
        .filter(
          (device) =>
            device &&
            device.component &&
            device.component === this.component.id &&
            !device.owner
        )
        .map((device) => ({
          id: device.id,
          name: device.name,
          type: device.type,
        }));
      return [
        {
          // pluralize
          ownerColumn: null,
          name: this.component.name,
          devices,
        },
      ];
    },
  },
  computed: {
    componentWebPath() {
      return getComponentWebPath(this.id);
    },
    componentViewPath() {
      return getComponentViewPath(this.id);
    },
    id() {
      return window.location.hash.replace("#/component/", "");
    },
  },
};
</script>