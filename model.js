export function boardRow(id,p){return {...p,id,durationMs:p.duration,duration:Math.floor(p.duration/1000),completed:p.completed.toMillis()};}
export function playerState(p,bank){
 const a=p.answers,all=bank.questions.flat(),n=a.length,completed=p.completed?.toMillis()||null;
 return {edition:bank.curriculum.id,id:p.id,name:p.name,alias:p.alias,cls:p.class_name,score:p.score,count:n,done:!!completed,completed,duration:completed?Math.floor((completed-p.started.toMillis())/1000):0,rank:null,acknowledged:p.acknowledged,pendingRound:Math.floor(n/5)>p.acknowledged?p.acknowledged:null,
 rounds:bank.questions.map((qs,i)=>{const part=a.slice(i*5,i*5+5);const right=part.filter(x=>x.right).length;return {index:i,completed:part.length===5,score:right*10,correct:right,wrong:part.length-right,mistakes:part.length===5?part.flatMap((r,j)=>r.right?[]:[{question:qs[j].q,selected:qs[j].o[r.choice],answer:r.answer}]):[]};}),
 skills:bank.questions.map((_,i)=>a.slice(i*5,i*5+5).filter(x=>x.right).length*10),question:!completed&&Math.floor(n/5)<=p.acknowledged?{index:n,...all[n]}:null};
}
