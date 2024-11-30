export async function eseval(script) {
    // const dataUrl = `data:text/javascript,${encodeURIComponent(script)}`;
    const module = await import(script);   
    return module;
}
