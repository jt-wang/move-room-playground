// Builds the landing in the playground's six languages from the English template (landing/index.html)
// and landing/i18n.json. The template marks text with data-i18n="key" (element content) and
// data-i18n-attr="attr:key ..." (attribute values); the English strings are read from the template itself.
export const ORIGIN='https://move.jingtao.io';
export const LANDING_LOCALES=[
 {code:'zh-Hans',path:'/zh-hans/',name:'简体中文',og:'zh_CN'},
 {code:'zh-Hant',path:'/zh-hant/',name:'繁體中文',og:'zh_TW'},
 {code:'ja',path:'/ja/',name:'日本語',og:'ja_JP'},
 {code:'ko',path:'/ko/',name:'한국어',og:'ko_KR'},
 {code:'en',path:'/',name:'English',og:'en_US'},
 {code:'es',path:'/es/',name:'Español',og:'es_ES'}
];
const escapeAttr=s=>s.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
const unescapeAttr=s=>s.replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&amp;/g,'&');
const ELEMENT=/<([a-z][a-z0-9]*)\b([^>]*?\sdata-i18n="([\w-]+)"[^>]*)>([\s\S]*?)<\/\1>/g;
const ATTR_HOLDER=/<[a-z][a-z0-9]*\b[^>]*\sdata-i18n-attr="([^"]+)"[^>]*>/g;
const pairs=spec=>spec.trim().split(/\s+/).map(p=>{const i=p.indexOf(':');return [p.slice(0,i),p.slice(i+1)];});
const attrValue=(tag,name)=>{const m=new RegExp(`\\s${name}="([^"]*)"`).exec(tag);if(!m)throw Error(`missing ${name} on ${tag}`);return unescapeAttr(m[1]);};

export function englishStrings(template){
 const out={};const add=(k,v)=>{if(Object.hasOwn(out,k)&&out[k]!==v)throw Error('key '+k+' has two different English texts');out[k]=v;};
 for(const m of template.matchAll(ELEMENT))add(m[3],m[4]);
 for(const m of template.matchAll(ATTR_HOLDER))for(const [attr,key] of pairs(m[1]))add(key,attrValue(m[0],attr));
 return out;
}

export function shareHref(text,pageUrl){
 return 'https://x.com/intent/post?text='+encodeURIComponent(text)+'&amp;url='+encodeURIComponent(pageUrl)+'&amp;via=thejingtao';
}

export function localizeLanding(template,code,dict){
 const locale=LANDING_LOCALES.find(l=>l.code===code);if(!locale)throw Error('unknown locale '+code);
 const strings=code==='en'?englishStrings(template):dict[code];
 const get=k=>{const v=strings?.[k];if(typeof v!=='string')throw Error(`missing ${code}.${k}`);return v;};
 const pageUrl=ORIGIN+locale.path;
 let html=template.replace(ELEMENT,(all,tag,attrs,key)=>`<${tag}${attrs}>${get(key)}</${tag}>`);
 html=html.replace(ATTR_HOLDER,tag=>{for(const [attr,key] of pairs(attrValue(tag,'data-i18n-attr')))tag=tag.replace(new RegExp(`(\\s${attr}=")[^"]*(")`),(_,a,b)=>a+escapeAttr(get(key))+b);return tag;});
 html=html.replace(/<a ([^>]*\sdata-share-x[^>]*)>/,tag=>tag.replace(/\shref="[^"]*"/,` href="${shareHref(attrValue(tag,'data-share-text'),pageUrl)}"`));
 html=html.replace(/\sdata-i18n(?:-attr)?="[^"]*"/g,'');
 html=html.replace(/<html lang="[^"]*"/,`<html lang="${code}"`);
 html=html.replace(/(<meta property="og:url" content=")[^"]*(")/,`$1${pageUrl}$2`);
 const links=[`<link rel="canonical" href="${pageUrl}">`,`<meta property="og:locale" content="${locale.og}">`,
  ...LANDING_LOCALES.map(l=>`<link rel="alternate" hreflang="${l.code}" href="${ORIGIN+l.path}">`),`<link rel="alternate" hreflang="x-default" href="${ORIGIN}/">`];
 html=html.replace(/(\n\s*)<link rel="stylesheet"/,(m,ws)=>links.map(l=>ws+l).join('')+m);
 const options=LANDING_LOCALES.map(l=>`<option value="${l.code}"${l.code===code?' selected':''}>${l.name}</option>`).join('');
 html=html.replace(/(<select [^>]*data-lang-select[^>]*>)(<\/select>)/,`$1${options}$2`);
 return html;
}
