<template>
  <div>
    <v-dialog v-if="editMode" dark v-model="showCardComponentSettings" max-width="500px">
      <v-card color="purple" raised>
        <v-card-title>
          <font-awesome-icon size="sm" icon="sliders-h" color="white" style="margin-right: 20px" />
          <span
            v-if="!!cardComponentSettings"
            class="title font-weight-light"
          >{{ cardComponentSettings.cardComponent.component }} Settings</span>
        </v-card-title>

        <v-container>
          <Settings v-if="!!cardComponentSettings" :device="cardComponentSettings" :value="{}"></Settings>
        </v-container>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn text @click="cardComponentSettings = null">Done</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-layout v-if="editMode">
      <v-flex xs12 md6 lg4 xl3>
        <v-flex>
          <v-card>
            <v-card-title>Edit Layout</v-card-title>
            <v-btn small color="pink" dark absolute bottom left fab @click="addCard">
              <v-icon>add</v-icon>
            </v-btn>

            <v-form>
              <v-container>
                <v-layout>
                  <v-flex>
                    <v-switch v-model="cardAlignCenter" label="Align Center"></v-switch>
                  </v-flex>
                </v-layout>
              </v-container>
            </v-form>
            <v-card-actions>
              <v-spacer></v-spacer>
              <v-btn text color="blue" @click="editCards = !editCards">Toggle Preview</v-btn>
              <v-btn text color="blue" @click="saveLayout">Save</v-btn>
              <v-btn text color="primary" @click="editMode = !editMode">Done</v-btn>
            </v-card-actions>
          </v-card>
        </v-flex>
      </v-flex>
    </v-layout>

    <v-layout :align-center="cardAlignCenter">
      <div v-if="!cardColumns"></div>
      <v-flex v-else-if="isEmpty" xs12 md6 lg4>
        <v-flex>
          <v-card raised class="header-card">
            <v-card-title
              class="red-gradient subtitle-1 text--white font-weight-light"
            >No Devices Found</v-card-title>
            <v-card-text>No devices found, install a plugin to add support for your things</v-card-text>
            <v-card-actions>
              <v-spacer></v-spacer>

              <v-btn color="primary" dark text to="/component/script/install">
                Install Plugins
                <v-icon right color="primary">cloud_download</v-icon>
              </v-btn>
            </v-card-actions>
          </v-card>
        </v-flex>
      </v-flex>

      <v-flex
        v-else
        v-bind="stylesForBreakpoints"
        v-for="(cardColumn, index) in cardColumns"
        :key="index"
      >
        <v-flex v-for="(card, cardIndex) in cardColumn" :key="cardIndex">
          <v-card raised class="header-card" v-if="!card.state.hidden || editCardMode">
            <v-card-title :class="card.color" class="subtitle-1 font-weight-light">
              <v-text-field
                hide-details
                dark
                class="pa-0 ma-0"
                v-if="editCardMode"
                v-model="card.name"
              ></v-text-field>
              <div v-else>{{ card.name }}</div>
            </v-card-title>

            <div v-if="editCardMode">
              <v-card-actions>
                <v-layout align-center justify-center>
                  <v-btn small dark fab color="green" @click="card.color = 'green-gradient'"></v-btn>
                  <v-btn small dark fab color="purple" @click="card.color = 'purple-gradient'"></v-btn>
                  <v-btn small dark fab color="red" @click="card.color = 'red-gradient'"></v-btn>
                  <v-btn small dark fab color="orange" @click="card.color = 'orange-gradient'"></v-btn>
                  <v-btn small dark fab color="blue" @click="card.color = 'blue-gradient'"></v-btn>
                  <v-btn small icon @click="card.state.hidden = !card.state.hidden">
                    <font-awesome-icon
                      :icon="card.state.hidden ? 'eye-slash' : 'eye'"
                      style="color: #a9afbb;"
                    />
                  </v-btn>
                  <v-btn small icon @click="cardColumn.splice(cardIndex, 1)" color="#a9afbb">
                    <v-icon>delete</v-icon>
                  </v-btn>
                </v-layout>
              </v-card-actions>
              <v-card-actions>
                <v-btn small icon @click="moveCard(index, cardIndex, -1, 0)">
                  <v-icon>arrow_left</v-icon>
                </v-btn>
                <v-btn small icon @click="moveCard(index, cardIndex, 0, 1)">
                  <v-icon>arrow_drop_down</v-icon>
                </v-btn>
                <v-spacer></v-spacer>
                <v-btn small icon @click="moveCard(index, cardIndex, 0, -1)">
                  <v-icon>arrow_drop_up</v-icon>
                </v-btn>
                <v-btn small icon @click="moveCard(index, cardIndex, 1, 0)">
                  <v-icon>arrow_right</v-icon>
                </v-btn>
              </v-card-actions>
            </div>

            <v-list flat>
              <v-list-item-group>
                <div v-for="(component, componentIndex) in card.components" :key="componentIndex">
                  <component
                    v-if="!component.state.hidden || editCardMode"
                    v-bind="component.value"
                    :is="component.component"
                  ></component>
                  <div v-if="editCardMode">
                    <v-card-actions v-if="editCardMode">
                      <v-btn
                        small
                        icon
                        @click="moveCardComponent(index, cardIndex, componentIndex, -1, 0)"
                      >
                        <v-icon>arrow_left</v-icon>
                      </v-btn>
                      <v-btn
                        small
                        icon
                        @click="moveCardComponent(index, cardIndex, componentIndex, 0, 1)"
                      >
                        <v-icon>arrow_drop_down</v-icon>
                      </v-btn>
                      <v-spacer></v-spacer>

                      <v-btn small icon @click="editCardComponent(component)">
                        <font-awesome-icon icon="sliders-h" style="color: #a9afbb;" />
                      </v-btn>
                      <v-btn small icon @click="component.state.hidden = !component.state.hidden">
                        <font-awesome-icon
                          :icon="component.state.hidden ? 'eye-slash' : 'eye'"
                          style="color: #a9afbb;"
                        />
                      </v-btn>
                      <v-btn
                        small
                        icon
                        @click="card.components.splice(componentIndex, 1)"
                        color="#a9afbb"
                      >
                        <v-icon>delete</v-icon>
                      </v-btn>
                      <v-btn
                        small
                        icon
                        @click="moveCardComponent(index, cardIndex, componentIndex, 0, -1)"
                      >
                        <v-icon>arrow_drop_up</v-icon>
                      </v-btn>
                      <v-btn
                        small
                        icon
                        @click="moveCardComponent(index, cardIndex, componentIndex, 1, 0)"
                      >
                        <v-icon>arrow_right</v-icon>
                      </v-btn>
                    </v-card-actions>
                  </div>
                </div>
              </v-list-item-group>
            </v-list>

            <DashboardAddComponent
              v-if="editCardMode"
              @input="addCardComponent(index, cardIndex, $event)"
            ></DashboardAddComponent>
          </v-card>
        </v-flex>
      </v-flex>
    </v-layout>
  </div>
