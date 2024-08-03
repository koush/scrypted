import start from './scrypted-main-exports';

if (process.versions.deno)
    start(process.env.SCRYPTED_MAIN_FILENAME);
else
    start(__filename);
