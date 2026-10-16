import type {EscrowDeal} from '../core/src/escrow.mts';
import type {DatabaseConnection} from './migrate.mts';
export async function storeEscrowDeals(database:DatabaseConnection,deals:readonly EscrowDeal[]):Promise<void> {
  for(const deal of deals) {
    const saved=await database.query(`INSERT INTO escrow_deals(deal_id,token_id,buyer,payment_token,amount_wei,created,sold,collected,cancelled)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(deal_id) DO UPDATE SET
      sold=COALESCE(escrow_deals.sold,EXCLUDED.sold),collected=COALESCE(escrow_deals.collected,EXCLUDED.collected),cancelled=COALESCE(escrow_deals.cancelled,EXCLUDED.cancelled)
      WHERE escrow_deals.token_id=EXCLUDED.token_id AND escrow_deals.buyer=EXCLUDED.buyer
      AND escrow_deals.payment_token=EXCLUDED.payment_token AND escrow_deals.amount_wei=EXCLUDED.amount_wei
      AND escrow_deals.created->'log'=EXCLUDED.created->'log'
      AND (escrow_deals.sold IS NULL OR (escrow_deals.sold->'log'=EXCLUDED.sold->'log' AND escrow_deals.sold->>'seller'=EXCLUDED.sold->>'seller'))
      AND (escrow_deals.collected IS NULL OR escrow_deals.collected->'log'=EXCLUDED.collected->'log')
      AND (escrow_deals.cancelled IS NULL OR escrow_deals.cancelled->'log'=EXCLUDED.cancelled->'log')
      RETURNING deal_id`,[deal.id,deal.tokenId,deal.buyer,deal.paymentToken,deal.amountWei,deal.created,deal.sold,deal.collected,deal.cancelled]) as {rows:unknown[]};
    if(saved.rows.length!==1)throw new Error('DB_SOURCE_CONFLICT: Escrow lifecycle conflicts with a saved chain record');
  }
}
