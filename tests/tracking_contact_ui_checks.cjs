const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {test} = require('node:test');

function fixture() {
  const nodes = new Map();
  const get = id => {
    if (!nodes.has(id)) {
      const classes = new Set(['hidden']);
      nodes.set(id, {textContent:'', innerHTML:'', href:'', value:'',
        classList:{add:c=>classes.add(c), remove:c=>classes.delete(c), contains:c=>classes.has(c)},
        removeAttribute(name){delete this[name];}, addEventListener(){}});
    }
    return nodes.get(id);
  };
  const context = {document:{getElementById:get}, window:{location:{search:''}}, URLSearchParams,
    fetch:async()=>({ok:true,json:async()=>context.payload})};
  vm.createContext(context);
  const html = fs.readFileSync('track.html','utf8');
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
  vm.runInContext(script, context);
  return {get, context, render:payload=>context.renderRiderContact(payload)};
}

test('tracking customers see a safe call link; pending assignment and unavailable numbers are clear',()=>{
  const f=fixture();
  f.render({riderContact:{name:'<img src=x onerror=alert(1)>',phone:'+234 800-000-0001'}});
  assert(!f.get('trackRider').classList.contains('hidden'));
  assert.equal(f.get('trackRiderName').textContent,'<img src=x onerror=alert(1)>');
  assert.equal(f.get('trackRiderName').innerHTML,'');
  assert.equal(f.get('trackRiderPhone').href,'tel:+2348000000001');
  assert.match(f.get('trackRiderPhone').textContent,/\+234 800-000-0001/);
  for (const phone of ['', 'javascript:alert(1)']) {
    f.render({riderContact:{name:'Rider',phone}});
    assert(f.get('trackRiderPhone').classList.contains('hidden'));
    assert(!f.get('trackRiderPhone').href);
    assert.match(f.get('trackRiderMessage').textContent,/not available yet/);
  }
  f.render({riderContact:null});
  assert.match(f.get('trackRiderMessage').textContent,/not been assigned/);
  assert.equal(f.get('trackRiderName').textContent,'');
});

test('website guest lookup displays rider contact without requiring sign-in',async()=>{
  const f=fixture();
  f.context.payload={status:'Order Received',riderContact:null};
  await f.context.runTrackLookup('WEBSITE');
  assert(!f.get('trackRider').classList.contains('hidden'));
  assert.match(f.get('trackRiderMessage').textContent,/not been assigned/);
  f.context.payload={status:'Rider Assigned',riderContact:{name:'Website Rider',phone:'08000000002'}};
  await f.context.runTrackLookup('WEBSITE');
  assert(!f.get('trackResult').classList.contains('hidden'));
  assert.equal(f.get('trackRiderName').textContent,'Website Rider');
  assert.equal(f.get('trackRiderPhone').href,'tel:08000000002');
  assert.equal(f.get('trackRiderMessage').textContent,'');
});

test('subsequent public lookups and failed lookups clear the previous rider contact',async()=>{
  const f=fixture();
  f.context.payload={status:'Rider Assigned',riderContact:{name:'Vendor Rider',phone:'08000000001'}};
  await f.context.runTrackLookup('ABC123');
  assert(!f.get('trackRider').classList.contains('hidden'));
  f.context.payload={status:'Order Received'};
  await f.context.runTrackLookup('PUBLIC');
  assert(f.get('trackRider').classList.contains('hidden'));
  assert.equal(f.get('trackRiderName').textContent,'');
  assert(!f.get('trackRiderPhone').href);
  f.render({riderContact:{name:'Vendor Rider',phone:'08000000001'}});
  f.context.fetch=async()=>{throw new Error('Connection failed');};
  await f.context.runTrackLookup('FAILED');
  assert(f.get('trackRider').classList.contains('hidden'));
  assert(f.get('trackResult').classList.contains('hidden'));
  assert.equal(f.get('trackError').textContent,'Connection failed');
});
