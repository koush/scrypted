<template>
  <v-card raised>
      <v-toolbar dark color="blue">
      Logs
      <v-spacer></v-spacer>
      <v-text-field v-model="search" append-icon="search" label="Search" single-line hide-details></v-text-field>
    </v-toolbar>
    <v-data-table
      v-if="$vuetify.breakpoint.mdAndUp"
      :headers="headers"
      :items="logs"
      disable-sort
      :items-per-page="rows"
      :search="search"
    >
      <template v-slot:[`item.date`]="{ item }">
        <pre class="caption">{{ new Date(item.timestamp).toLocaleTimeString() }}</pre>
      </template>
      <template v-slot:[`item.pri`]="{ item }">
        <v-chip x-small :color="priToColor(item.level)">{{ item.level }}</v-chip>
      </template>
      <!-- <template v-slot:[`item.tag`]="{ item }">
        <router-link :to="`/component/log${item.path}`">{{ item.title }}</router-link>
      </template> -->
      <template v-slot:[`item.log`]="{ item }">
        <pre class="caption">{{ item.message }}</pre>
        <!-- <div class="caption font-weight-light">
          <router-link :to="item.path">{{ item.title }}</router-link>
        </div> -->
      </template>
    </v-data-table>
    <v-card-text light v-else>
      <div v-for="(item, index) in logs.slice(0, 100)" :key="index">
        <pre class="caption">{{ item.log }}</pre>
        <div v-if="item.t">
          <div>{{ item.t }}</div>
          <pre class="caption">{{ item.ts }}</pre>
        </div>
        <div>{{ item.date }}</div>
      </div>
    </v-card-text>
  </v-card>
</template>
<script>
export default {
  props: {
    logRoute: {
      type: String
    },
    rows: {
      type: Number,
      default: 500
    }
  },
  disconnect: null,
  watch: {
    logRoute: {
      deep: true,
      handler() {
        this.disconnect?.();
        this.connect();
      }
    }
  },
  data() {
    return {
      search: "",
      logs: [],
      headers: [
        {
          text: "Time",
          value: "date",
          width: 40
        },
        {
          text: "Priority",
          value: "pri",
          width: 40
        },
        // {
        //   text: ".",
        //   value: "tag",
        //   width: 80
        // },
        {
          text: "Message",
          value: "log"
        }
      ]
    };
  },

  methods: {
    priToColor(level) {
      switch (level.toUpperCase()) {
        case "E":
          return "error";
        case "I":
          return "info";
        case "W":
          return "warning";
        case "V":
          return "success";
      }
    },
    async connect() {
      let logger = await this.$scrypted.systemManager.getComponent("logger");
      const parts = this.logRoute.split('/');
      for (const part of parts) {
        if (!part)
          continue;
        logger = await logger.getLogger(part);
      }
      this.logs.push(...await logger.getLogs());
      this.logs.reverse();

      const observer = (entry) => {
        this.logs.unshift(entry);
      }

      this.disconnect = () => {
        this.disconnect = null;
        logger.removeListener('log', observer);
      }

      logger.on('log', observer);
    },
  },
  destroyed() {
    this.disconnect();
  },
  mounted() {
    this.connect();
  }
};
</script>