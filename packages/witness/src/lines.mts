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
  self:{sharp:['I keep my own books, detective, and they say {fact}.','I will give it to you straight, no trimmings: {fact}.','I know my own paper trail cold: {fact}.'],
   cool:['I could tell this story in my sleep: {fact}.','I am an open book, detective: {fact}.','I have nothing to hide, so here it is: {fact}.'],
   nervous:['I know how this looks, but {fact}.','I have gone over it again and again: {fact}.','I did nothing wrong, look: {fact}.'],
   dreamy:['I still remember the night it happened: {fact}.','I can close my eyes and see it: {fact}.','I think about that move more than I should: {fact}.']},
  other:{sharp:['I watched every second of it: {fact}.','I clocked it the moment it happened: {fact}.','I miss nothing in this market, detective: {fact}.'],
   cool:['I was just passing through, but I saw it: {fact}.','I had a front-row seat: {fact}.','I do not take sides. I just saw it: {fact}.'],
   nervous:['I was right there and could not look away: {fact}.','I would rather stay out of it, but {fact}.','I saw it, and it has been on my mind since: {fact}.'],
   dreamy:['I saw it from across the room: {fact}.','I remember the market going quiet when {fact}.','I can still picture the moment: {fact}.']}},
 followup:{
  self:{sharp:['I see you did your homework. Then you should know {fact}.','I will spell out the rest: {fact}.','I left a detail out. Here it is: {fact}.'],
   cool:['I did not think it mattered, but {fact}.','I suppose you want the rest of it: {fact}.','I can fill in the gaps: {fact}.'],
   nervous:['I was hoping you would not ask, but {fact}.','I should have mentioned this sooner: {fact}.','I left this out because I was nervous: {fact}.'],
   dreamy:['I remember something else from that night: {fact}.','I keep coming back to this detail: {fact}.','I remember how it ended: {fact}.']},
  other:{sharp:['I noticed something else, detective: {fact}.','I can tighten that picture for you: {fact}.','I took notes. Look at this: {fact}.'],
   cool:['I saw the rest too, if you are curious: {fact}.','I can give you the other half: {fact}.','I almost forgot this part: {fact}.'],
   nervous:['I did not want to get involved, but {fact}.','I think you should know this too: {fact}.','I saw more than I let on: {fact}.'],
   dreamy:['I remember what came after: {fact}.','I saw a little more as the night went on: {fact}.','I can still see the next part: {fact}.']}},
 retraction:{
  self:{sharp:['I stand corrected. The receipt is right: {fact}.','I had my own record wrong. In fact, {fact}.','I will correct myself: {fact}.'],
   cool:['I can admit when I am wrong. The truth is {fact}.','I got that wrong. The record says {fact}.','I will set my record straight: {fact}.'],
   nervous:['I lost my nerve. The truth is {fact}.','I am sorry, I said it wrong. Really, {fact}.','I should have told you straight away: {fact}.'],
   dreamy:['I remembered it the way I wanted it. Truly, {fact}.','I let my memory fill the gaps. In truth, {fact}.','I see it clearly now: {fact}.']},
  other:{sharp:['I had that wrong. The receipt is right: {fact}.','I will correct what I said: {fact}.','I misspoke. In fact, {fact}.'],
   cool:['I read it wrong from where I stood. The truth is {fact}.','I will set my account straight: {fact}.','I got it wrong. The record says {fact}.'],
   nervous:['I got it mixed up. It was {fact}.','I said it wrong, and I am sorry. Really, {fact}.','I should not have guessed. Here it is: {fact}.'],
   dreamy:['I mistook what I saw. It was this: {fact}.','I saw what I expected to see. In truth, {fact}.','I see what happened now: {fact}.']}},
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