</template>
<script lang="ts">
import DashboardMap from "./DashboardMap.vue";
import DashboardToggle from "./DashboardToggle.vue";
import DashboardCamera from "./DashboardCamera.vue";
import DashboardLock from "./DashboardLock.vue";
import DashboardThermostat from "./DashboardThermostat.vue";
import DashboardStartStop from "./DashboardStartStop.vue";
import DashboardSensors from "./DashboardSensors.vue";
import DashboardMediaPlayer from "./DashboardMediaPlayer.vue";
import DashboardBase from "./DashboardBase";
import DashboardAddComponent from "./DashboardAddComponent.vue";
import "../header-card.css";
import Vue from "vue";
import Settings from "../../interfaces/Settings.vue";
import cloneDeep from "lodash/cloneDeep";
import ClickOutside from "vue-click-outside";

import {
  getDefaultDashboard,
  getCardComponentSettings,
  CardComponent,
  Card
} from "./layout";
import { Menu } from "../../store";
import { Settings as SettingsInterface, Setting } from "@scrypted/sdk/types";

class CardComponentSettings implements SettingsInterface {
  cardComponent: CardComponent;
  constructor(cardComponent: CardComponent) {
    this.cardComponent = cardComponent;
  }

  getSettings(): Setting[] {
    var settings = cloneDeep(
      getCardComponentSettings().get(this.cardComponent.component)
    );
    for (var setting of settings) {
      let value = this.cardComponent.value[setting.key];
      if (typeof value === "string") {
        setting.value = value;
      } else {
        setting.value = JSON.stringify(value);
      }
    }
    return settings;
  }
  putSetting(key: string, value: string): void {
    var settings = cloneDeep(
      getCardComponentSettings().get(this.cardComponent.component)
    );
    var setting = settings.find(setting => setting.key === key);
    if (!setting.type || setting.type.indexOf("[]") === -1) {
      Vue.set(this.cardComponent.value, key, value);
    } else {
      Vue.set(this.cardComponent.value, key, JSON.parse(value));
    }
  }
}

