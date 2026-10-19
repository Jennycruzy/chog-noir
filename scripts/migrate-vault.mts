import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {loadEnv} from './env.mts';
import {localVault,privateVaultKeyFile} from '../packages/publishing/src/vault.mts';
await loadEnv();
await localVault(join(fileURLToPath(new URL('../',import.meta.url)),'runs/publication-vault'),privateVaultKeyFile());
console.log('Vault master key is configured privately; existing ciphertext has been preserved.');
