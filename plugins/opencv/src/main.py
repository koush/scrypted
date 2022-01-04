from typing import Any
from scrypted_sdk import systemManager, remote
import asyncio
from opencv import OpenCVPlugin

async def require_plugins(plugins: Any):
    api = remote.api
    logger = await api.getLogger(None)
    pluginsComponent = await systemManager.getComponent('plugins')
    for plugin in plugins:
        found = await pluginsComponent.getIdForPluginId(plugin)
        if found:
            continue
        name = plugins[plugin]
        await logger.log('a', 'Installation of the %s plugin is also recommended. origin:/#/component/plugin/install/%s' % (name, plugin))
        

def create_scrypted_plugin():
    plugins = {
      '@scrypted/objectdetector': "Video Analysis Plugin",
    }
    asyncio.run_coroutine_threadsafe(require_plugins(plugins), loop=asyncio.get_event_loop())

    return OpenCVPlugin()
