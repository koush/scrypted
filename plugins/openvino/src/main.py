from ov import OpenVINOPlugin
import predict

def create_scrypted_plugin():
    return OpenVINOPlugin()

async def fork():
    return predict.Fork(OpenVINOPlugin)
