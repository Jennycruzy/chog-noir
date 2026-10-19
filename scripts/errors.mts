export function safeError(error:unknown):string{
 let message=error instanceof Error?error.message:'Operation failed';
 for(const [name,value] of Object.entries(process.env))if(value&&value.length>=8&&(/KEY|TOKEN|PASSWORD|SECRET|DATABASE_URL/.test(name)||name.startsWith('MONAD_RPC_')))message=message.split(value).join('[redacted]');
 return message.slice(0,2000);
}
