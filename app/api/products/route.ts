import {NextResponse} from 'next/server';
import {db} from '../../../lib/db';
export const dynamic='force-dynamic';
export async function GET(){
 const {data,error}=await db().from('products').select('id,name,description,price,emoji,active').eq('active',true).order('created_at');
 if(error)return NextResponse.json({error:'商品を取得できません'},{status:500});
 return NextResponse.json(data,{headers:{'Cache-Control':'no-store'}});
}
