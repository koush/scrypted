<template>
  <v-layout>
    <v-flex xs12 md6 lg4>
      <!-- <GmapMap
        :center="position"
        :zoom="16"
        ref="mapRef"
        style="height: 400px"
        :options="{
          mapTypeControl: false,
          fullscreenControl: false,
        }"
      >
        <GmapMarker :position="position" />
      </GmapMap>

      <v-flex>
        <v-text-field
          ref="locationAutocomplete"
          autocomplete="off"
          outlined
          label="Set Location (Maps, Timezone)"
          placeholder="Set Location"
          v-model="location"
        ></v-text-field>
      </v-flex>

      <v-flex>
        <v-btn color="primary" @click="goLegacy" outlined dark block
          >Legacy Management Console</v-btn
        >
      </v-flex>

      <v-flex>
        <form method="POST" action="/web/component/settings/backup">
          <v-btn color="green" type="submit" outlined dark block
            >Download Backup</v-btn
          >
        </form>
      </v-flex>

      <v-flex>
        <input
          type="file"
          name="file"
          hidden
          ref="restoreInput"
          @change="doRestore"
        />
        <v-btn color="blue" outlined dark block @click="restore"
          >Restore Backup</v-btn
        >
      </v-flex> -->

      <v-dialog v-model="restart" width="500">
        <template v-slot:activator="{ on }">
          <v-flex>
            <v-btn class="mb-2" block color="red" dark v-on="on">Restart Scrypted</v-btn>
          </v-flex>
        </template>

        <v-card color="red" dark>
          <v-card-title primary-title>Restart Scrypted</v-card-title>

          <v-card-text
            >Are you sure you want to restart the Scrypted service?</v-card-text
          >

          <v-card-text>{{ restartStatus }}</v-card-text>
          <v-divider></v-divider>

          <v-card-actions>
            <v-spacer></v-spacer>
            <v-btn text @click="restart = false">Cancel</v-btn>
            <v-btn text @click="doRestart">Restart</v-btn>
          </v-card-actions>
        </v-card>
      </v-dialog>


      <v-dialog v-model="updateAndRestart" width="500">
        <template v-slot:activator="{ on }">
          <v-flex>
            <v-btn block color="red" dark v-on="on">Update and Restart Scrypted</v-btn>
          </v-flex>
        </template>

        <v-card color="red" dark>
          <v-card-title primary-title>Restart Scrypted</v-card-title>

          <v-card-text
            >Are you sure you want to restart the Scrypted service?</v-card-text
          >

          <v-card-text>{{ restartStatus }}</v-card-text>
          <v-divider></v-divider>

          <v-card-actions>
            <v-spacer></v-spacer>
            <v-btn text @click="updateAndRestart = false">Cancel</v-btn>
            <v-btn text @click="doUpdateAndRestart">Restart</v-btn>
          </v-card-actions>
        </v-card>
      </v-dialog>
    </v-flex>
  </v-layout>
</template>
<script>
import { getComponentWebPath } from "../helpers";
import axios from "axios";
import throttle from "lodash/throttle";
import qs from "query-string";

export default {
  data() {
    return {
      updateAndRestart: false,
      restart: false,
      restartStatus: undefined,
    }
  },
  // data() {
  //   return {
  //     restart: false,
  //     restartStatus: undefined,
  //     location: "",
  //     position: {
  //       lat: 0,
  //       lng: 0,
  //     },
  //   };
  // },
  // computed: {
  //   componentWebPath() {
  //     return getComponentWebPath("settings");
  //   },
  // },
  mounted() {
    // this.$refs.mapRef.$mapPromise.then(() => {
    //   let element = this.$refs.locationAutocomplete.$el;
    //   element = element.querySelector("input");
    //   var autocomplete = new google.maps.places.Autocomplete(element, {
    //     types: ["geocode"],
    //   });
    //   autocomplete.addListener("place_changed", () => {
    //     var place = autocomplete.getPlace();
    //     this.location = place.formatted_address;
    //     this.position.lat = place.geometry.location.lat();
    //     this.position.lng = place.geometry.location.lng();

    //     this.debounceUpdate(
    //       place.geometry.location.lat().toString(),
    //       place.geometry.location.lng().toString()
    //     );
    //   });
    // });

    // axios
    //   .get(`${this.getComponentWebPath("automation")}/settings`)
    //   .then((response) => {
    //     this.location = response.data.location;
    //     this.position.lat = parseFloat(response.data.latitude);
    //     this.position.lng = parseFloat(response.data.longitude);
    //   });
  },
  methods: {
    // getComponentWebPath,
    // debounceUpdate: throttle(function (latitude, longitude) {
    //   axios.post(
    //     `${this.getComponentWebPath("automation")}/`,
    //     qs.stringify({
    //       location: this.location,
    //       latitude,
    //       longitude,
    //     }),
    //     {
    //       "Content-Type": "application/x-www-form-urlencoded",
    //     }
    //   );
    // }, 500),
    // goLegacy() {
    //   window.open("/web/dashboard");
    // },
    async doRestart() {
      this.restartStatus = "Restarting...";
      const serviceControl = await this.$scrypted.systemManager.getComponent("service-control"); 
      await serviceControl.restart();
    },
    async doUpdateAndRestart() {
      this.restartStatus = "Restarting...";
      const serviceControl = await this.$scrypted.systemManager.getComponent("service-control"); 
      await serviceControl.update();
    },
    // restore() {
    //   this.$refs.restoreInput.click();
    // },
    // doRestore() {
    //   let formData = new FormData();
    //   formData.append("file", this.$refs.restoreInput.files[0]);
    //   axios
    //     .post("/web/component/settings/restore", formData, {
    //       headers: {
    //         "Content-Type": "multipart/form-data",
    //       },
    //     })
    //     .then(function () {})
    //     .catch(function () {});
    // },
  },
};
</script>
