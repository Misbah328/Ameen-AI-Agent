const puppeteer=require('puppeteer');const http=require('http');
const CHROME=process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE;
function login(){return new Promise((res,rej)=>{const d=JSON.stringify({email:'mohammad@ameen-ai.sa',password:'ameen2026'});const r=http.request({host:'localhost',port:5000,path:'/auth/login',method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(d)}},resp=>{let b='';resp.on('data',c=>b+=c);resp.on('end',()=>{const sc=resp.headers['set-cookie']||[];const tok=sc.map(c=>c.split(';')[0]).find(c=>c.startsWith('ameen_token='));if(resp.statusCode===200&&tok)res(tok);else rej(new Error('login'+resp.statusCode));});});r.on('error',rej);r.write(d);r.end();});}
const errors=[];let CUR='';
async function nav(page,p){await page.evaluate(pn=>{const b=document.querySelector(`.nb[data-p="${pn}"]`);if(b)b.click();},p);await new Promise(r=>setTimeout(r,900));}
async function clickOnclick(page,sub){return page.evaluate(s=>{const b=[...document.querySelectorAll('[onclick]')].find(el=>el.getAttribute('onclick').includes(s)&&el.offsetParent!==null);if(!b)return false;b.click();return true;},sub);}
async function openModals(page){return page.evaluate(()=>[...document.querySelectorAll('.modal-overlay.open, .modal.open')].map(m=>m.id));}
async function closeModals(page){await page.evaluate(()=>document.querySelectorAll('.modal-overlay.open,.modal.open').forEach(m=>m.classList.remove('open')));}
(async()=>{
  const tc=await login();const[name,value]=tc.split('=');
  const browser=await puppeteer.launch({executablePath:CHROME,headless:true,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu']});
  const page=await browser.newPage();await page.setViewport({width:1440,height:900});
  page.on('console',m=>{if(m.type()==='error')errors.push(`[${CUR}] ${m.text().slice(0,120)}`);});
  page.on('pageerror',e=>errors.push(`[${CUR}] PAGEERR ${e.message.slice(0,120)}`));
  await page.setCookie({name,value,domain:'localhost',path:'/'});
  await page.goto('http://localhost:5000/',{waitUntil:'networkidle0'});await new Promise(r=>setTimeout(r,1200));
  const tests=[
    ['tasks','Modals.addTask','Add Task modal'],
    ['team','Team.showAdd','Add Member modal'],
    ['schedule','Schedule.add','New Meeting modal'],
    ['documents','DocGen.generate','Generate (pro-gate→plan modal)'],
    ['transcripts','TranscriptModal.open','Add Notes modal'],
    ['governance','Gov._showForm','Governance add form'],
  ];
  for(const [panel,sub,desc] of tests){
    CUR=panel;await nav(page,panel);await closeModals(page);
    const before=await openModals(page);
    const clicked=await clickOnclick(page,sub);
    await new Promise(r=>setTimeout(r,600));
    const after=await openModals(page);
    const newModals=after.filter(m=>!before.includes(m));
    const formShown=await page.evaluate(()=>!!document.querySelector('.gov-form:not([style*="display: none"]), form.gv-form, .inline-form'));
    console.log(`[${panel}] click ${sub}: clicked=${clicked} newModal=${JSON.stringify(newModals)} effect=${clicked&&(newModals.length>0)?'✓ MODAL OPENED':(clicked?'clicked (check)':'BUTTON NOT FOUND')}`);
    await closeModals(page);
  }
  // Ask Ameen chat send
  CUR='ask';await nav(page,'ask');
  await page.evaluate(()=>{const i=document.getElementById('ci');if(i)i.value='test';});
  const chatBefore=await page.evaluate(()=>document.querySelectorAll('#chat-msgs .msg').length);
  await clickOnclick(page,'Chat.send');await new Promise(r=>setTimeout(r,1500));
  const chatAfter=await page.evaluate(()=>document.querySelectorAll('#chat-msgs .msg').length);
  console.log(`[ask] Chat.send: msgs ${chatBefore} -> ${chatAfter} ${chatAfter>chatBefore?'✓ RESPONDS':'✗ no change'}`);
  await browser.close();
  console.log(`\n=== ERRORS (${errors.length}) ===`);errors.forEach(e=>console.log('  '+e));
})();
