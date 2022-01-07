import { startPluginRemote, startSharedPluginRemote } from "./plugin/plugin-remote-worker";

if (process.argv[3] !== '@scrypted/shared')
    startPluginRemote(process.argv[3]);
else
    startSharedPluginRemote();
