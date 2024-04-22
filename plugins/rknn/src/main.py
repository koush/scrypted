from rknn import RKNNPlugin, RKNNPluginProxy

def create_scrypted_plugin() -> RKNNPluginProxy:
    return RKNNPluginProxy()

async def fork() -> RKNNPlugin:
    return RKNNPlugin()