export default {
  mixins: [DashboardBase],
  components: {
    DashboardMap,
    DashboardToggle,
    DashboardCamera,
    DashboardLock,
    DashboardSensors,
    DashboardThermostat,
    DashboardStartStop,
    DashboardAddComponent,
    DashboardMediaPlayer,
    Settings
  },
  directives: {
    ClickOutside
  },
  data() {
    return {
      editMode: false,
      editCards: false,
      cardColumns: null,
      cardAlignCenter: false,
      cardComponentSettings: null
    };
  },
  mounted() {
    var menu: Menu[] = [
      {
        title: "Edit Layout",
        icon: "edit",
        click: () => {
          this.editMode = true;
          this.editCards = true;
        }
      },
      {
        title: "Save Layout",
        icon: "save",
        click: () => {
          this.saveLayout();
        }
      },
      {
        title: "Auto Layout",
        icon: "magic",
        click: async () => {
          await this.getCardLayout(true);
        }
      }
    ];

    this.$store.commit("setMenu", menu);

    this.getCardLayout();
  },
  destroyed() {
    this.$store.commit("clearMenu");
  },
  watch: {
    "$vuetify.breakpoint.name"() {
      this.cardColumnns = [];
      this.getCardLayout();
    }
  },
  methods: {
    getCardComponentSettings,
    addCardComponent(cardColumn, cardIndex, component) {
      var settings = getCardComponentSettings().get(component);

      var cardComponent: CardComponent = {
        component,
        state: {},
        value: {}
      };

      var cardComponentSettings: CardComponentSettings = new CardComponentSettings(
        cardComponent
      );
      settings.forEach(setting => {
        cardComponentSettings.putSetting(setting.key, setting.value);
      });

      this.cardColumns[cardColumn][cardIndex].components.push(cardComponent);
    },
    addCard() {
      let card: Card = {
        name: "New Card",
        components: [],
        height: 1,
        color: "green-gradient",
        state: {}
      };
      this.cardColumns[0].splice(0, 0, card);
    },
    async saveLayout() {
      await this.$scrypted.userStorage.setItem(
        this.currentLayoutKey,
        JSON.stringify({
          cardColumns: this.cardColumns,
          cardAlignCenter: this.cardAlignCenter
        })
      );
    },
    editCardComponent(cardComponent: CardComponent) {
      this.cardComponentSettings = new CardComponentSettings(cardComponent);
    },
    moveCard(cardColumn, cardIndex, x, y) {
      try {
        var card = this.cardColumns[cardColumn][cardIndex];
        var newColumn = (cardColumn + x) % this.cardColumns.length;
        var newIndex = (cardIndex + y) % this.cardColumns[newColumn].length;
        this.cardColumns[cardColumn].splice(cardIndex, 1);
        this.cardColumns[newColumn].splice(newIndex, 0, card);
      } catch (e) {
        console.error("error moving card", x, y, e);
      }
    },
    moveCardComponent(cardColumn, cardIndex, componentIndex, x, y) {
      try {
        var card = this.cardColumns[cardColumn][cardIndex];
        var component = card.components[componentIndex];

        var newColumn = (cardColumn + x) % this.cardColumns.length;
        var newCardIndex;
        var newComponentIndex;
        if (newColumn != cardColumn) {
          newCardIndex = cardIndex % this.cardColumns[newColumn].length;
          newComponentIndex = 0;
        } else {
          var newComponentIndex = componentIndex + y;
          if (newComponentIndex >= card.components.length) {
            newComponentIndex = 0;
            newCardIndex = (cardIndex + 1) % this.cardColumns[newColumn].length;
          } else if (newComponentIndex < 0) {
            newCardIndex =
              (cardIndex + this.cardColumns[newColumn].length - 1) %
              this.cardColumns[newColumn].length;
            newComponentIndex = this.cardColumns[newColumn][newCardIndex]
              .components.length;
          } else {
            newCardIndex = cardIndex;
          }
        }
        var newCard = this.cardColumns[newColumn][newCardIndex];
        this.cardColumns[cardColumn][cardIndex].components.splice(
          componentIndex,
          1
        );
        newCard.components.splice(newComponentIndex, 0, component);
      } catch (e) {
        console.error("error moving card", x, y, e);
      }
    },
    sanitizeCardColumns(cardColumns) {
      cardColumns.forEach((column, colIndex) => {
        column.forEach((card: Card, cardIndex) => {
          // sanitize
          const sanitized: Card = {
            name: undefined,
            components: [],
            height: 1,
            color: "green-gradient",
            state: {
              hidden: false
            }
          };
          cardColumns[colIndex][cardIndex] = Object.assign(sanitized, card);

          card.components.forEach((component, componentIndex) => {
            var sanitized: CardComponent = {
              component: undefined,
              value: undefined,
              state: {
                hidden: false
              }
            };

            card.components[componentIndex] = Object.assign(
              sanitized,
              component
            );
          });
        });
      });

      this.cardColumns = cardColumns;
    },
    async getCardLayout(auto) {
      if (!auto) {
        try {
          let found = await this.$scrypted.userStorage.getItem(
            `${this.currentLayoutKey}`
          );
          if (found) {
            found = JSON.parse(found);
            if (found.cardColumns) {
              this.sanitizeCardColumns(found.cardColumns);
              this.cardAlignCenter = !!found.cardAlignCenter;
              return;
            }
          }
        } catch (e) {
          console.error(
            "error restoring card configuration for screen configuration",
            e
          );
        }
      }

      var cards = this.autoCards;
      const columns = [];

      for (var card of cards) {
        // find teh column with the leeast juink
        if (columns.length < this.columnsForBreakpoint) {
          columns.push([card]);
          continue;
        }

        const least = columns.reduce((a, b) =>
          a.reduce((c, d) => c + d.height, 0) <
          b.reduce((c, d) => c + d.height, 0)
            ? a
            : b
        );
        least.push(card);
      }

      this.sanitizeCardColumns(columns);
    },
    getColumnsForBreakpoint(bp) {
      switch (bp) {
        case "xl":
          return 4;
        case "lg":
          return 3;
        case "md":
          return 2;
        case "sm":
          return 2;
        case "xs":
          return 1;
      }
      return 1;
    }
  },
  computed: {
    isEmpty() {
      for (var col of this.cardColumns) {
        if (col.length) {
          return false;
        }
      }
      return true;
    },
    showCardComponentSettings: {
      get() {
        return !!this.cardComponentSettings;
      },
      set() {
        this.cardComponentSettings = null;
      }
    },
    editCardMode() {
      return this.editMode && this.editCards;
    },
    stylesForBreakpoints() {
      const styles = {};
      for (var bp of ["xs", "sm", "md", "lg", "xl"]) {
        let w = this.getColumnsForBreakpoint(bp);
        styles[`${bp}${12 / w}`] = true;
      }
      return styles;
    },
    columnsForBreakpoint() {
      return this.getColumnsForBreakpoint(this.$vuetify.breakpoint.name);
    },
    autoCards() {
      return getDefaultDashboard(
        this.$store.state.scrypted.devices,
        this.$scrypted.systemManager
      );
    },
    currentLayoutKey() {
      return `cardColumns-${this.$vuetify.breakpoint.name}`;
    }
  }
};
</script>
