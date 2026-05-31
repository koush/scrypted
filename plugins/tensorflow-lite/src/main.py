from tflite import TensorFlowLitePlugin
import predict

def create_scrypted_plugin():
    return TensorFlowLitePlugin()

async def fork():
    return predict.Fork(TensorFlowLitePlugin)
