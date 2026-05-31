def optional_chain(root, *keys):
    result = root
    for k in keys:
        if isinstance(result, dict):
            result = result.get(k, None)
        else:
            result = getattr(result, k, None)
        if result is None:
            break
    return result
