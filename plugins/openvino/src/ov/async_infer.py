import concurrent.futures


def create_executors(name: str):
    prepare = concurrent.futures.ThreadPoolExecutor(1, "OpenVINO-{f}Prepare")
    predict = concurrent.futures.ThreadPoolExecutor(1, "OpenVINO-{f}}Predict")
    return prepare, predict
