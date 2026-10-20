import {test,expect} from 'vitest';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {privateOutput} from './private-output.mts';

test('report output stays outside the repository and rejects escaping its private root',async()=>{
 const previous=process.env.CHOG_PRIVATE_DIR;
 const directory=await mkdtemp(join(tmpdir(),'chog-private-'));
 try{
  process.env.CHOG_PRIVATE_DIR=directory;
  expect(await privateOutput('checks/result.json')).toBe(join(directory,'checks/result.json'));
  expect((await stat(join(directory,'checks'))).mode & 0o077).toBe(0);
  await expect(privateOutput('../exposed.json')).rejects.toThrow('PRIVATE_OUTPUT_PATH');
  await expect(privateOutput('/exposed.json')).rejects.toThrow('PRIVATE_OUTPUT_PATH');
  process.env.CHOG_PRIVATE_DIR=fileURLToPath(new URL('../reports',import.meta.url));
  await expect(privateOutput('result.json')).rejects.toThrow('PRIVATE_OUTPUT_ROOT');
 }finally{
  if(previous===undefined)delete process.env.CHOG_PRIVATE_DIR;else process.env.CHOG_PRIVATE_DIR=previous;
  await rm(directory,{recursive:true,force:true});
 }
});
