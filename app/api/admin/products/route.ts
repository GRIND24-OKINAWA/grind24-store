import {NextRequest,NextResponse} from 'next/server';
import {db} from '../../../../lib/db';
import {isAdmin} from '../../../../lib/admin';
export const dynamic='force-dynamic';
const denied=()=>NextResponse.json({error:'管理者認証が必要です'},{status:401});
export async function GET(req:NextRequest){
 if(!isAdmin(req))return denied();
 const database=db();
 const [{data:products,error:a},{data:inventory,error:b},{data:orders,error:c}]=await Promise.all([
  database.from('products').select('*').order('created_at'),
  database.from('inventory').select('product_id,stock'),
  database.from('orders').select('id,status,items,created_at,delivery').order('created_at',{ascending:false}).limit(5000)
 ]);
 if(a||b||c)return NextResponse.json({error:'データ取得失敗'},{status:500});
 const rows=(products||[]).map(p=>{
  const stock=inventory?.find(i=>i.product_id===p.id)?.stock||0;
  const units=(orders||[]).filter(o=>['paid','shipped','collected'].includes(o.status)).reduce((sum,o)=>sum+(o.items||[]).filter((i:{id:string})=>i.id===p.id).reduce((s:number,i:{quantity:number})=>s+i.quantity,0),0);
  return {...p,stock,units_sold:units,revenue:units*p.price,estimated_gross_profit:units*(p.price-p.cost)};
 });
 return NextResponse.json(rows,{headers:{'Cache-Control':'no-store'}});
}
export async function PATCH(req:NextRequest){
 if(!isAdmin(req))return denied();
 const body=await req.json().catch(()=>null);
 if(!body||typeof body.id!=='string'||!body.id.match(/^[a-z0-9-]{1,60}$/))return NextResponse.json({error:'商品IDが不正です'},{status:400});
 const fields:Record<string,unknown>={};
 for(const key of ['name','description','emoji'])if(body[key]!==undefined){if(typeof body[key]!=='string'||body[key].length>150)return NextResponse.json({error:`${key}が不正です`},{status:400});fields[key]=body[key]}
 for(const key of ['price','cost'])if(body[key]!==undefined){if(!Number.isInteger(body[key])||body[key]<0||body[key]>10000000)return NextResponse.json({error:`${key}が不正です`},{status:400});fields[key]=body[key]}
 if(body.active!==undefined){if(typeof body.active!=='boolean')return NextResponse.json({error:'公開状態が不正です'},{status:400});fields.active=body.active}
 if(body.stock!==undefined&&(!Number.isInteger(body.stock)||body.stock<0||body.stock>1000000))return NextResponse.json({error:'在庫数が不正です'},{status:400});
 const database=db();
 if(Object.keys(fields).length){const {data,error}=await database.from('products').update({...fields,updated_at:new Date().toISOString()}).eq('id',body.id).select('id').single();if(error||!data)return NextResponse.json({error:'商品更新失敗'},{status:500})}
 if(body.stock!==undefined){const {error}=await database.rpc('set_product_stock',{p_id:body.id,p_stock:body.stock});if(error)return NextResponse.json({error:'在庫更新失敗'},{status:500})}
 return NextResponse.json({ok:true});
}
