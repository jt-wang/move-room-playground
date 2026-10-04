export function screenStep(direction,yaw,step=.15){
 const right={x:Math.cos(yaw),z:-Math.sin(yaw)},up={x:-Math.sin(yaw),z:-Math.cos(yaw)};
 const v=(direction==='up'||direction==='down')?up:right;const sign=(direction==='left'||direction==='down')?-1:1;
 return {x:v.x*step*sign||0,z:v.z*step*sign||0};
}
export const BRIEFS=[
 {name:'朋友来做客',text:'沙发、餐桌、两把椅子，给朋友留个位置。',needs:{sofa:1,table:1,chair:2}},
 {name:'周末睡个懒觉',text:'一张床、一块地毯，再放一点绿色。',needs:{bed:1,rug:1,plant:1}},
 {name:'阳光下发个呆',text:'一张沙发、两盆绿植和一块软地毯。',needs:{sofa:1,plant:2,rug:1}},
];
export function objectiveProgress(items,needs){const counts={};for(const i of items)counts[i.type]=(counts[i.type]||0)+1;let done=0,total=0;const parts=Object.entries(needs).map(([type,n])=>{const have=Math.min(n,counts[type]||0);done+=have;total+=n;return {type,have,need:n};});return {done,total,complete:done===total,parts};}

// Snap close to each 45-degree stop; retain other angles to one degree.
export function snapRotation(degrees){
 const rounded=Math.round(degrees),stop=Math.round(rounded/45)*45;
 return (((Math.abs(rounded-stop)<=4?stop:rounded)%360)+360)%360;
}
