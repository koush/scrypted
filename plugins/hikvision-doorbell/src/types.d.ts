// Local type declarations to support Symbol.dispose without affecting other plugins
declare global {
    interface SymbolConstructor {
        readonly dispose: unique symbol;
    }
}

export {};
