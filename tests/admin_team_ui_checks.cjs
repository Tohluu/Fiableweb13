// Isolated script/DOM fixtures; no browser accounts, email or stored data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {test} = require('node:test');
const tick = () => new Promise(resolve => setImmediate(resolve));

function node() {
  return {value:'',innerHTML:'',textContent:'',disabled:false,hidden:false,required:false,
    handlers:{}, options:[], classList:{contains:()=>false,add(){},remove(){}},
    addEventListener(name,callback){this.handlers[name]=callback;}, setAttribute(){},
    querySelectorAll(){return [];},querySelector(){return this.option ||= node();},
    focus(){},reset(){},getClientRects(){return [1];}};
}
function teamFixture() {
  const nodes = new Map(), callbacks = {}, requests=[];
  const get = id => { if (!nodes.has(id)) nodes.set(id,node()); return nodes.get(id); };
  const payload={isOwner:true,emailReady:true,currentAdminEmail:'owner@example.test',roles:{
    owner:{permissions:['*']},super_admin:{permissions:['*']},staff:{permissions:['view_orders']},
    dispatcher:{permissions:['view_orders','manage_orders']}
  },admins:[
    {name:'Owner',email:'owner@example.test',role:'owner',status:'active'},
    {name:'Legacy member',email:'legacy@example.test',role:'staff',status:'active'},
    {name:'Another admin',email:'super@example.test',role:'super_admin',status:'active'},
    {name:'Invited',email:'invited@example.test',role:'dispatcher',status:'invited',invitationStatus:'sent'}
  ]};
  const context={document:{getElementById:get,activeElement:null,addEventListener:(name,cb)=>callbacks[name]=cb},
    Date,window:{confirm:()=>true},showAdminToast(){},
    escapeSubscriptionValue:value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])),
    fetch:async(url,options)=>{requests.push([url,options]);return {ok:true,json:async()=>payload};}};
  const source=fs.readFileSync('admin.js','utf8');
  const start=source.indexOf('  const addAdminModal =');
  const end=source.indexOf('  async function loadAdminVendors()',start);
  vm.createContext(context);
  vm.runInContext(source.slice(start,end)+'\nglobalThis.ready=loadAdminTeam();',context);
  return {context,payload,get,requests};
}

test('legacy staff displays its real role and permission summary; other Super Admins are manageable',async()=>{
  const f=teamFixture(); await f.context.ready;
  const html=f.get('adminTeamBody').innerHTML;
  const legacy=html.match(/<select[^>]*data-email="legacy@example.test"[^>]*>([\s\S]*?)<\/select>/)[1];
  assert.match(legacy,/<option value="staff" selected>Legacy Staff/);
  assert.match(html,/View deliveries/);
  const superRow=html.match(/<tr><td><strong>super@example.test<\/strong>[\s\S]*?<\/tr>/)[0];
  assert.match(superRow,/admin-team-access/);
  assert.match(superRow,/admin-team-delete/);
  assert.match(superRow,/admin-team-role/);
  const ownerRow=html.match(/<tr><td><strong>owner@example.test<\/strong>[\s\S]*?<\/tr>/)[0];
  assert.doesNotMatch(ownerRow,/admin-team-delete|admin-team-access|<select/);
  assert.match(html,/Resend invitation/);
  assert.match(html,/Not recorded/);
});

test('search, read-only permissions and unavailable email controls behave correctly',async()=>{
  const f=teamFixture(); await f.context.ready;
  f.get('adminTeamSearch').value='legacy';
  f.get('adminTeamSearch').handlers.input();
  assert.match(f.get('adminTeamBody').innerHTML,/legacy@example.test/);
  assert.doesNotMatch(f.get('adminTeamBody').innerHTML,/super@example.test/);
  f.get('adminTeamSearch').value=''; f.payload.isOwner=false; f.payload.emailReady=false;
  await f.context.loadAdminTeam();
  assert(f.get('addAdminBtn').disabled);
  assert.doesNotMatch(f.get('adminTeamBody').innerHTML,/class="admin-team-role"|admin-team-delete|admin-team-email/);
  assert.match(f.get('adminTeamEmailStatus').textContent,/unavailable/);
  f.payload.isOwner=true;
  await f.context.loadAdminTeam();
  assert.match(f.get('adminTeamBody').innerHTML,/data-action="reset-password" disabled/);
  f.context.openAddAdminModal();
  assert.equal(f.get('newAdminDelivery').value,'manual');
  assert(f.get('newAdminPassword').required);
});

test('email setup removes password requirement and focused role edits are not overwritten by refresh',async()=>{
  const f=teamFixture();await f.context.ready;
  f.get('newAdminDelivery').value='invite'; f.get('newAdminRole').value='dispatcher';
  f.context.updateAdminSetup();
  assert(f.get('newAdminPasswordFields').hidden);
  assert.equal(f.get('newAdminPassword').required,false);
  assert.match(f.get('newAdminPermissions').textContent,/Manage deliveries/);
  const before=f.requests.length;
  f.context.document.activeElement={disabled:false,classList:{contains:()=>true}};
  await f.context.loadAdminTeam();assert.equal(f.requests.length,before);
  f.context.document.activeElement.disabled=true;
  await f.context.loadAdminTeam();assert.equal(f.requests.length,before+1);
});

test('invitation token survives address-bar cleanup and is submitted only to admin recovery',async()=>{
  const nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);};
  let start,cleaned=false;const requests=[];
  const context={URLSearchParams,document:{title:'Admin',getElementById:get,addEventListener:(name,cb)=>{start=cb;}},
    window:{location:{hash:'#reset=fixture-secret-token&setup=1',search:'',href:''},history:{replaceState:()=>{cleaned=true;context.window.location.hash='';}}},
    alert(){},console,fetch:async(url,options)=>{requests.push([url,JSON.parse(options.body)]);return {ok:true,json:async()=>({message:'Done'})};}};
  vm.createContext(context);vm.runInContext(fs.readFileSync('admin-login.js','utf8'),context);start();
  assert(cleaned);assert.equal(get('adminResetSubmitBtn').textContent,'Set password');
  get('adminResetPassword').value=get('adminResetConfirmPassword').value='A-new-valid-password';
  await get('adminResetForm').handlers.submit({preventDefault(){}});
  assert.equal(requests[0][0],'/api/admin/reset-password');
  assert.equal(requests[0][1].token,'fixture-secret-token');
  await tick();
});
