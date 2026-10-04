export function doorLabel(t,d){if(d.kind==='door'||d.kind==='window')return t(d.kind==='window'?'genericWindow':'genericDoor',{n:d.ordinal||1});return t(d.id);}
