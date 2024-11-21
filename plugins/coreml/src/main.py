from coreml import CoreMLPlugin
import predict

def create_scrypted_plugin():
    return CoreMLPlugin()

async def fork():
    return predict.Fork(CoreMLPlugin)
