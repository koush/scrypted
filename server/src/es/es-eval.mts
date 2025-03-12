export async function eseval(script: string) {
    // const dataUrl = `data:text/javascript,${encodeURIComponent(script)}`;
    const module = await import(script);
    return module;
}
