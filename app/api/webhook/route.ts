import {NextRequest,NextResponse} from 'next/server';
import Stripe from 'stripe';
import {db} from '../../../lib/db';
export const runtime='nodejs';
export async function POST(req:NextRequest){
 const stripe=new Stripe(process.env.STRIPE_SECRET_KEY!);const signature=req.headers.get('stripe-signature');if(!signature)return new NextResponse('Missing signature',{status:400});
 let event:Stripe.Event;try{event=stripe.webhooks.constructEvent(await req.text(),signature,process.env.STRIPE_WEBHOOK_SECRET!)}catch{return new NextResponse('Invalid signature',{status:400})}
 const database=db();
 if(event.type==='checkout.session.completed'||event.type==='checkout.session.async_payment_succeeded'){
  const s=event.data.object as Stripe.Checkout.Session;
  if(s.payment_status==='paid'&&s.metadata?.order_id){
   const {error}=await database.rpc('mark_order_paid',{p_order_id:s.metadata.order_id,p_email:s.customer_details?.email||'',p_name:s.customer_details?.name||'',p_phone:s.customer_details?.phone||'',p_address:s.shipping_details?JSON.stringify(s.collected_information?.shipping_details):null,p_session_id:s.id});
   if(error){console.error(error);return new NextResponse('Database error',{status:500})}
  }
 }
 if(event.type==='checkout.session.expired'||event.type==='checkout.session.async_payment_failed'){
  const s=event.data.object as Stripe.Checkout.Session;if(s.metadata?.order_id){const {error}=await database.rpc('release_order',{p_order_id:s.metadata.order_id});if(error)return new NextResponse('Database error',{status:500})}
 }
 return NextResponse.json({received:true});
}
