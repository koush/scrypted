<template>
  <v-simple-table>
    <thead>
      <tr>
        <th style="width: 10px;" class="text-xs-left"></th>
        <th class="text-xs-left">Name</th>
        <th v-if="extraColumn0">{{ extraColumn0 }}</th>
        <th v-if="$vuetify.breakpoint.mdAndUp && deviceGroup.ownerColumn" class="text-xs-left">{{ deviceGroup.ownerColumn }}</th>
        <th v-if="$vuetify.breakpoint.mdAndUp && extraColumn1">{{ extraColumn1 }}</th>
        <th v-if="$vuetify.breakpoint.mdAndUp && !hideType" class="text-xs-left">Type</th>
      </tr>
    </thead>
    <tbody v-if="deviceGroup.devices.length">
      <tr v-for="device in deviceGroup.devices" :key="device.id">
        <td>
          <v-icon x-small color="#a9afbb">{{ typeToIcon(device.type) }}</v-icon>
        </td>
        <td >
          <a link :href="'#' + getDeviceViewPath(device.id)">{{ device.name }}</a>
        </td>
        <td v-if="extraColumn0"><slot name="extra-column-0" v-bind:device="device"></slot></td>
        <td v-if="$vuetify.breakpoint.mdAndUp && deviceGroup.ownerColumn && getOwnerLink(device)" >
          <a :href="getOwnerLink(device)">{{ getOwnerColumn(device) }}</a>
        </td>
        <td
          v-else-if="$vuetify.breakpoint.mdAndUp && deviceGroup.ownerColumn"
          
        >{{ getOwnerColumn(device) }}</td>
        <td v-if="$vuetify.breakpoint.mdAndUp && extraColumn1"><slot name="extra-column-1" v-bind:device="device"></slot></td>
        <td v-if="$vuetify.breakpoint.mdAndUp && !hideType" >{{ device.type }}</td>
      </tr>
    </tbody>
    <tbody v-else>
      <td></td>
      <td >None found.</td>
    </tbody>
  </v-simple-table>
</template>

<script>
import { typeToIcon, getDeviceViewPath } from "../components/helpers";

export default {
  props: ["deviceGroup", "getOwnerColumn", "getOwnerLink", "hideType", "extraColumn0", "extraColumn1"],
  methods: {
    getDeviceViewPath,
    typeToIcon
  }
};
</script>
