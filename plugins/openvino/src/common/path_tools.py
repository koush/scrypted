from urllib.parse import urlparse, urlunparse

def replace_last_path_component(url, new_path):
    # Parse the original URL
    parsed_url = urlparse(url)
    
    # Split the path into components
    path_components = parsed_url.path.split('/')
    
    # Remove the last component
    if len(path_components) > 1:
        path_components.pop()
    else:
        raise ValueError("URL path has no components to replace")

    # Join the path components back together
    new_path = '/'.join(path_components) + '/' + new_path
    
    # Create a new parsed URL with the updated path
    new_parsed_url = parsed_url._replace(path=new_path)
    
    # Reconstruct the URL
    new_url = urlunparse(new_parsed_url)
    
    return new_url
