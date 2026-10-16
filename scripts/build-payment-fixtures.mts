import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {assessPaymentWindow,type PaymentWindowInput} from '../packages/core/src/payment-window.mts';
const records=[
  ['unpaid','0xe3fa036d75423405a28f8f79664906e1623840f7d4507ddd5f2991be88717824-142.json'],
  ['paid','0xac5436c4a942dceef690a54967db391c6741f3c01a9099592ac27d5c4a55346e-132.json'],
] as const;
const directory=new URL('../packages/core/test/history/',import.meta.url);await mkdir(directory,{recursive:true});
for(const [name,file]of records) {
  const saved=JSON.parse(await readFile(new URL(`../data/payment-windows/${file}`,import.meta.url),'utf8')) as {checkedAt:string;input:PaymentWindowInput};
  const assessment=assessPaymentWindow(saved.input);
  if((name==='unpaid'&&assessment.status!=='NO_PAYMENT_FOUND')||(name==='paid'&&assessment.status!=='PAYMENT_FOUND'))throw new Error('DATA_FIXTURE: Payment-window expectation does not match saved evidence');
  await writeFile(new URL(`payment-${name}.json`,directory),JSON.stringify(saved,null,2)+'\n');
  console.log(JSON.stringify({fixture:name,status:assessment.status,pages:saved.input.pages.length}));
}
