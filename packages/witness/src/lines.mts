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
  self:{sharp:['I keep my own record straight: {fact}.','I know my own file by heart: {fact}.','I will say it once, about me: {fact}.'],
   cool:['I have nothing to hide about myself: {fact}.','I tell it the way it went for me: {fact}.','I can give you my side plainly: {fact}.'],
   nervous:['I swear this is my story: {fact}.','I am not hiding anything about me: {fact}.','I remember my own move, I promise: {fact}.'],
   dreamy:['I remember it the way rain remembers glass: {fact}.','I still drift back to that night: {fact}.','I recall my own move, soft as smoke: {fact}.']},
  other:{sharp:['I watched it close: {fact}.','I keep good notes, detective: {fact}.','I know what crossed that ledger: {fact}.'],
   cool:['I saw it plainly enough: {fact}.','I have no stake in it, but here it is: {fact}.','I can tell you what happened over there: {fact}.'],
   nervous:['I only know what I saw, honest: {fact}.','I was nearby, and I am sure of it: {fact}.','I would not make this up: {fact}.'],
   dreamy:['I caught it through the fog: {fact}.','I saw it like a scene in a window: {fact}.','I remember the lamplight on it: {fact}.']}},
 followup:{
  self:{sharp:['I will add something, since you pressed: {fact}.','I can be precise about myself: {fact}.','I will give you the rest of my file: {fact}.'],
   cool:['I suppose you want the rest of it: {fact}.','I will fill in my own details: {fact}.','I can spare another line about me: {fact}.'],
   nervous:['I already told you, but fine: {fact}.','I did not want to say more, but {fact}.','I can explain, really: {fact}.'],
   dreamy:['I hear the rest of it in the rain: {fact}.','I keep coming back to another thing: {fact}.','I remember the next part slowly: {fact}.']},
  other:{sharp:['I will add a detail, since you pressed: {fact}.','I noticed something else as well: {fact}.','I can sharpen that picture for you: {fact}.'],
   cool:['I suppose you want the rest of what I saw: {fact}.','I can give you the other half: {fact}.','I saw something else, if it helps: {fact}.'],
   nervous:['I did not want to get involved, but {fact}.','I think you should also know: {fact}.','I noticed this too, I promise: {fact}.'],
   dreamy:['I remember another flicker of it: {fact}.','I saw more as the rain eased: {fact}.','I can still see the next frame: {fact}.']}},
 retraction:{
  self:{sharp:['I had my own file wrong. The receipt is right: {fact}.','I will correct my record: {fact}.','I misspoke about myself. In fact, {fact}.'],
   cool:['I can admit it. The truth is {fact}.','I will set my record right: {fact}.','I got that wrong. The record says {fact}.'],
   nervous:['I panicked. The truth is {fact}.','I am sorry. It really went like this: {fact}.','I was scared, but here it is: {fact}.'],
   dreamy:['I dreamed it differently. It was this: {fact}.','I let the fog fill it in. Truly, {fact}.','I see it clearly now: {fact}.']},
  other:{sharp:['I had that wrong. The receipt is right: {fact}.','I will correct what I said: {fact}.','I misspoke. In fact, {fact}.'],
   cool:['I misread what I watched. The truth is {fact}.','I will set my account straight: {fact}.','I saw it wrong from where I stood. The record says {fact}.'],
   nervous:['I got mixed up, honest. It was {fact}.','I am sorry, I said it wrong. Really, {fact}.','I should not have guessed. Here it is: {fact}.'],
   dreamy:['I mistook the shadows. It was this: {fact}.','I blurred it in the rain. Truly, {fact}.','I see that night clearly now: {fact}.']}},
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
