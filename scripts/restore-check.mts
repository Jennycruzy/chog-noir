import {mkdtemp,readdir,readFile,rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CaseVault} from '../packages/publishing/src/vault.mts';
import {puzzleHash,validatePuzzle,type PuzzleCase} from '../packages/cases/src/puzzle.mts';

// Restores the newest backup into a scratch directory and proves it is usable: every published case decrypts with
// the backed-up vault key and still matches its on-chain hash, and every career record parses.
const target=process.env.CHOG_BACKUP_DIR??'/home/ubuntu/chog-noir-backups';
const newest=(await readdir(target)).filter(name=>/^runtime-\d{8}T\d{6}Z\.tar\.gz$/.test(name)).sort().at(-1);
if(!newest)throw new Error('RESTORE_NO_BACKUP: No backup has been written yet');
const work=await mkdtemp(join(tmpdir(),'chog-restore-'));
try{
 await promisify(execFile)('tar',['-C',work,'-xzf',join(target,newest)]);
 const keyPath=join(work,'private/vault.key'),key=await readFile(keyPath).catch(()=>null);
 const records=(await readdir(join(work,'repository/runs/puzzle-publications')).catch(()=>[] as string[])).filter(name=>/^\d{4}-\d{2}-\d{2}\.json$/.test(name));
 if(records.length&&!key)throw new Error('RESTORE_KEY_MISSING: Cases were backed up without their vault key');
 let cases=0;
 for(const file of records){
  const record=JSON.parse(await readFile(join(work,'repository/runs/puzzle-publications',file),'utf8'));
  const puzzle=await new CaseVault(join(work,'repository/runs/publication-vault/cases'),key!).open<PuzzleCase>(record.id);
  if(puzzleHash(puzzle)!==record.answerHash||validatePuzzle(puzzle).length)throw new Error('RESTORE_CASE_MISMATCH: '+record.id);cases++;
 }
 let careers=0;for(const file of (await readdir(join(work,'repository/runs/career')).catch(()=>[] as string[])).filter(name=>/^\d+\.json$/.test(name))){JSON.parse(await readFile(join(work,'repository/runs/career',file),'utf8'));careers++;}
 console.log(JSON.stringify({status:'PASS',backup:newest,cases,careers,vaultKey:!!key}));
}finally{await rm(work,{recursive:true,force:true});}
