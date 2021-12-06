from asyncio.futures import Future

def safe_set_result(future: Future): 
    try:
        if not future.done():
            future.set_result(None)
    except:
        pass