import typing


async def writeWorkerGenerator(gen, out: typing.TextIO):
    try:
        async for item in gen:
            out.buffer.write(item)
    except Exception as e:
        pass
