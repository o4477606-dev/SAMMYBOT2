// SAMMYBOT: статический сервер + прокси распознавания. Зависимостей нет, нужен Node 18+.
const http=require('http'),fs=require('fs'),path=require('path');
const KEY=process.env.ANTHROPIC_API_KEY, MODEL=process.env.MODEL||'claude-sonnet-5-5', PORT=process.env.PORT||3000;
const PUB=path.join(__dirname,'public');
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
const hits=new Map(); // простой лимит: 20 запросов в минуту с одного адреса
function limited(ip){const n=Date.now(),a=(hits.get(ip)||[]).filter(t=>n-t<60000);a.push(n);hits.set(ip,a);return a.length>20}
const PROMPT='Ты модуль распознавания еды в дневнике питания. На фото определи блюдо и оцени массу порции в граммах по визуальным ориентирам (стандартная тарелка 24-27 см, вилка, ложка, монета, рука). Верни ТОЛЬКО JSON такого вида: {"food":true,"top3":[{"name":"название по-русски","db_name":"точное название из списка ниже или null","p":0.0,"c100":0}],"grams":0,"has_scale":true,"scale_object":"что использовано как ориентир"}. Если еды на фото нет, food=false. Если надёжного ориентира размера нет, has_scale=false, но всё равно дай лучшую оценку grams по типичным размерам порций. Всегда заполняй grams и c100 числами. c100 — содержание усваиваемых углеводов в г на 100 г готового блюда для этого варианта (по справочным таблицам состава продуктов, с учётом гарнира, соуса и панировки). p — честная уверенность от 0 до 1, сумма по трём вариантам не больше 1. Список блюд базы: ';
async function recognize(image,dishes){
  const m=/^data:(image\/jpeg|image\/png|image\/webp);base64,(.+)$/.exec(image||'');
  if(!m)throw new Error('bad image');
  const r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',
    headers:{'x-api-key':KEY,'anthropic-version':'2023-06-01','content-type':'application/json'},
    body:JSON.stringify({model:MODEL,max_tokens:700,messages:[{role:'user',content:[
      {type:'image',source:{type:'base64',media_type:m[1],data:m[2]}},
      {type:'text',text:PROMPT+(Array.isArray(dishes)?dishes.slice(0,60).join('; '):'')}]}]})});
  if(!r.ok)throw new Error('upstream '+r.status);
  const j=await r.json(), t=(j.content||[]).map(x=>x.text||'').join('');
  const a=t.indexOf('{'),b=t.lastIndexOf('}');
  return JSON.parse(t.slice(a,b+1));
}
http.createServer(async(req,res)=>{
  const ip=(req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',')[0].trim();
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method==='POST'&&req.url==='/api/recognize'){
    if(!KEY){res.writeHead(500);return res.end('{"err":"no_key"}')}
    if(limited(ip)){res.writeHead(429);return res.end('{"err":"rate"}')}
    let body='';req.on('data',c=>{body+=c;if(body.length>6e6)req.destroy()});
    req.on('end',async()=>{
      try{const {image,dishes}=JSON.parse(body);const out=await recognize(image,dishes);
        res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(out))}
      catch(e){res.writeHead(502,{'Content-Type':'application/json'});res.end('{"err":"fail"}')}});
    return;
  }
  if(req.method!=='GET'){res.writeHead(405);return res.end()}
  let p=req.url.split('?')[0];if(p==='/')p='/index.html';
  const f=path.join(PUB,path.normalize(p));
  if(!f.startsWith(PUB)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);return res.end('Not found')}
  res.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(res);
}).listen(PORT,()=>console.log('SAMMYBOT on :'+PORT));
