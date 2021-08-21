<template>
  <v-flex>
    <v-card
      v-if="managedDevices.devices.length"
      raised
      class="header-card"
      style="margin-bottom: 60px"
    >
      <v-card-title
        class="green-gradient subtitle-1 text--white  font-weight-light"
      >
        <font-awesome-icon size="sm" icon="database" />&nbsp;&nbsp;Managing Devices
      </v-card-title>
      <v-card-text>These devices were created by {{ name }}.</v-card-text>
      <DeviceGroup :deviceGroup="managedDevices"></DeviceGroup>
    </v-card>

    <v-card raised class="header-card">
      <v-card-title
        class="red-gradient subtitle-1 text--white  font-weight-light"
      >{{ script.npmPackage ? "Plugin Management" : "Edit Script" }}</v-card-title>

      <v-form>
        <v-container>
          <v-layout>
            <v-flex xs12>
              <v-layout>
                <v-flex xs12 v-if="!script.npmPackage">
                  <v-select
                    outlined
                    xs12
                    v-model="script.type"
                    label="Script Type"
                    :items="['Library', 'Event', 'Device']"
                    @input="onChange"
                  ></v-select>
                  <v-card style="margin-bottom: 16px;" v-if="hasVars">
                    <v-card-title
                      class="small-header green-gradient white--text font-weight-light subtitle-2"
                    >{{ script.type || 'Library' }} Script</v-card-title>
                    <v-container>
                      <v-layout>
                        <v-flex>
                          <div v-if="script.type == 'Event'" class="caption">
                            Use the
                            <router-link
                              :to="`${getComponentViewPath('automation')}`"
                            >Automation component</router-link>&nbsp;to run this script when an event is triggered. The
                            "eventSource" and "eventData" local variables will contain information about the event.
                          </div>
                          <div v-if="!script.type || script.type == 'Library'" class="caption">
                            Library scripts are can be run using the "Test" button, or called from other scripts with custom arguments. Though Library scripts
                            can be run from
                            <router-link :to="`${getComponentViewPath('automation')}`">Automations,</router-link>&nbsp;an Event script is better suited for that, as Event Scripts expose extra
                            variables pertaining to the event.
                          </div>
                          <div v-if="script.type == 'Device'">
                            <div class="caption">
                              Device scripts enable the creation of custom devices within Scrypted. Choose the supported interfaces of your device,
                              then use the "Generate Device Code" button to get a default implementation.
                            </div>

                            <div class="caption">
                              DeviceProvider is a unique interface, in that it enables creation of "controllers" that may create one of more other devices. This can be used to add support for
                              third party hubs or discoverable devices. See the
                              <a
                                href="https://github.com/koush/scrypted-hue"
                                target="_blank"
                              >Hue</a> and
                              <a
                                href="https://github.com/koush/scrypted-lifx"
                                target="_blank"
                              >Lifx</a>
                              samples to get started.
                              <v-select
                                class="mt-2"
                                hint
                                xs12
                                multiple
                                chips
                                v-model="script.virtualDeviceInterfaces"
                                label="Interfaces"
                                :items="Object.keys(deviceProps.interfaces)"
                                @input="onChange"
                              ></v-select>
                              <v-btn
                                small
                                color="info"
                                outlined
                                @click="generate"
                              >Generate Device Code</v-btn>
                            </div>
                          </div>
                        </v-flex>
                      </v-layout>
                    </v-container>
                  </v-card>
                </v-flex>
              </v-layout>
              <v-card style="margin-bottom: 16px;" v-if="hasVars">
                <v-card-title
                  class="small-header green-gradient white--text font-weight-light subtitle-2"
                >Script Variables</v-card-title>

                <v-container>
                  <v-layout>
                    <v-flex>
                      <ScriptVariablesPicker
                        v-model="script.vars"
                        :scriptType="script.type"
                        :actions="deviceProps.actions"
                        :addButton="!!!deviceProps.npmPackage"
                        @input="onChange"
                      ></ScriptVariablesPicker>
                    </v-flex>
                  </v-layout>
                </v-container>
              </v-card>

              <v-textarea
                style="margin-top: 16px;"
                v-if="!script.gistInSync && !script.npmPackage"
                auto-grow
                rows="10"
                v-model="script.script"
                outlined
                label="Script"
                @input="onChange"
              ></v-textarea>
              <div v-else-if="!script.npmPackage" xs12 ref="gist" style="margin-top: 16px;"></div>

              <div class="caption mt-2" style v-if="!script.npmPackage">
                <a href="https://developer.scrypted.app" target="developer">Developer Reference</a>
              </div>
              <v-btn v-if="script.npmPackage" outlined color="blue" @click="reload" xs4>Reload</v-btn>
              <v-btn v-else outlined color="blue" @click="test" xs4>Run Script</v-btn>
              <v-btn outlined color="blue" @click="debug" xs4>Debug</v-btn>
              <v-alert
                style="margin-top: 16px;"
                outlined
                v-model="showCompilerResult"
                dismissible
                close-text="Close Alert"
                type="success"
              >
                <div>
                  <pre class="black--text" style="white-space: pre-wrap;" v-html="compilerResult"></pre>
                </div>
              </v-alert>
            </v-flex>
          </v-layout>
        </v-container>
      </v-form>

      <v-card-actions>
        <v-btn text color="primary" @click="showStorage = !showStorage">Storage</v-btn>
        <v-spacer></v-spacer>
        <v-btn
          v-if="script.npmPackage && !updateAvailable"
          text
          color="blue"
          @click="openNpm"
          xs4
        >{{ script.npmPackage }}@{{ script.npmPackageVersion }}</v-btn>
        <v-btn
          v-else-if="script.npmPackage && updateAvailable"
          color="orange"
          @click="doInstall"
          dark
        >Install Update {{ updateAvailable }}</v-btn>
      </v-card-actions>
    </v-card>

    <v-card raised class="header-card" v-if="showStorage" style="margin-top: 60px">
      <v-card-title
        class="green-gradient subtitle-1 text--white  font-weight-light"
      >Script Storage</v-card-title>
      <v-form>
        <v-container>
          <v-layout>
            <v-flex xs12>
              <Storage v-model="script.configuration" @input="onChange"></Storage>
            </v-flex>
          </v-layout>
        </v-container>
      </v-form>
    </v-card>
  </v-flex>
