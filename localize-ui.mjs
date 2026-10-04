import imported from './imported-room.mjs';
import {t,getLocale,locales,languageNames} from './i18n.mjs';
const texts={
 '#overlap-label':'allowOverlap',
 '#view-menu-title':'viewMenu','#mobile-door-title':'doorTitle','#challenge-title':'challengeTitle','#other-title':'otherTitle','#fine-title':'fineTitle','#edit-more-title':'editMore','#door-title':'doorTitle','title':'pageTitle','.brand h1':'title','#capture':'saveImage','#capture-mobile':'saveImage','#share':'share','.stage-title .pill':'roomName','.stage-title p':'subtitle','#camera-left':'viewLeft','#camera-right':'viewRight','#home':'home','#top':'top','#walls':'walls','#mode-place':'place','#mode-look':'look','.dock-heading span':'rotationHint','#place-done':'done','.brief-title>span':'briefTitle','#next-brief':'nextBrief','.shelf-title h2':'shelf','aside>.muted':'shelfHint','#selection-help':'selectionHelp','#duplicate':'duplicate','#delete':'remove','#undo':'undo','#clear':'clear','#share-dialog h2':'shareTitle','label[for="share-url"]':'shareURL','#share-dialog .muted':'shareNote','#copy-again':'copyLink'
};
const labels={'#object-rotate':'rotateDrag','.stage':'roomLabel','#view':'canvasLabel','#camera-left':'viewLeftLabel','#camera-right':'viewRightLabel','#zoom-in':'zoomIn','#zoom-out':'zoomOut','.mode-tools':'modeLabel','#sound':'soundLabel','[data-step="left"]':'left','[data-step="right"]':'right','[data-step="up"]':'up','[data-step="down"]':'down','#dock-rotate-left':'rotate90Left','#dock-rotate-right':'rotate90Right','#swatches':'colors','#rotate-left':'rotateLeft','#rotate-right':'rotateRight','#close-share':'close','#language':'language'};
export function localizeUI(){
 document.documentElement.lang=getLocale();
 const author=document.querySelector('#author-link');if(author)author.href='https://x.com/thejingtao';
 for(const [selector,key] of Object.entries(texts)){const e=document.querySelector(selector);if(e)e.textContent=t(key);}
 for(const [selector,key] of Object.entries(labels)){const e=document.querySelector(selector);if(e)e.setAttribute('aria-label',t(key));}
 if(imported)document.querySelector('.stage-title .pill').textContent=imported.title;
 document.querySelector('#home').title=t('homeTitle');
 const select=document.querySelector('#language');if(!select.options.length)for(let i=0;i<locales.length;i++)select.add(new Option(languageNames[i],locales[i]));select.value=getLocale();
}
