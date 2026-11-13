import {timingSafeEqual} from 'node:crypto';
export function isAdmin(request:Request){
 const configured=process.env.ADMIN_TOKEN;
 const provided=request.headers.get('authorization')?.replace(/^Bearer /,'')||'';
 if(!configured||configured.length<24||provided.length!==configured.length)return false;
 return timingSafeEqual(Buffer.from(provided),Buffer.from(configured));
}
