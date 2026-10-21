// Execute the real payment-view code against isolated DOM/API fixtures.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {randomUUID} = require('node:crypto');
const {test} = require('node:test');

function fixture() {
  const nodes = new Map(), requests = [];
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {
      value:'', textContent:'', innerHTML:'', hidden:false, disabled:false, dataset:{}, handlers:{}, options:[],
      addEventListener(event, handler) { this.handlers[event] = handler; },
      setAttribute(key, value) { this[key] = value; },
      replaceChildren(...options) { this.options = options; this.value = options[0]?.value || ''; },
      querySelectorAll() { return []; }, reset() {}
    });
    return nodes.get(id);
  };
  node('haulageStatus').value = 'all';
  const booking = {id:'booking-1', reference:'AW-HAUL-TEST', customerName:'<Customer>', phone:'08000000000',
    pickup:'Apapa', dropoff:'Ikeja', description:'20 cartons', quoteDate:'2026-01-10', scheduledDate:'2026-01-20',
    quoteAmount:100000, amountPaid:40000, outstanding:60000, paymentStatus:'part_paid', receipts:[
      {amount:40000, paidAt:'2026-01-11T12:00:00+01:00', method:'bank_transfer', reference:'BANK-TEST', recordedBy:'finance@example.test'}
    ], vanPayments:10000, otherExpenses:5000, totalExpenses:15000, netReceived:25000, expenses:[
      {amount:10000, paidAt:'2026-01-11T12:00:00+01:00', method:'cash', category:'van_payment', paidTo:'<Van owner>', description:'Van hire', reference:'VAN-TEST', recordedBy:'finance@example.test'},
      {amount:5000, paidAt:'2026-01-12T12:00:00+01:00', method:'cash', category:'fuel', paidTo:'Test fuel station', description:'Diesel', reference:'FUEL-TEST', recordedBy:'finance@example.test'}
    ]};
  const row = {subscriptionRevenue:50000, websiteRevenue:10000, haulageRevenue:40000, totalRevenue:100000,
    riderCosts:8000, afterRiderCosts:92000, afterRecordedCosts:77000, haulageVanPayments:10000,
    haulageOtherExpenses:5000, haulageExpenses:15000, haulageNetReceived:25000,
    unpaidWebsiteAmount:2000, paidWebsiteCount:1, unpaidWebsiteCount:1, haulageReceiptCount:1};
  const overview = {currentMonth:'2026-01', monthly:{'2026-01':row}, yearly:row,
    outstandingWebsite:{amount:2000,count:1}, outstandingHaulage:{amount:60000,count:1}};
  let canManage = true, fail = false;
  const context = {Date, Number, String, crypto:{randomUUID}, document:{getElementById:node},
    Option:function(label,value) { this.label=label; this.value=value; },
    adminCanView:permission => permission === 'view_finance' || canManage,
    escapeSubscriptionValue:value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])),
    api:async(url, options={}) => {
      requests.push({url,options});
      if (fail) throw Error('Temporary failure');
      if (url === '/api/admin/finance/overview') return overview;
      if (options.method === 'POST') return {message:'Payment recorded.',booking};
      return {bookings:[booking],canManage};
    }
  };
  const source = fs.readFileSync('admin.js','utf8');
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('  let paymentOverview ='),source.indexOf('  async function loadAdminSubscriptionHistory()')),context);
  return {context,node,booking,overview,requests,manage:value=>canManage=value,fail:value=>fail=value};
}

test('haulage receipts contribute to overview, balances and escaped searchable booking history', async()=>{
  const f = fixture(); await f.context.loadAdminPaymentOverview();
  assert.equal(f.node('paymentHaulageRevenue').textContent,'₦40,000');
  assert.equal(f.node('paymentTotalRevenue').textContent,'₦100,000');
  assert.equal(f.node('paymentAllUnpaidHaulage').textContent,'₦60,000');
  assert.equal(f.node('paymentHaulageVanPayments').textContent,'₦10,000');
  assert.equal(f.node('paymentHaulageOtherExpenses').textContent,'₦5,000');
  assert.equal(f.node('paymentHaulageNetReceived').textContent,'₦25,000');
  assert.equal(f.node('paymentAfterRiderCosts').textContent,'₦77,000');
  const html = f.node('haulagePaymentsBody').innerHTML;
  assert.match(html,/Part paid/); assert.match(html,/11 Jan 2026/);
  assert.match(html,/BANK-TEST/); assert.match(html,/finance@example.test/);
  assert.match(html,/&lt;Customer&gt;/); assert.doesNotMatch(html,/<Customer>/);
  assert.match(html,/2 expenses/); assert.match(html,/Van payment/); assert.match(html,/Diesel/);
  assert.match(html,/&lt;Van owner&gt;/); assert.doesNotMatch(html,/<Van owner>/);
  f.node('haulageSearch').value='missing'; f.node('haulageSearch').handlers.input();
  assert.match(f.node('haulagePaymentsBody').innerHTML,/No matching/);
  f.node('haulageSearch').value=''; f.node('haulageStatus').value='paid';
  f.node('haulageStatus').handlers.change();
  assert.match(f.node('haulagePaymentsBody').innerHTML,/No matching/);
});