</template>
<script>
import cloneDeep from "lodash.clonedeep";
import DeviceGroup from "../../common/DeviceTable.vue";
import ScriptVariablesPicker from "./ScriptVariablesPicker.vue";
import axios from "axios";
import qs from "query-string";
import Storage from "../../common/Storage.vue";
import { getComponentWebPath, getComponentViewPath } from "../helpers";
import { checkUpdate, installNpm, getNpmPath } from "./plugin";

export default {
  props: ["value", "id", "name", "deviceProps"],
  components: {
    DeviceGroup,
    ScriptVariablesPicker,
    Storage
  },
  data: function() {
    return {
      updateAvailable: false,
      compilerResult: undefined,
      script: Object.assign(cloneDeep(this.deviceProps.script), {
        vars: cloneDeep(this.deviceProps.vars)
      }),
      showStorage: false,
      scriptTypes: ["Library", "Device", "Event"].map(id => ({ id, text: id }))
    };
  },
  mounted() {
    this.doGist();

    if (this.script.npmPackage) {
      checkUpdate(this.script.npmPackage, this.script.npmPackageVersion).then(
        updateAvailable => (this.updateAvailable = updateAvailable)
      );
    }
  },
  watch: {
    id() {
      this.doGist();
    }
  },
  methods: {
    getComponentViewPath,
    doInstall() {
      installNpm(this.id, this.script.npmPackage).then(() =>
        this.$emit("refresh")
      );
    },
    openNpm() {
      window.open(getNpmPath(this.script.npmPackage), "npm");
    },
    openDeveloperReference(iface) {
      window.open("https://developer.scrypted.app/#" + iface.toLowerCase());
    },
    generate() {
      const body = this.script.virtualDeviceInterfaces
        .map(iface => "interfaces=" + iface)
        .join("&");
      axios
        .post(`${getComponentWebPath("script")}/generate`, body, {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded"
          }
        })
        .then(response => {
          this.script.script = response.data;
          this.onChange();
        });
    },
    onChange() {
      if (!this.script.script) {
        this.script.script = "";
      }
      this.$emit("input", this.script);
    },
    doGist() {
      if (!this.deviceProps.gistEmbed) {
        return;
      }

      const nativeWrite = document.write;
      this.$refs.gist.innerHTML = "";
      document.write = str => {
        this.$refs.gist.innerHTML += str;
      };
      var tag = document.createElement("script");
      tag.src = this.deviceProps.gistEmbed;
      this.$refs.gist.appendChild(tag);
      tag.onload = () => {
        document.write = nativeWrite;
      };
    },
    debug() {
      axios
        .post(
          `${getComponentWebPath("script")}/debugTarget`,
          qs.stringify({
            thingId: this.script.id
          })
        )
        .then(response => {
          this.compilerResult = response.data;
        });
    },
    reload() {
      axios
        .post(`${getComponentWebPath("script")}/reload/${this.script.id}`)
        .then(response => {
          this.compilerResult = response.data.length
            ? "Reload output:\n\n" + response.data
            : this.script.npmPackage
            ? "Plugin reloaded."
            : "Script reloaded.";
        });
    },
    test() {
      axios
        .post(`${getComponentWebPath("script")}/test`, this.script)
        .then(response => {
          this.compilerResult = "Script output:\n\n" + response.data;
        });
    }
  },
  computed: {
    hasVars() {
      return (
        !this.script.npmPackage ||
        !this.script.npmPackageJson ||
        (this.script.npmPackageJson.scrypted &&
          this.script.npmPackageJson.scrypted.variables)
      );
    },
    showCompilerResult: {
      get() {
        return !!this.compilerResult;
      },
      set(value) {
        this.compilerResult = value ? this.compilerResult : "";
      }
    },
    managedDevices() {
      const devices = this.$store.state.scrypted.devices
        .filter(
          id =>
            this.$store.state.systemState[id].metadata.value.ownerPlugin ===
            this.id
        )
        .map(id => ({
          id,
          name: this.$store.state.systemState[id].name.value,
          type: this.$store.state.systemState[id].type.value
        }));
      return {
        devices
      };
    }
  }
};
</script>