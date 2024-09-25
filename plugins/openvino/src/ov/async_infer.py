import concurrent.futures


def create_executors(name: str):
    prepare = concurrent.futures.ThreadPoolExecutor(1, f"OpenVINO-{name}Prepare")
    predict = concurrent.futures.ThreadPoolExecutor(1, f"OpenVINO-{name}Predict")
    return prepare, predict
