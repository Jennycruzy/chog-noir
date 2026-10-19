// Keep assertions unchanged while allowing cold WASM startup on the shared VPS.
export const databaseStartupTimeout=Number(process.env.CHOG_DATABASE_TEST_TIMEOUT_MS??90_000);
if(!Number.isInteger(databaseStartupTimeout)||databaseStartupTimeout<90_000||databaseStartupTimeout>600_000)throw new Error('Invalid database test startup timeout');
