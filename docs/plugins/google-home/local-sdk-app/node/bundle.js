!function(e){var t={};function o(n){if(t[n])return t[n].exports;var r=t[n]={i:n,l:!1,exports:{}};return e[n].call(r.exports,r,r.exports,o),r.l=!0,r.exports}o.m=e,o.c=t,o.d=function(e,t,n){o.o(e,t)||Object.defineProperty(e,t,{enumerable:!0,get:n})},o.r=function(e){"undefined"!=typeof Symbol&&Symbol.toStringTag&&Object.defineProperty(e,Symbol.toStringTag,{value:"Module"}),Object.defineProperty(e,"__esModule",{value:!0})},o.t=function(e,t){if(1&t&&(e=o(e)),8&t)return e;if(4&t&&"object"==typeof e&&e&&e.__esModule)return e;var n=Object.create(null);if(o.r(n),Object.defineProperty(n,"default",{enumerable:!0,value:e}),2&t&&"string"!=typeof e)for(var r in e)o.d(n,r,function(t){return e[t]}.bind(null,r));return n},o.n=function(e){var t=e&&e.__esModule?function(){return e.default}:function(){return e};return o.d(t,"a",t),t},o.o=function(e,t){return Object.prototype.hasOwnProperty.call(e,t)},o.p="",o(o.s=0)}([function(e,t){const o=new smarthome.App("1.0.0");let n=11080;o.onIdentify(async e=>{var t;console.debug("IDENTIFY request:",e);if("scrypted-gh"!==(null===(t=e.inputs[0].payload.device.mdnsScanData)||void 0===t?void 0:t.type))throw console.error("mdns type not 'scrypted-gh'"),Error("mdns type not 'scrypted-gh'");n=parseInt(e.inputs[0].payload.device.mdnsScanData.txt.port);const o={intent:smarthome.Intents.IDENTIFY,requestId:e.requestId,payload:{device:{id:"local-hub-id",isProxy:!0,isLocalOnly:!0}}};return console.debug("IDENTIFY response:",o),o}).onReachableDevices(e=>{console.debug("REACHABLE_DEVICES request:",e);const t=e.devices.map(e=>({verificationId:e.id})).filter(e=>"local-hub-id"!==e.verificationId),o={intent:smarthome.Intents.REACHABLE_DEVICES,requestId:e.requestId,payload:{devices:t}};return console.debug("REACHABLE_DEVICES response:",e),o}).onQuery(async e=>{try{console.debug("QUERY request",e);const t=new smarthome.DataFlow.HttpRequestData;t.requestId=e.requestId,t.deviceId=e.inputs[0].payload.devices[0].id,t.method=smarthome.Constants.HttpOperation.POST,t.port=n,t.path="/endpoint/@scrypted/google-home/public",t.dataType="application/json",delete e.devices,t.data=JSON.stringify(e);try{const e=await o.getDeviceManager().send(t);console.log("COMMAND result",e);const n=e.httpResponse.body,r=JSON.parse(n);return console.log("QUERY result",r),r}catch(e){throw console.error("QUERY error",e),e}}catch(e){throw console.error("QUERY failure",e),e}}).onExecute(async e=>{try{console.debug("EXECUTE request",e);const t=new smarthome.DataFlow.HttpRequestData;t.requestId=e.requestId,t.deviceId=e.inputs[0].payload.commands[0].devices[0].id,t.method=smarthome.Constants.HttpOperation.POST,t.port=n,t.path="/endpoint/@scrypted/google-home/public",t.dataType="application/json",delete e.devices,t.data=JSON.stringify(e);try{const e=await o.getDeviceManager().send(t);console.log("COMMAND result",e);const n=e.httpResponse.body,r=JSON.parse(n);return console.log("EXECUTE result",r),r}catch(e){throw console.error("EXECUTE error",e),e}}catch(e){throw console.error("EXECUTE failure",e),e}}).listen().then(()=>{console.log("Ready")})}]);