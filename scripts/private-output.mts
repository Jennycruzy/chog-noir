import {mkdir} from 'node:fs/promises';
import {homedir} from 'node:os';
import {resolve,dirname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

export async function privateOutput(relative: string): Promise<string> {
 const root=resolve(process.env.CHOG_PRIVATE_DIR || resolve(homedir(),'chognoir-private'));
 const repository=resolve(fileURLToPath(new URL('../',import.meta.url)));
 if(root===repository || root.startsWith(repository+sep))throw new Error('PRIVATE_OUTPUT_ROOT: Private storage must stay outside the repository');
 const target=resolve(root,relative);
 if(!target.startsWith(root+sep))throw new Error('PRIVATE_OUTPUT_PATH: Output must stay in private storage');
 await mkdir(dirname(target),{recursive:true,mode:0o700});
 return target;
}
