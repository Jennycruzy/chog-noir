import {test,expect} from 'vitest';
import {cleanTrait,traitsFor} from '../src/traits.mts';
const meta=(attributes:[string,string][])=>({name:'CHOG #1',attributes:attributes.map(([trait_type,value])=>({trait_type,value}))});
test('crude trait values are replaced before display or persona generation',()=>{
 for(const word of ['Boob Cap','MILF Lover','Retard','Horny Cap','Boner','BBC','Zero THOTS','Buttcoin Cap']){
  const value=cleanTrait('Head',word);expect(value.safe).toBe(false);expect(value.display).toBe('Slogan cap');expect(value.persona).not.toContain(word);
 }
});
test('powers cover eyes, head override, tier uses, side, mouth and special traits',()=>{
 const xray=traitsFor(1,meta([['Eyes','Happy'],['Head','Blue Laser'],['Tier','Legendary'],['Side','Right'],['Mouth','Gold Tooth'],['Form','Skull']]));
 expect(xray.power).toBe('XRAY');expect(xray.uses).toBe(3);expect(xray.side).toBe('BUYER');expect(xray.moneyTalk).toBe(true);expect(xray.special).toBe(true);
 expect(traitsFor(2,meta([['Eyes','Side Eye'],['Tier','Legendary']])).uses).toBe(1);
 expect(traitsFor(3,meta([['Eyes','Anime Glass'],['Tier','Rare']])).uses).toBe(2);
 expect(traitsFor(4,meta([['Eyes','Happy']])).power).toBe('EMPATH');
});
