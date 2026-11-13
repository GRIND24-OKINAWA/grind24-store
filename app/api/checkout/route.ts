import {NextRequest,NextResponse} from 'next/server';
import Stripe from 'stripe';
import {db} from '../../../lib/db';
export const runtime='nodejs';
export async function POST(req:NextRequest){
 try{
  const body=await req.json(); const delivery=body.delivery;
  if(delivery!=='pickup'&&delivery!=='shipping')return NextResponse.json({error:'受取方法が不正です'},{status:400});
  if(!Array.isArray(body.items)||body.items.length<1||body.items.length>10)return NextResponse.json({error:'商品を選択してください'},{status:400});
  const database=db();
  const {data:products,error:productsError}=await database.from('products').select('id,name,price,active').eq('active',true);
  if(productsError||!products)return NextResponse.json({error:'商品情報を取得できません'},{status:500});
  const items: {id:string;quantity:number;name:string;price:number}[]=[];
  for(const raw of body.items){const p=products.find(x=>x.id===raw.id);if(!p||!Number.isInteger(raw.quantity)||raw.quantity<1||raw.quantity>10||items.some(x=>x.id===raw.id))return NextResponse.json({error:'商品数が不正です'},{status:400});items.push({id:p.id,quantity:raw.quantity,name:p.name,price:p.price})}
  // Atomic inventory reservation is implemented in SQL, preventing overselling.
  const {data:orderId,error:reserveError}=await database.rpc('reserve_order',{p_items:items.map(({id,quantity})=>({id,quantity})),p_delivery:delivery});
  if(reserveError||!orderId)return NextResponse.json({error:'在庫が不足しているか、注文を作成できません'},{status:409});
  const stripe=new Stripe(process.env.STRIPE_SECRET_KEY!);
  const site=process.env.NEXT_PUBLIC_SITE_URL!;
  try{
   const session=await stripe.checkout.sessions.create({mode:'payment',customer_creation:'always',phone_number_collection:{enabled:true},billing_address_collection:'auto',shipping_address_collection:delivery==='shipping'?{allowed_countries:['JP']}:undefined,shipping_options:delivery==='shipping'?[{shipping_rate_data:{type:'fixed_amount',fixed_amount:{amount:800,currency:'jpy'},display_name:'全国発送（仮送料）'}}]:undefined,line_items:items.map(p=>({price_data:{currency:'jpy',unit_amount:p.price,product_data:{name:`OLD SPICE ${p.name}`}},quantity:p.quantity})),metadata:{order_id:orderId,delivery},client_reference_id:orderId,success_url:`${site}/success?session_id={CHECKOUT_SESSION_ID}`,cancel_url:`${site}/?cancelled=1`,expires_at:Math.floor(Date.now()/1000)+1800},{idempotencyKey:`order-${orderId}`});
   const {error:updateError}=await database.from('orders').update({stripe_session_id:session.id}).eq('id',orderId);
   if(updateError)throw updateError;
   return NextResponse.json({url:session.url});
  }catch(e){await database.rpc('release_order',{p_order_id:orderId});throw e}
 }catch(e){console.error('checkout error',e);return NextResponse.json({error:'決済を開始できませんでした'},{status:500})}
}