test('receipt form sends whole-naira deposit details once, refreshes and retains selected booking', async()=>{
  const f = fixture(); await f.context.loadAdminPaymentOverview();
  const values = {haulageReceiptBooking:'booking-1',haulageReceiptAmount:'20000',haulagePaidDate:'2026-01-12',
    haulageReceiptMethod:'cash',haulageReceiptReference:'CASH-TEST'};
  Object.entries(values).forEach(([id,value])=>f.node(id).value=value);
  f.node('haulageReceiptBooking').handlers.change();
  assert.equal(f.node('haulageReceiptAmount').max,60000);
  assert.match(f.node('haulageSelectedBalance').textContent,/60,000/);
  const form = f.node('haulageReceiptForm');
  const first = form.handlers.submit({preventDefault(){}});
  const duplicate = form.handlers.submit({preventDefault(){}});
  await Promise.all([first,duplicate]);
  const submitted = f.requests.filter(request=>request.options.method==='POST');
  assert.equal(submitted.length,1);
  const body = JSON.parse(submitted[0].options.body);
  assert.equal(body.bookingId,'booking-1'); assert.equal(body.amount,20000);
  assert.equal(body.paidDate,'2026-01-12'); assert.equal(body.method,'cash');
  assert.equal(body.reference,'CASH-TEST'); assert(body.requestId.length>=20);
  assert.equal(f.node('haulageReceiptBooking').value,'booking-1');
  assert.equal(f.node('haulageMessage').textContent,'Payment recorded.');
});

test('read-only admins cannot submit; errors retain payment details and request ID for retries', async()=>{
  const f = fixture(); f.manage(false); await f.context.loadAdminPaymentOverview();
  assert(f.node('haulageManage').hidden);
  const count=f.requests.length;
  await f.node('haulageBookingForm').handlers.submit({preventDefault(){}});
  await f.node('haulageExpenseForm').handlers.submit({preventDefault(){}});
  assert.equal(f.requests.length,count);
  f.manage(true); f.fail(true);
  f.node('haulageReceiptAmount').value='20000';
  await f.node('haulageReceiptForm').handlers.submit({preventDefault(){}});
  const failed=f.requests.at(-1);
  assert.equal(f.node('haulageReceiptAmount').value,'20000');
  assert.equal(f.node('haulageMessage').dataset.error,'true');
  await f.node('haulageReceiptForm').handlers.submit({preventDefault(){}});
  assert.equal(JSON.parse(f.requests.at(-1).options.body).requestId,JSON.parse(failed.options.body).requestId);
});

test('expense form accepts fully paid bookings, sends the cost details once and shows negative cash remaining', async()=>{
  const f=fixture(); f.booking.outstanding=0; f.booking.paymentStatus='paid'; f.booking.netReceived=-15000;
  await f.context.loadAdminPaymentOverview();
  assert.equal(f.node('haulageReceiptBooking').options.length,1);
  assert.equal(f.node('haulageExpenseBooking').options.length,2);
  const values={haulageExpenseBooking:'booking-1',haulageExpenseAmount:'30000',haulageExpenseDate:'2026-01-13',
    haulageExpenseMethod:'bank_transfer',haulageExpenseReference:'VAN-2',haulageExpenseCategory:'van_payment',
    haulageExpensePaidTo:'Van owner',haulageExpenseDescription:'Van hire balance'};
  Object.entries(values).forEach(([id,value])=>f.node(id).value=value);
  f.node('haulageExpenseBooking').handlers.change();
  assert.match(f.node('haulageExpenseSummary').textContent,/-15,000/);
  const form=f.node('haulageExpenseForm');
  await Promise.all([form.handlers.submit({preventDefault(){}}),form.handlers.submit({preventDefault(){}})]);
  const posts=f.requests.filter(request=>request.options.method==='POST');
  assert.equal(posts.length,1); assert.equal(posts[0].url,'/api/admin/haulage/expense');
  const payload=JSON.parse(posts[0].options.body);
  assert.equal(payload.bookingId,'booking-1'); assert.equal(payload.amount,30000);
  assert.equal(payload.category,'van_payment'); assert.equal(payload.description,'Van hire balance');
  assert.equal(payload.paidTo,'Van owner'); assert.equal(payload.paidDate,'2026-01-13');
  assert.equal(f.node('haulageExpenseBooking').value,'booking-1');
  assert.match(f.node('haulagePaymentsBody').innerHTML,/-15,000/);
});
