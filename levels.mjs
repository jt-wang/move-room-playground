export function levelVisible(group,level,hiddenWalls){return group.kind!=='ceiling'&&!(group.kind==='walls'&&hiddenWalls)&&(level==='all'||!Number.isInteger(group.level)||group.level===level);}

export function itemLevel(item){return item.level??0;}
export function elevation(item,levels=[]){return levels.find(l=>l.id===itemLevel(item))?.elevation??0;}
export function itemVisible(item,level){return level==='all'||itemLevel(item)===level;}
