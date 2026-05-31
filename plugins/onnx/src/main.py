from ort import ONNXPlugin
import predict

def create_scrypted_plugin():
    return ONNXPlugin()

async def fork():
    return predict.Fork(ONNXPlugin)
