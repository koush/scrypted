//HomeKit Types UUID's

const stPre = "000000";
const stPost = "-0000-1000-8000-0026BB765291";


//HomeKitTransportCategoryTypes
export const OTHER_TCTYPE = 1;
export const FAN_TCTYPE = 3;
export const GARAGE_DOOR_OPENER_TCTYPE = 4;
export const LIGHTBULB_TCTYPE = 5;
export const DOOR_LOCK_TCTYPE = 6;
export const OUTLET_TCTYPE = 7;
export const SWITCH_TCTYPE = 8;
export const THERMOSTAT_TCTYPE = 9;
export const SENSOR_TCTYPE = 10;
export const ALARM_SYSTEM_TCTYPE = 11;
export const DOOR_TCTYPE = 12;
export const WINDOW_TCTYPE = 13;
export const WINDOW_COVERING_TCTYPE = 14;
export const PROGRAMMABLE_SWITCH_TCTYPE = 15;

//HomeKitServiceTypes

export const LIGHTBULB_STYPE = stPre + "43" + stPost;
export const SWITCH_STYPE = stPre + "49" + stPost;
export const THERMOSTAT_STYPE = stPre + "4A" + stPost;
export const GARAGE_DOOR_OPENER_STYPE = stPre + "41" + stPost;
export const ACCESSORY_INFORMATION_STYPE = stPre + "3E" + stPost;
export const FAN_STYPE = stPre + "40" + stPost;
export const OUTLET_STYPE = stPre + "47" + stPost;
export const LOCK_MECHANISM_STYPE = stPre + "45" + stPost;
export const LOCK_MANAGEMENT_STYPE = stPre + "44" + stPost;
export const ALARM_STYPE = stPre + "7E" + stPost;
export const WINDOW_COVERING_STYPE = stPre + "8C" + stPost;
export const OCCUPANCY_SENSOR_STYPE = stPre + "86" + stPost;
export const CONTACT_SENSOR_STYPE = stPre + "80" + stPost;
export const MOTION_SENSOR_STYPE = stPre + "85" + stPost;
export const HUMIDITY_SENSOR_STYPE = stPre + "82" + stPost;
export const TEMPERATURE_SENSOR_STYPE = stPre + "8A" + stPost;

//HomeKitCharacteristicsTypes


export const ALARM_CURRENT_STATE_CTYPE = stPre + "66" + stPost;
export const ALARM_TARGET_STATE_CTYPE = stPre + "67" + stPost;
export const ADMIN_ONLY_ACCESS_CTYPE = stPre + "01" + stPost;
export const AUDIO_FEEDBACK_CTYPE = stPre + "05" + stPost;
export const BRIGHTNESS_CTYPE = stPre + "08" + stPost;
export const BATTERY_LEVEL_CTYPE = stPre + "68" + stPost;
export const COOLING_THRESHOLD_CTYPE = stPre + "0D" + stPost;
export const CONTACT_SENSOR_STATE_CTYPE = stPre + "6A" + stPost;
export const CURRENT_DOOR_STATE_CTYPE = stPre + "0E" + stPost;
export const CURRENT_LOCK_MECHANISM_STATE_CTYPE = stPre + "1D" + stPost;
export const CURRENT_RELATIVE_HUMIDITY_CTYPE = stPre + "10" + stPost;
export const CURRENT_TEMPERATURE_CTYPE = stPre + "11" + stPost;
export const HEATING_THRESHOLD_CTYPE = stPre + "12" + stPost;
export const HUE_CTYPE = stPre + "13" + stPost;
export const IDENTIFY_CTYPE = stPre + "14" + stPost;
export const LOCK_MANAGEMENT_AUTO_SECURE_TIMEOUT_CTYPE = stPre + "1A" + stPost;
export const LOCK_MANAGEMENT_CONTROL_POINT_CTYPE = stPre + "19" + stPost;
export const LOCK_MECHANISM_LAST_KNOWN_ACTION_CTYPE = stPre + "1C" + stPost;
export const LOGS_CTYPE = stPre + "1F" + stPost;
export const MANUFACTURER_CTYPE = stPre + "20" + stPost;
export const MODEL_CTYPE = stPre + "21" + stPost;
export const MOTION_DETECTED_CTYPE = stPre + "22" + stPost;
export const NAME_CTYPE = stPre + "23" + stPost;
export const OBSTRUCTION_DETECTED_CTYPE = stPre + "24" + stPost;
export const OUTLET_IN_USE_CTYPE = stPre + "26" + stPost;
export const OCCUPANCY_DETECTED_CTYPE = stPre + "71" + stPost;
export const POWER_STATE_CTYPE = stPre + "25" + stPost;
export const PROGRAMMABLE_SWITCH_SWITCH_EVENT_CTYPE = stPre + "73" + stPost;
export const PROGRAMMABLE_SWITCH_OUTPUT_STATE_CTYPE = stPre + "74" + stPost;
export const ROTATION_DIRECTION_CTYPE = stPre + "28" + stPost;
export const ROTATION_SPEED_CTYPE = stPre + "29" + stPost;
export const SATURATION_CTYPE = stPre + "2F" + stPost;
export const SERIAL_NUMBER_CTYPE = stPre + "30" + stPost;
export const FIRMWARE_REVISION_CTYPE = stPre + "52" + stPost;
export const STATUS_LOW_BATTERY_CTYPE = stPre + "79" + stPost;
export const STATUS_FAULT_CTYPE = stPre + "77" + stPost;
export const TARGET_DOORSTATE_CTYPE = stPre + "32" + stPost;
export const TARGET_LOCK_MECHANISM_STATE_CTYPE = stPre + "1E" + stPost;
export const TARGET_RELATIVE_HUMIDITY_CTYPE = stPre + "34" + stPost;
export const TARGET_TEMPERATURE_CTYPE = stPre + "35" + stPost;
export const TEMPERATURE_UNITS_CTYPE = stPre + "36" + stPost;
export const VERSION_CTYPE = stPre + "37" + stPost;
export const WINDOW_COVERING_TARGET_POSITION_CTYPE = stPre + "7C" + stPost;
export const WINDOW_COVERING_CURRENT_POSITION_CTYPE = stPre + "6D" + stPost;
export const WINDOW_COVERING_OPERATION_STATE_CTYPE = stPre + "72" + stPost;
export const CURRENTHEATINGCOOLING_CTYPE = stPre + "0F" + stPost;
export const TARGETHEATINGCOOLING_CTYPE = stPre + "33" + stPost;
