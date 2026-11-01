import {initializeApp} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {getAuth,setPersistence,browserLocalPersistence,createUserWithEmailAndPassword,signInWithEmailAndPassword,signOut} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {getFirestore,doc,getDoc,setDoc,updateDoc,collection,getDocs,query,orderBy,limit,where,getCountFromServer,runTransaction,serverTimestamp,writeBatch} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import {firebaseConfig,teacherEmail} from './firebase-config.js';
import {playerState,boardRow} from './model.js';
let auth,db,bank,ready;
export async function connect(){
 if(!ready)ready=(async()=>{
  if(!firebaseConfig.apiKey || !firebaseConfig.projectId)throw Error('ربط Firebase لم يكتمل. أضيفي إعدادات المشروع إلى firebase-config.js أولًا.');
  const app=initializeApp(firebaseConfig);auth=getAuth(app);db=getFirestore(app);
  await setPersistence(auth,browserLocalPersistence);await auth.authStateReady();
  const r=await fetch(new URL('./questions.json',import.meta.url));if(!r.ok)throw Error('تعذر تحميل محتوى المسابقة');bank=await r.json();
 })().catch(e=>{ready=null;throw e});return ready;
}
const current=()=>{if(!auth.currentUser)throw Error('سجّلي الدخول أولًا.');return auth.currentUser.uid;};
async function isTeacher(){if(!auth.currentUser)return false;return (await getDoc(doc(db,'teachers',auth.currentUser.uid))).exists();}
async function settings(){return (await getDoc(doc(db,'settings','public'))).data()||{closed:false};}
async function playerDoc(){if(!auth.currentUser)return null;const s=await getDoc(doc(db,'players',auth.currentUser.uid));return s.exists()?{id:s.id,...s.data()}:null;}
async function publish(p){if(!p?.completed)return;const ref=doc(db,'leaderboard',p.id);if((await getDoc(ref)).exists())return;await setDoc(ref,{alias:p.alias,score:p.score,duration:p.completed.toMillis()-p.started.toMillis(),completed:p.completed,question_set:p.question_set});}
async function state(p){if(!p)return null;const result=playerState(p,bank);if(p.completed){await publish(p);const higher=await getCountFromServer(query(collection(db,'leaderboard'),where('score','>',p.score)));const faster=await getCountFromServer(query(collection(db,'leaderboard'),where('score','==',p.score),where('duration','<',p.completed.toMillis()-p.started.toMillis())));result.rank=1+higher.data().count+faster.data().count;}return result;}
// Choice is committed before its key becomes readable. Rules make the submitted choice immutable.
async function settle(){let p=await playerDoc();if(!p||p.pending<0)return p;
 const n=p.answers.length,k=(await getDoc(doc(db,'answerKeys',String(n)))).data();if(!k)throw Error('أسئلة المسابقة غير مفعّلة. تواصلي مع المعلمة.');
 const ref=doc(db,'players',p.id);
 await runTransaction(db,async tx=>{const a=(await tx.get(ref)).data();if(a.pending<0||a.answers.length!==n)return;
  const r={choice:a.pending,right:a.pending===k.correct,answer:k.answer};
  tx.update(ref,{answers:[...a.answers,r],score:a.score+(r.right?10:0),pending:-1,completed:n===29?serverTimestamp():null,updated:serverTimestamp()});
 });p=await playerDoc();await publish(p);return p;
}
async function nameEmail(name){const normalized=name.normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('en');const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(normalized));return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('')+'@students.invalid';}
function message(e){const c=e.code||'';if(c==='auth/email-already-in-use')return 'الاسم مسجّل سابقًا. استخدمي تسجيل الدخول أو أضيفي اسم العائلة.';if(c==='auth/invalid-credential'||c==='auth/wrong-password'||c==='auth/user-not-found')return 'الاسم أو الرمز غير صحيح.';if(c==='auth/weak-password')return 'اختاري رمزًا من 6 أحرف على الأقل.';if(c==='permission-denied')return 'الصلاحية غير متاحة. تأكدي من نشر قواعد Firebase الصحيحة أو تواصلي مع المعلمة.';if(c==='resource-exhausted'||c==='auth/too-many-requests')return 'وصلت الخدمة لحد الاستخدام أو المحاولات. حاولي لاحقًا.';if(c==='failed-precondition')return 'قاعدة البيانات تحتاج الفهرس المرفق. راجعي دليل الإعداد.';return e.message||'تعذر الاتصال. حاولي مجددًا.';}
export async function api(path,body){try{await connect();const route=path.split('?')[0];
 if(route==='me'){const p=await settle(),t=await isTeacher();return {curriculum:bank.curriculum,signedIn:!!p,teacher:t,teacherSignedIn:t,teacherConfigured:true,closed:(await settings()).closed,player:await state(p)};}
 if(route==='register'||route==='login'){
  const name=String(body.name||'').trim().normalize('NFC'),code=String(body.code||'').trim();if(name.length<2||name.length>70||code.length<6||code.length>80)throw Error('أدخلي اسمًا من 2 إلى 70 حرفًا ورمزًا من 6 إلى 80 حرفًا.');
  const email=await nameEmail(name);
  if(route==='register'){
   if((await settings()).closed)throw Error('التسجيل مغلق حاليًا.');
   // If account creation succeeded but the profile write was interrupted, login completes it.
   await createUserWithEmailAndPassword(auth,email,code);
  }else await signInWithEmailAndPassword(auth,email,code);
  let p=await playerDoc();if(!p){const uid=current();await setDoc(doc(db,'players',uid),{name,alias:name.split(/\s+/)[0].slice(0,30),class_name:'',question_set:bank.curriculum.id,answers:[],pending:-1,score:0,acknowledged:0,started:serverTimestamp(),completed:null,updated:serverTimestamp()});p=await playerDoc();}
  return {player:await state(await settle())};
 }
 if(route==='logout'||route==='admin/logout'){await signOut(auth);return {ok:true};}
 if(route==='admin/login'){await signInWithEmailAndPassword(auth,teacherEmail,body.password);if(!await isTeacher()){await signOut(auth);throw Error('هذا الحساب غير مخوّل كمعلمة.');}return {ok:true};}
 if(route==='answer'){
  const ref=doc(db,'players',current());let snapshot;
  await runTransaction(db,async tx=>{snapshot=(await tx.get(ref)).data();if(!snapshot)throw Error('سجّلي أولًا.');if(body.index!==snapshot.answers.length||snapshot.pending!==-1)throw Error('الإجابة محفوظة أو الصفحة تحتاج تحديثًا.');if(!Number.isInteger(body.choice)||body.choice<0||body.choice>3)throw Error('اختيار غير صالح.');tx.update(ref,{pending:body.choice,updated:serverTimestamp()});});
  const p=await settle(),r=p.answers[body.index];return {player:await state(p),feedback:{right:r.right,answer:r.answer}};
 }
 if(route==='round/ack'){const ref=doc(db,'players',current());await runTransaction(db,async tx=>{const p=(await tx.get(ref)).data();if(body.round<p.acknowledged)return;if(body.round!==p.acknowledged||p.answers.length<(body.round+1)*5)throw Error('أكملي الجولة أولًا.');tx.update(ref,{acknowledged:p.acknowledged+1,updated:serverTimestamp()});});return {player:await state(await playerDoc())};}
 if(route==='leaderboard'){const q=query(collection(db,'leaderboard'),orderBy('score','desc'),orderBy('duration','asc'),limit(50));const [s,count]=await Promise.all([getDocs(q),getCountFromServer(collection(db,'leaderboard'))]);let last,rank=0;return {list:s.docs.map((d,i)=>{const v=boardRow(d.id,d.data());if(!last||last.score!==v.score||last.durationMs!==v.durationMs)rank=i+1;last=v;return {...v,rank};}),total:count.data().count,edition:bank.curriculum.id};}
 if(route.startsWith('verify/')){const s=await getDoc(doc(db,'leaderboard',route.slice(7)));if(!s.exists())throw Error('الشهادة غير موجودة أو لم تكتمل المسابقة.');return boardRow(s.id,s.data());}
 if(route==='teacher'||route==='teacher/settings'){
  if(!await isTeacher())throw Error('دخول المعلمة مطلوب.');if(route==='teacher/settings'){await setDoc(doc(db,'settings','public'),{closed:!!body.closed});return {ok:true};}
  const s=await getDocs(collection(db,'players'));return {closed:(await settings()).closed,players:s.docs.map(d=>{const p=d.data();return {...p,id:d.id,completed:p.completed?.toMillis()||null,duration:p.completed?Math.floor((p.completed.toMillis()-p.started.toMillis())/1000):0};})};
 }
 throw Error('العملية غير مدعومة.');
 }catch(e){throw Error(message(e));}}
export async function importKeys(keys){await connect();if(!await isTeacher())throw Error('حساب المعلمة مطلوب.');if(!Array.isArray(keys)||keys.length!==30||keys.some((k,i)=>k.index!==i||typeof k.answer!=='string'||!Number.isInteger(k.correct)||k.correct<0||k.correct>3))throw Error('ملف الإجابات غير صالح.');const batch=writeBatch(db);keys.forEach(k=>batch.set(doc(db,'answerKeys',String(k.index)),k));await batch.commit();}
