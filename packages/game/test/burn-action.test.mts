import {test,expect} from 'vitest';
import {createPuzzleSession,applyPuzzleAction,puzzleScore,type PuzzleDetective} from '../src/puzzle-session.mts';
import {puzzle} from '../../../apps/api/test/fixture.mts';

const detective:PuzzleDetective={tokenId:11,name:'Detective',skill:'EMPATH',uses:1,questions:6,moneyTalk:false,side:null,freePress:[]};
test('a verified burn adds one question to a holder case, twice at most, and never adds points',()=>{
 let session=createPuzzleSession(puzzle,detective,'HOLDER');const at=puzzle.file.opensAt+60,before=puzzleScore(puzzle,session).score;
 for(let index=0;index<2;index++)session=applyPuzzleAction(puzzle,session,{type:'burn',revision:session.revision},at);
 expect(session.questions).toBe(8);expect(session.burns).toBe(2);expect(puzzleScore(puzzle,session).score).toBe(before);
 expect(()=>applyPuzzleAction(puzzle,session,{type:'burn',revision:session.revision},at)).toThrow('paid twice');
 const rookie=createPuzzleSession(puzzle,{...detective,tokenId:1462,questions:8},'ROOKIE');
 expect(()=>applyPuzzleAction(puzzle,rookie,{type:'burn',revision:0},at)).toThrow('Only a held Chog');
});
