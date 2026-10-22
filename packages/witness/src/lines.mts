export const voices = ['nervous','sharp','dreamy','cool'] as const;
export interface WitnessLine { line: string; facts_used: string[] }
const banned = /\b(court|jury|verdict|docket|trial|guilty|innocent|scammer|dumper|wash trader|seamless|revolutionary|game-changing|next-generation|guaranteed|AI-powered|boob|milf|retard|horny|boner|bbc|thots|buttcoin)\b/i;
/**
 * Every number, date and name in a line must be one of the given facts, copied exactly; nothing else may carry a value.
 */
export function validateLine(input: { displayFacts: readonly string[] }, output: unknown): string[] {
  if (!output || typeof output !== 'object') return ['INVALID_SCHEMA'];
  const { line, facts_used } = output as Partial<WitnessLine>;
  if (typeof line !== 'string' || !Array.isArray(facts_used) || facts_used.some(value => typeof value !== 'string') || Object.keys(output).some(key => !['line','facts_used'].includes(key))) return ['INVALID_SCHEMA'];
  const errors: string[] = [];
  if (line.length > 160 || !line.trim()) errors.push('LENGTH');
  if ((line.match(/[.!?](?:\s|$)/g)?.length ?? 0) > 2) errors.push('SENTENCES');
  if (banned.test(line)) errors.push('BANNED_WORD');
  const expected = [...new Set(input.displayFacts)].sort();
  if (JSON.stringify([...new Set(facts_used)].sort()) !== JSON.stringify(expected) || facts_used.length !== expected.length) errors.push('FACTS_USED');
  let remainder = line;
  for (const fact of [...expected].sort((a,b) => b.length - a.length)) {
    if (!fact || !line.includes(fact)) errors.push('MISSING_FACT');
    remainder = remainder.split(fact).join('');
  }
  if (/\d|0x|CHOG\s*#|\b(one|two|three|four|five|six|seven|eight|nine|ten|hundred|thousand)\b/i.test(remainder)) errors.push('EXTRA_VALUE');
  return [...new Set(errors)];
}
/** What a statement is for: the opening line, the follow-up behind Press, or the new story a caught witness tells. */
export type StatementPurpose='opening'|'followup'|'retraction';
type Voice=typeof voices[number];
// Each template wraps one exact fact clause. They add tone only: no names, numbers, dates or other claims.
// "self" templates are for a witness speaking about its own record; "other" templates for one speaking about another Chog.
const statementTemplates:Record<StatementPurpose,Record<'self'|'other',Record<Voice,readonly [string,string,string]>>>={
 opening:{
  self:{sharp:['I know my own record: {fact}.','I can state my own history clearly: {fact}.','I will keep this short, about myself: {fact}.'],
   cool:['I have nothing to hide about myself: {fact}.','I can tell you how it went for me: {fact}.','I will give you my side plainly: {fact}.'],
   nervous:['I think I remember this right: {fact}.','I am fairly sure about my own move: {fact}.','I hope I have this right: {fact}.'],
   dreamy:['I remember that night well: {fact}.','I still think back to it: {fact}.','I recall my own move clearly: {fact}.']},
  other:{sharp:['I watched it closely: {fact}.','I keep careful notes, detective: {fact}.','I know what went through that wallet: {fact}.'],
   cool:['I saw it plainly enough: {fact}.','I have no stake in it, but here it is: {fact}.','I can tell you what happened over there: {fact}.'],
   nervous:['I only know what I saw: {fact}.','I was close by, and I believe {fact}.','I would not make this up: {fact}.'],
   dreamy:['I remember watching it happen: {fact}.','I saw it from a distance: {fact}.','I can still picture it: {fact}.']}},
 followup:{
  self:{sharp:['I will add something, since you asked: {fact}.','I can be precise about myself: {fact}.','I will give you the rest of my record: {fact}.'],
   cool:['I suppose you want the rest: {fact}.','I will fill in my own details: {fact}.','I can add another detail about me: {fact}.'],
   nervous:['I already told you most of it, but {fact}.','I was hoping you would not ask, but {fact}.','I can explain the rest: {fact}.'],
   dreamy:['I remember something else now: {fact}.','I keep coming back to another detail: {fact}.','I recall the next part: {fact}.']},
  other:{sharp:['I will add a detail, since you asked: {fact}.','I noticed something else as well: {fact}.','I can make that picture sharper: {fact}.'],
   cool:['I suppose you want the rest of what I saw: {fact}.','I can give you the other half: {fact}.','I saw something else, if it helps: {fact}.'],
   nervous:['I did not want to get involved, but {fact}.','I think you should also know: {fact}.','I noticed this as well: {fact}.'],
   dreamy:['I remember another part of it: {fact}.','I saw a little more later on: {fact}.','I can still see what came next: {fact}.']}},
 retraction:{
  self:{sharp:['I had my own record wrong. The receipt is right: {fact}.','I will correct my record: {fact}.','I misspoke about myself. In fact, {fact}.'],
   cool:['I can admit it. The truth is {fact}.','I will set my record straight: {fact}.','I got that wrong. The record says {fact}.'],
   nervous:['I said it wrong. The truth is {fact}.','I am sorry. It really went like this: {fact}.','I should have been straight with you. Here it is: {fact}.'],
   dreamy:['I remembered it differently. It was this: {fact}.','I filled in the gaps wrongly. In truth, {fact}.','I see it clearly now: {fact}.']},
  other:{sharp:['I had that wrong. The receipt is right: {fact}.','I will correct what I said: {fact}.','I misspoke. In fact, {fact}.'],
   cool:['I misread what I saw. The truth is {fact}.','I will set my account straight: {fact}.','I saw it wrong from where I stood. The record says {fact}.'],
   nervous:['I got it mixed up. It was {fact}.','I am sorry, I said it wrong. Really, {fact}.','I should not have guessed. Here it is: {fact}.'],
   dreamy:['I mistook what I saw. It was this: {fact}.','I misremembered it. In truth, {fact}.','I see what happened now: {fact}.']}},
};
/** Speaks one exact fact clause in a witness's voice, chosen by a stable seed. Facts are copied, never reworded. */
export function witnessStatement(input:{fact:string;purpose:StatementPurpose;voice:Voice;self:boolean;seed:string;limit?:number}){
 const {fact,purpose,voice,self,seed,limit=140}=input;
 if(!fact||/[\r\n]/.test(fact))throw new Error('WITNESS_STATEMENT: A single fact clause is required');
 const options=statementTemplates[purpose]?.[self?'self':'other']?.[voice];if(!options)throw new Error('WITNESS_STATEMENT: Unknown purpose or voice');
 let hash=0;for(const char of seed)hash=(hash*31+char.charCodeAt(0))>>>0;
 // Prefer the seeded template; fall back to a shorter one when the fact is long; never exceed the limit.
 for(let step=0;step<options.length;step++){const line=options[(hash+step)%options.length]!.replace('{fact}',fact);if(line.length<=limit)return line;}
 throw new Error('WITNESS_STATEMENT: The fact is too long for a statement');
}
