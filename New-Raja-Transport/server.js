'use strict';

/** New Raja Transport: zero-dependency Node 22+ / SQLite web application. */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const PUBLIC_DIR = path.join(__dirname, 'public');
const TIME_ZONE = process.env.APP_TIMEZONE || 'Asia/Kolkata';
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'new-raja-transport.sqlite'));
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
db.exec(`
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL, salt TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'admin', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS customers (id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT DEFAULT '', whatsapp TEXT DEFAULT '', gstin TEXT DEFAULT '', address TEXT DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS bookings (id INTEGER PRIMARY KEY, lr_no TEXT NOT NULL UNIQUE COLLATE NOCASE, booking_date TEXT NOT NULL, customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT, sender_name TEXT NOT NULL, receiver_name TEXT NOT NULL, sender_phone TEXT DEFAULT '', receiver_phone TEXT DEFAULT '', from_city TEXT NOT NULL, to_city TEXT NOT NULL, description TEXT DEFAULT '', packages INTEGER NOT NULL DEFAULT 1, weight_kg REAL NOT NULL DEFAULT 0, vehicle_no TEXT DEFAULT '', driver_name TEXT DEFAULT '', freight_paise INTEGER NOT NULL DEFAULT 0 CHECK(freight_paise >= 0), due_date TEXT NOT NULL, delivery_status TEXT NOT NULL DEFAULT 'Booked', delivered_date TEXT DEFAULT '', notes TEXT DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS payments (id INTEGER PRIMARY KEY, booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT, amount_paise INTEGER NOT NULL CHECK(amount_paise > 0), payment_date TEXT NOT NULL, payer_name TEXT NOT NULL, method TEXT NOT NULL, reference TEXT DEFAULT '', notes TEXT DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS expenses (id INTEGER PRIMARY KEY, expense_date TEXT NOT NULL, category TEXT NOT NULL, amount_paise INTEGER NOT NULL CHECK(amount_paise > 0), vehicle_no TEXT DEFAULT '', paid_to TEXT DEFAULT '', payment_method TEXT NOT NULL DEFAULT 'Cash', notes TEXT DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS ix_bookings_dates ON bookings(booking_date, due_date);
CREATE INDEX IF NOT EXISTS ix_bookings_customer ON bookings(customer_id);
CREATE INDEX IF NOT EXISTS ix_payments_booking ON payments(booking_id);
CREATE INDEX IF NOT EXISTS ix_payments_date ON payments(payment_date);
`);
const settingsDefault = { company_name: 'New Raja Transport', phone: '', address: '', gstin: '', default_due_days: '15', tagline: 'Transport & Logistics Management' };
for (const [k,v] of Object.entries(settingsDefault)) db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES (?,?)').run(k,v);

const stmt = sql => db.prepare(sql);
const all = (sql, ...params) => stmt(sql).all(...params);
const get = (sql, ...params) => stmt(sql).get(...params);
const run = (sql, ...params) => stmt(sql).run(...params);
const numeric = x => Number(x || 0);
const amount = x => Number((numeric(x)/100).toFixed(2));
const text = (value, max=200) => String(value ?? '').trim().slice(0,max);
const required = (value,label,max=200) => { const v=text(value,max); if(!v) throw bad(`${label} is required`); return v; };
const bad = (message,status=400) => Object.assign(new Error(message),{status});
const int = (value, label, min=0) => { const n=Number(value); if(!Number.isSafeInteger(n)||n<min) throw bad(`Invalid ${label}`); return n; };
const paise = (value, label='amount', allowZero=false) => {
  const s=String(value??'').trim();
  if(!/^\d{1,10}(\.\d{1,2})?$/.test(s)) throw bad(`Enter a valid ${label} (up to two decimal places)`);
  const [whole,dec=''] = s.split('.'); const n=Number(whole)*100+Number(dec.padEnd(2,'0'));
  if(!Number.isSafeInteger(n)||(!allowZero&&n<=0)) throw bad(`${label} must be greater than zero`);
  return n;
};
const date = (value,label='Date') => { const s=text(value,10); if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||Number.isNaN(new Date(`${s}T00:00:00Z`).getTime())||new Date(`${s}T00:00:00Z`).toISOString().slice(0,10)!==s) throw bad(`Invalid ${label}`); return s; };
function today() {
  const parts = new Intl.DateTimeFormat('en-GB',{timeZone: TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const f = k => parts.find(p=>p.type===k)?.value;
  return `${f('year')}-${f('month')}-${f('day')}`;
}
function dateShift(d,days) { const v=new Date(`${d}T12:00:00Z`);v.setUTCDate(v.getUTCDate()+days);return v.toISOString().slice(0,10); }
function settingObj(){ return Object.fromEntries(all('SELECT key,value FROM settings').map(x=>[x.key,x.value])); }
function json(res,status,obj, headers={}){ res.writeHead(status, {'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', ...headers});res.end(JSON.stringify(obj)); }
function readBody(req) { return new Promise((resolve,reject) => { let s='';req.on('data',b=>{s+=b;if(s.length>1024*1024){reject(bad('Request too large',413));req.destroy();}});req.on('end',()=>{ try{resolve(s?JSON.parse(s):{});}catch{reject(bad('Invalid JSON'));} });req.on('error',reject); }); }
function hashPwd(password,salt){return crypto.scryptSync(password,Buffer.from(salt,'hex'),64).toString('hex');}
function safeEqual(a,b){const a1=Buffer.from(a,'hex'),b1=Buffer.from(b,'hex');return a1.length===b1.length&&crypto.timingSafeEqual(a1,b1);}
function parseCookies(req) { return Object.fromEntries((req.headers.cookie||'').split(';').map(s=>s.trim().split('=')).filter(p=>p.length===2)); }
function sessionUser(req) {const token=parseCookies(req).nrt_session;if(!token||! /^[a-f0-9]{64}$/.test(token))return null;return get('SELECT u.id,u.username,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?',crypto.createHash('sha256').update(token).digest('hex'),Date.now())||null;}
function cookie(req,token,expire=false){const secure=(process.env.COOKIE_SECURE==='true'||Boolean(req.socket.encrypted));return `nrt_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${expire?0:1209600}${secure?'; Secure':''}`;}
function newSession(req,res,user) {const token=crypto.randomBytes(32).toString('hex');run('DELETE FROM sessions WHERE expires_at<?',Date.now());run('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)',crypto.createHash('sha256').update(token).digest('hex'),user.id,Date.now()+14*86400000);return cookie(req,token);}
function bookingViewSql(){return `SELECT b.*,c.name AS customer_name,c.phone AS customer_phone,c.whatsapp AS customer_whatsapp,COALESCE(p.paid_paise,0) AS paid_paise, b.freight_paise-COALESCE(p.paid_paise,0) AS balance_paise FROM bookings b JOIN customers c ON c.id=b.customer_id LEFT JOIN (SELECT booking_id,SUM(amount_paise) paid_paise FROM payments GROUP BY booking_id) p ON p.booking_id=b.id`;}
function bookingRow(r){ if(!r)return null; return {...r,freight:amount(r.freight_paise),paid:amount(r.paid_paise),balance:amount(r.balance_paise)}; }
function fetchBooking(id){return bookingRow(get(bookingViewSql()+' WHERE b.id=?',id));}
function validateBooking(b,editing=false) {
  const values={
    lr_no:required(b.lr_no,'LR / Consignment number',40),
    booking_date:date(b.booking_date,'Booking date'),
    customer_id:int(b.customer_id,'customer',1),
    sender_name:required(b.sender_name,'Sender',120), receiver_name:required(b.receiver_name,'Receiver',120),
    sender_phone:text(b.sender_phone,30), receiver_phone:text(b.receiver_phone,30),
    from_city:required(b.from_city,'From city',120), to_city:required(b.to_city,'To city',120),
    description:text(b.description,300), packages:int(b.packages??1,'packages',0),
    weight_kg:Number(b.weight_kg||0), vehicle_no:text(b.vehicle_no,40), driver_name:text(b.driver_name,120),
    freight_paise:paise(b.freight,'Freight',true),due_date:date(b.due_date,'Due date'),
    delivery_status:text(b.delivery_status||'Booked',30), delivered_date:b.delivered_date?date(b.delivered_date,'Delivery date'):'',notes:text(b.notes,1000)
  };
  if(!get('SELECT id FROM customers WHERE id=?',values.customer_id))throw bad('Select a valid customer');
  if(!Number.isFinite(values.weight_kg)||values.weight_kg<0||values.weight_kg>100000000)throw bad('Invalid weight');
  if(!['Booked','In Transit','Delivered','Cancelled'].includes(values.delivery_status))throw bad('Invalid delivery status');
  if(values.delivery_status==='Delivered'&&!values.delivered_date)values.delivered_date=today();
  if(values.delivery_status==='Cancelled'&&values.freight_paise>0)throw bad('For cancellation, first set freight to ₹0 and remove any payments');
  return values;
}
function customerInput(b) {return {name:required(b.name,'Customer name',150),phone:text(b.phone,30),whatsapp:text(b.whatsapp,30),gstin:text(b.gstin,30).toUpperCase(),address:text(b.address,500)};}
const categories=['Fuel','Toll / FASTag','Driver Advance','Salary','Vehicle Repair','Maintenance','Office','Loading / Unloading','Other'];
const methods=['Cash','UPI','Bank Transfer','Cheque','Other'];
function expenseInput(b) {const category=required(b.category,'Category',50),method=text(b.payment_method||'Cash',30);if(!categories.includes(category))throw bad('Invalid expense category');if(!methods.includes(method))throw bad('Invalid payment method');return {expense_date:date(b.expense_date,'Expense date'),category,amount_paise:paise(b.amount),vehicle_no:text(b.vehicle_no,40),paid_to:text(b.paid_to,120),payment_method:method,notes:text(b.notes,500)};}
function insert(table,values){const keys=Object.keys(values);const result=run(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`,...Object.values(values));return Number(result.lastInsertRowid);}
function update(table,id,values){const keys=Object.keys(values);const result=run(`UPDATE ${table} SET ${keys.map(k=>k+'=?').join(',')} WHERE id=?`,...Object.values(values),id);if(!result.changes)throw bad('Record not found',404);}
function outputCsv(res,rows,filename) {const keys=rows.length?Object.keys(rows[0]):['No records'];const esc=v=>`"${String(v??'').replaceAll('"','""').replace(/^[=+\-@\t\r]/,'\' $&')} "`.replace(/ "$/,'"');const csv='\uFEFF'+[keys.join(','),...rows.map(r=>keys.map(k=>esc(r[k])).join(','))].join('\r\n');res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="${filename}"`,'Cache-Control':'no-store'});res.end(csv);}
function moneyRows(rows){return rows.map(r=>Object.fromEntries(Object.entries(r).map(([k,v])=>[k,k.endsWith('_paise')?amount(v):v])));}
function handleApi(req,res,url,user,body){
  const method=req.method, p=url.pathname, q=url.searchParams;
  if(p==='/api/status'&&method==='GET')return json(res,200,{setup_required:!get('SELECT id FROM users LIMIT 1')});
  if(p==='/api/setup'&&method==='POST'){
    if(get('SELECT id FROM users LIMIT 1'))throw bad('Already configured',409);
    const username=required(body.username,'Username',50);if(!/^[a-zA-Z0-9_.-]{3,50}$/.test(username))throw bad('Username must be 3–50 letters, numbers or . _ -');
    const password=String(body.password||'');if(password.length<8||password.length>128)throw bad('Password must have 8–128 characters');
    const salt=crypto.randomBytes(16).toString('hex');const id=insert('users',{username,password_hash:hashPwd(password,salt),salt,role:'admin'});
    return json(res,201,{user:{id,username,role:'admin'}},{'Set-Cookie':newSession(req,res,{id})});
  }
  if(p==='/api/login'&&method==='POST'){
    const u=get('SELECT * FROM users WHERE username=?',text(body.username,50));
    const given=String(body.password||'');
    const computed=hashPwd(given,u?.salt||'00000000000000000000000000000000');
    if(!u||!safeEqual(computed,u.password_hash))throw bad('Incorrect username or password',401);
    return json(res,200,{user:{id:u.id,username:u.username,role:u.role}},{'Set-Cookie':newSession(req,res,u)});
  }
  if(p==='/api/logout'&&method==='POST'){
    const token=parseCookies(req).nrt_session;if(token)run('DELETE FROM sessions WHERE token_hash=?',crypto.createHash('sha256').update(token).digest('hex'));
    return json(res,200,{ok:true},{'Set-Cookie':cookie(req,'',true)});
  }
  if(!user)throw bad('Please log in',401);
  if(p==='/api/me'&&method==='GET')return json(res,200,{user,settings:settingObj(),today:today()});
  if(p==='/api/settings'&&method==='GET')return json(res,200,settingObj());
  if(p==='/api/settings'&&method==='PUT'){
    const fields=['company_name','phone','address','gstin','default_due_days','tagline'];
    for(const key of fields)if(body[key]!==undefined){let v=text(body[key],key==='address'?500:150);if(key==='company_name')v=required(v,'Company name',150);if(key==='default_due_days')v=String(int(v,'default due days',0));run('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',key,v);}
    return json(res,200,settingObj());
  }
  if(p==='/api/customers'&&method==='GET'){
    const search=text(q.get('q')||'',100);const like=`%${search}%`;
    const rows=all(`SELECT c.*,COUNT(b.id) AS booking_count,COALESCE(SUM(b.freight_paise),0) AS total_freight_paise,COALESCE(SUM(b.freight_paise-COALESCE(pp.paid_paise,0)),0) AS balance_paise FROM customers c LEFT JOIN bookings b ON b.customer_id=c.id AND b.delivery_status!='Cancelled' LEFT JOIN (SELECT booking_id,SUM(amount_paise) AS paid_paise FROM payments GROUP BY booking_id) pp ON pp.booking_id=b.id WHERE (c.name LIKE ? OR c.phone LIKE ?) GROUP BY c.id ORDER BY c.name COLLATE NOCASE`,like,like);
    return json(res,200,rows.map(x=>({...x,total_freight:amount(x.total_freight_paise),balance:amount(x.balance_paise)})));
  }
  if(p==='/api/customers'&&method==='POST') {const id=insert('customers',customerInput(body));return json(res,201,get('SELECT * FROM customers WHERE id=?',id));}
  let m=p.match(/^\/api\/customers\/(\d+)$/);
  if(m){const id=int(m[1],'ID',1);if(method==='PATCH'){update('customers',id,customerInput(body));return json(res,200,get('SELECT * FROM customers WHERE id=?',id));}if(method==='DELETE'){if(get('SELECT 1 FROM bookings WHERE customer_id=? LIMIT 1',id))throw bad('Cannot delete a customer with bookings',409);run('DELETE FROM customers WHERE id=?',id);return json(res,200,{ok:true});}}
  if(p==='/api/bookings'&&method==='GET'){
    let where=['1=1'], args=[];
    const search=text(q.get('q')||'',100);if(search){where.push('(b.lr_no LIKE ? OR c.name LIKE ? OR b.sender_name LIKE ? OR b.receiver_name LIKE ? OR b.from_city LIKE ? OR b.to_city LIKE ? OR b.vehicle_no LIKE ?)');args.push(...Array(7).fill(`%${search}%`));}
    if(q.get('status')&&q.get('status')!=='all'){where.push('b.delivery_status=?');args.push(q.get('status'));}
    if(q.get('customer_id')){where.push('b.customer_id=?');args.push(int(q.get('customer_id'),'customer ID',1));}
    if(q.get('from')){where.push('b.booking_date>=?');args.push(date(q.get('from')));}
    if(q.get('to')){where.push('b.booking_date<=?');args.push(date(q.get('to')));}
    const filter=q.get('payment')||'all';
    if(filter==='pending')where.push("b.delivery_status!='Cancelled' AND b.freight_paise>COALESCE(p.paid_paise,0)");
    if(filter==='overdue'){where.push("b.delivery_status!='Cancelled' AND b.freight_paise>COALESCE(p.paid_paise,0) AND b.due_date<?");args.push(today());}
    if(filter==='due_soon'){where.push("b.delivery_status!='Cancelled' AND b.freight_paise>COALESCE(p.paid_paise,0) AND b.due_date BETWEEN ? AND ?");args.push(today(),dateShift(today(),7));}
    if(filter==='paid')where.push("b.delivery_status!='Cancelled' AND b.freight_paise<=COALESCE(p.paid_paise,0)");
    const rows=all(bookingViewSql()+` WHERE ${where.join(' AND ')} ORDER BY b.booking_date DESC,b.id DESC LIMIT 5000`,...args);
    return json(res,200,rows.map(bookingRow));
  }
  if(p==='/api/bookings'&&method==='POST'){
    const values=validateBooking(body);const id=insert('bookings',values);return json(res,201,fetchBooking(id));
  }
  m=p.match(/^\/api\/bookings\/(\d+)$/);
  if(m){const id=int(m[1],'ID',1), existing=fetchBooking(id);if(!existing)throw bad('Booking not found',404);
    if(method==='GET'){const payments=all('SELECT *,amount_paise/100.0 AS amount FROM payments WHERE booking_id=? ORDER BY payment_date DESC,id DESC',id);return json(res,200,{...existing,payments});}
    if(method==='PATCH'){
      const values=validateBooking(body,true);
      if(values.freight_paise<existing.paid_paise)throw bad('Freight cannot be less than already received payments');
      if(values.delivery_status==='Cancelled'&&existing.paid_paise>0)throw bad('Delete or refund payment records before cancellation');
      update('bookings',id,{...values,updated_at:new Date().toISOString()});return json(res,200,fetchBooking(id));
    }
    if(method==='DELETE'){if(existing.paid_paise>0)throw bad('Cannot delete a booking with payments. Remove its payments first.',409);run('DELETE FROM bookings WHERE id=?',id);return json(res,200,{ok:true});}
  }
  if(p==='/api/payments'&&method==='GET'){
    let where=['1=1'],args=[];if(q.get('booking_id')){where.push('p.booking_id=?');args.push(int(q.get('booking_id'),'booking ID',1));}
    if(q.get('from')){where.push('p.payment_date>=?');args.push(date(q.get('from')));}
    if(q.get('to')){where.push('p.payment_date<=?');args.push(date(q.get('to')));}
    const s=text(q.get('q')||'',100);if(s){where.push('(b.lr_no LIKE ? OR p.payer_name LIKE ? OR c.name LIKE ? OR p.reference LIKE ?)');args.push(...Array(4).fill(`%${s}%`));}
    const rows=all(`SELECT p.*,b.lr_no,c.name AS customer_name,p.amount_paise/100.0 AS amount FROM payments p JOIN bookings b ON b.id=p.booking_id JOIN customers c ON c.id=b.customer_id WHERE ${where.join(' AND ')} ORDER BY p.payment_date DESC,p.id DESC LIMIT 5000`,...args);
    return json(res,200,rows);
  }
  if(p==='/api/payments'&&method==='POST'){
    const booking_id=int(body.booking_id,'booking ID',1),b=fetchBooking(booking_id);if(!b)throw bad('Booking not found',404);if(b.delivery_status==='Cancelled')throw bad('Cannot pay a cancelled booking');
    const amount_paise=paise(body.amount), payment_date=date(body.payment_date,'Payment date'),payer_name=required(body.payer_name,'Paid by',120),method=required(body.method,'Payment method',30);
    if(!methods.includes(method))throw bad('Invalid payment method');if(amount_paise>b.balance_paise)throw bad(`Payment exceeds outstanding balance of ₹${b.balance.toFixed(2)}`);
    const id=insert('payments',{booking_id,amount_paise,payment_date,payer_name,method,reference:text(body.reference,120),notes:text(body.notes,500)});
    return json(res,201,{...get('SELECT * FROM payments WHERE id=?',id),amount:amount(amount_paise),booking:fetchBooking(booking_id)});
  }
  m=p.match(/^\/api\/payments\/(\d+)$/);
  if(m){const id=int(m[1],'ID',1),row=get('SELECT * FROM payments WHERE id=?',id);if(!row)throw bad('Payment not found',404);
    if(method==='DELETE'){run('DELETE FROM payments WHERE id=?',id);return json(res,200,{ok:true});}
    if(method==='PATCH'){
      const b=fetchBooking(row.booking_id),value=paise(body.amount);
      if(value>b.balance_paise+row.amount_paise)throw bad('Payment exceeds available booking balance');
      const x={amount_paise:value,payment_date:date(body.payment_date),payer_name:required(body.payer_name,'Paid by',120),method:required(body.method,'Payment method',30),reference:text(body.reference,120),notes:text(body.notes,500)};
      if(!methods.includes(x.method))throw bad('Invalid payment method');update('payments',id,x);return json(res,200,{...get('SELECT * FROM payments WHERE id=?',id),amount:amount(value)});
    }
  }
  if(p==='/api/expenses'&&method==='GET') {
    const wh=['1=1'],params=[];if(q.get('from')){wh.push('expense_date>=?');params.push(date(q.get('from')));}if(q.get('to')){wh.push('expense_date<=?');params.push(date(q.get('to')));}
    const s=text(q.get('q')||'',100);if(s){wh.push('(category LIKE ? OR vehicle_no LIKE ? OR paid_to LIKE ?)');params.push(...Array(3).fill(`%${s}%`));}
    return json(res,200,all(`SELECT *,amount_paise/100.0 AS amount FROM expenses WHERE ${wh.join(' AND ')} ORDER BY expense_date DESC,id DESC LIMIT 5000`,...params));
  }
  if(p==='/api/expenses'&&method==='POST'){const id=insert('expenses',expenseInput(body));return json(res,201,{...get('SELECT * FROM expenses WHERE id=?',id),amount:amount(get('SELECT amount_paise FROM expenses WHERE id=?',id).amount_paise)});}
  m=p.match(/^\/api\/expenses\/(\d+)$/);
  if(m){const id=int(m[1],'ID',1);if(method==='PATCH'){update('expenses',id,expenseInput(body));return json(res,200,get('SELECT * FROM expenses WHERE id=?',id));}if(method==='DELETE'){run('DELETE FROM expenses WHERE id=?',id);return json(res,200,{ok:true});}}
  if(p==='/api/dashboard'&&method==='GET'){
    const now=today(),month=now.slice(0,7);
    const k=get(`SELECT COUNT(*) AS booking_count, COALESCE(SUM(CASE WHEN delivery_status!='Cancelled' THEN freight_paise ELSE 0 END),0) AS total_freight, COALESCE(SUM(CASE WHEN booking_date LIKE ? AND delivery_status!='Cancelled' THEN freight_paise ELSE 0 END),0) AS this_month_freight FROM bookings`,month+'%');
    const rec=get('SELECT COALESCE(SUM(amount_paise),0) AS total,COALESCE(SUM(CASE WHEN payment_date LIKE ? THEN amount_paise ELSE 0 END),0) AS this_month FROM payments',month+'%');
    const exp=get('SELECT COALESCE(SUM(amount_paise),0) AS total,COALESCE(SUM(CASE WHEN expense_date LIKE ? THEN amount_paise ELSE 0 END),0) AS this_month FROM expenses',month+'%');
    const totals=get(`SELECT COALESCE(SUM(CASE WHEN b.delivery_status!='Cancelled' THEN b.freight_paise-COALESCE(p.paid,0) ELSE 0 END),0) outstanding,COALESCE(SUM(CASE WHEN b.delivery_status!='Cancelled' AND b.due_date<? THEN b.freight_paise-COALESCE(p.paid,0) ELSE 0 END),0) overdue,COUNT(CASE WHEN b.delivery_status!='Cancelled' AND b.due_date<? AND b.freight_paise>COALESCE(p.paid,0) THEN 1 END) overdue_count FROM bookings b LEFT JOIN (SELECT booking_id,SUM(amount_paise) paid FROM payments GROUP BY booking_id)p ON b.id=p.booking_id`,now,now);
    const top=all(bookingViewSql()+" WHERE b.delivery_status!='Cancelled' AND b.due_date<? AND b.freight_paise>COALESCE(p.paid_paise,0) ORDER BY b.due_date ASC,b.id ASC LIMIT 6",now).map(bookingRow);
    const recentPayments=all(`SELECT p.id,p.amount_paise/100.0 amount,p.payment_date,p.payer_name,p.method,b.lr_no,c.name AS customer_name FROM payments p JOIN bookings b ON b.id=p.booking_id JOIN customers c ON c.id=b.customer_id ORDER BY p.id DESC LIMIT 6`);
    const recentBookings=all(bookingViewSql()+' ORDER BY b.id DESC LIMIT 5').map(bookingRow);
    let months=[]; for(let i=5;i>=0;i--){const d=new Date(`${month}-01T12:00:00Z`);d.setUTCMonth(d.getUTCMonth()-i);const mm=d.toISOString().slice(0,7);const paid=get('SELECT COALESCE(SUM(amount_paise),0) total FROM payments WHERE payment_date LIKE ?',mm+'%').total;const invoiced=get("SELECT COALESCE(SUM(freight_paise),0) total FROM bookings WHERE booking_date LIKE ? AND delivery_status!='Cancelled'",mm+'%').total;months.push({month:mm,received:amount(paid),freight:amount(invoiced)});}
    return json(res,200,{today:now,booking_count:k.booking_count,total_freight:amount(k.total_freight),this_month_freight:amount(k.this_month_freight),received:amount(rec.total),this_month_received:amount(rec.this_month),expenses:amount(exp.total),this_month_expenses:amount(exp.this_month),outstanding:amount(totals.outstanding),overdue:amount(totals.overdue),overdue_count:totals.overdue_count,top_overdue:top,recent_payments:recentPayments,recent_bookings:recentBookings,months});
  }
  if(p==='/api/reports'&&method==='GET'){
    const from=date(q.get('from')||`${today().slice(0,7)}-01`),to=date(q.get('to')||today());if(to<from)throw bad('End date must be after start date');
    const billed=get("SELECT COALESCE(SUM(freight_paise),0) total,COUNT(*) count FROM bookings WHERE booking_date BETWEEN ? AND ? AND delivery_status!='Cancelled'",from,to);
    const collections=get('SELECT COALESCE(SUM(amount_paise),0) total,COUNT(*) count FROM payments WHERE payment_date BETWEEN ? AND ?',from,to);
    const expenses=get('SELECT COALESCE(SUM(amount_paise),0) total FROM expenses WHERE expense_date BETWEEN ? AND ?',from,to);
    const methodsReport=all('SELECT method,COALESCE(SUM(amount_paise),0)/100.0 AS amount,COUNT(*) count FROM payments WHERE payment_date BETWEEN ? AND ? GROUP BY method ORDER BY amount DESC',from,to);
    const customerReport=all(`SELECT c.id,c.name,c.phone,COUNT(b.id) booking_count,COALESCE(SUM(b.freight_paise),0)/100.0 freight,COALESCE(SUM(b.freight_paise-COALESCE(p.paid,0)),0)/100.0 outstanding FROM customers c LEFT JOIN bookings b ON b.customer_id=c.id AND b.delivery_status!='Cancelled' LEFT JOIN (SELECT booking_id,SUM(amount_paise) paid FROM payments GROUP BY booking_id)p ON p.booking_id=b.id GROUP BY c.id HAVING outstanding>0 ORDER BY outstanding DESC LIMIT 100`);
    const aging=all(`SELECT CASE WHEN due_date>=? THEN 'Not due' WHEN julianday(?) - julianday(due_date) <= 7 THEN '1–7 days' WHEN julianday(?) - julianday(due_date) <= 30 THEN '8–30 days' WHEN julianday(?) - julianday(due_date) <= 60 THEN '31–60 days' ELSE '60+ days' END bucket,COALESCE(SUM(balance),0)/100.0 AS amount,COUNT(*) AS count FROM (SELECT b.due_date,b.freight_paise-COALESCE(p.paid,0) balance FROM bookings b LEFT JOIN (SELECT booking_id,SUM(amount_paise) paid FROM payments GROUP BY booking_id)p ON p.booking_id=b.id WHERE b.delivery_status!='Cancelled' AND b.freight_paise>COALESCE(p.paid,0)) a GROUP BY bucket`,today(),today(),today(),today());
    return json(res,200,{from,to,billed:amount(billed.total),bookings:billed.count,collections:amount(collections.total),payment_count:collections.count,expenses:amount(expenses.total),cash_flow:amount(collections.total-expenses.total),payment_methods:methodsReport,customers:customerReport,aging});
  }
  if(p==='/api/export/bookings'&&method==='GET'){
    const rows=all(bookingViewSql()+' ORDER BY b.booking_date DESC').map(b=>{const r=bookingRow(b);return {LR_No:r.lr_no,Date:r.booking_date,Customer:r.customer_name,Sender:r.sender_name,Sender_Phone:r.sender_phone,Receiver:r.receiver_name,Receiver_Phone:r.receiver_phone,From:r.from_city,To:r.to_city,Packages:r.packages,Description:r.description,Vehicle:r.vehicle_no,Driver:r.driver_name,Freight_INR:r.freight,Paid_INR:r.paid,Outstanding_INR:r.balance,Due_Date:r.due_date,Delivery_Status:r.delivery_status,Notes:r.notes};});return outputCsv(res,rows,'new-raja-bookings.csv');
  }
  if(p==='/api/export/payments'&&method==='GET'){
    const rows=all('SELECT p.id,p.payment_date,b.lr_no,c.name AS customer,p.payer_name,p.amount_paise,p.method,p.reference,p.notes FROM payments p JOIN bookings b ON b.id=p.booking_id JOIN customers c ON c.id=b.customer_id ORDER BY p.payment_date DESC').map(p=>({Receipt_No:p.id,Date:p.payment_date,LR_No:p.lr_no,Customer:p.customer,Paid_By:p.payer_name,Amount_INR:amount(p.amount_paise),Method:p.method,Reference:p.reference,Notes:p.notes}));return outputCsv(res,rows,'new-raja-payments.csv');
  }
  if(p==='/api/export/expenses'&&method==='GET'){
    const rows=all('SELECT * FROM expenses ORDER BY expense_date DESC').map(x=>({Date:x.expense_date,Category:x.category,Amount_INR:amount(x.amount_paise),Paid_To:x.paid_to,Vehicle_No:x.vehicle_no,Method:x.payment_method,Notes:x.notes}));return outputCsv(res,rows,'new-raja-expenses.csv');
  }
  if(p==='/api/export/customers'&&method==='GET')return outputCsv(res,all('SELECT name,phone,whatsapp,gstin,address FROM customers ORDER BY name'),'new-raja-customers.csv');
  if(p==='/api/backup'&&method==='GET'){
    const obj={app:'New Raja Transport',version:1,exported_at:new Date().toISOString(),settings:settingObj(),customers:all('SELECT * FROM customers'),bookings:all('SELECT * FROM bookings'),payments:all('SELECT * FROM payments'),expenses:all('SELECT * FROM expenses')};
    res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Content-Disposition':`attachment; filename="new-raja-backup-${today()}.json"`,'Cache-Control':'no-store'});res.end(JSON.stringify(obj,null,2));return;
  }
  if(p==='/api/restore'&&method==='POST'){
    if(body.app!=='New Raja Transport'||body.version!==1||!['customers','bookings','payments','expenses'].every(k=>Array.isArray(body[k])))throw bad('Invalid New Raja Transport backup');
    if(!body.confirm_replace)throw bad('Confirm replacement to restore backup');
    // All records are inserted inside a transaction. Foreign keys and CHECK constraints are enforced.
    db.exec('BEGIN IMMEDIATE');try{
      for(const table of ['payments','bookings','expenses','customers'])db.exec(`DELETE FROM ${table}`);
      for(const table of ['customers','bookings','payments','expenses']){
        const columns=all(`PRAGMA table_info(${table})`).map(x=>x.name);
        for(const old of body[table]){
          const item=Object.fromEntries(columns.filter(k=>Object.prototype.hasOwnProperty.call(old,k)).map(k=>[k,old[k]]));
          if(!item.id||!Object.keys(item).length)throw bad('Backup contains invalid rows');
          insert(table,item);
        }
      }
      if(body.settings && typeof body.settings==='object')for(const k of Object.keys(settingsDefault))if(typeof body.settings[k]==='string')run('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',k,body.settings[k]);
      db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}
    return json(res,200,{ok:true});
  }
  if(p==='/api/demo'&&method==='POST'){
    if(get('SELECT 1 FROM bookings LIMIT 1')||get('SELECT 1 FROM customers LIMIT 1'))throw bad('Sample data is only available on an empty account',409);
    const t=today(), d=n=>dateShift(t,n);db.exec('BEGIN IMMEDIATE');
    try{
      const a=insert('customers',{name:'Sharma Traders (DEMO)',phone:'',whatsapp:'',gstin:'',address:'Nashik'});
      const b=insert('customers',{name:'City Steel Works (DEMO)',phone:'',whatsapp:'',gstin:'',address:'Pune'});
      const c=insert('customers',{name:'Greenfield Supplies (DEMO)',phone:'',whatsapp:'',gstin:'',address:'Mumbai'});
      const defs=[['DEMO-1001',d(-25),a,'Sharma Traders','Patel Distributors','Nashik','Pune',26000,d(-11),'Delivered',18000],['DEMO-1002',d(-18),b,'City Steel Works','Royal Agencies','Pune','Mumbai',18500,d(-4),'In Transit',0],['DEMO-1003',d(-8),c,'Greenfield Supplies','Metropolitan Retail','Mumbai','Nashik',32000,d(5),'Booked',12500],['DEMO-1004',d(-4),a,'Sharma Traders','Kohinoor Mart','Nashik','Aurangabad',12000,d(10),'In Transit',12000],['DEMO-1005',d(-2),b,'City Steel Works','Prime Hardware','Pune','Jalgaon',15400,d(8),'Booked',0],['DEMO-1006',d(-32),c,'Greenfield Supplies','Evergreen Trading','Mumbai','Pune',8500,d(-15),'Delivered',3500]];
      for(const [lr_no,booking_date,customer_id,sender_name,receiver_name,from_city,to_city,freight,due_date,delivery_status,paid] of defs){
        const id=insert('bookings',{lr_no,booking_date,customer_id,sender_name,receiver_name,from_city,to_city,description:'General goods',packages:12,weight_kg:450,freight_paise:freight*100,due_date,delivery_status,delivered_date:delivery_status==='Delivered'?d(-1):'',sender_phone:'',receiver_phone:'',vehicle_no:'MH-15-AB-1234',driver_name:'Demo driver',notes:'Sample data — not a real transaction'});
        if(paid)insert('payments',{booking_id:id,amount_paise:paid*100,payment_date:d(-1),payer_name:sender_name,method:'UPI',reference:'DEMO',notes:'Sample payment'});
      }
      insert('expenses',{expense_date:d(-2),category:'Fuel',amount_paise:580000,vehicle_no:'MH-15-AB-1234',paid_to:'Demo Fuel Station',payment_method:'UPI',notes:'Sample expense'});
      insert('expenses',{expense_date:d(-1),category:'Toll / FASTag',amount_paise:95000,vehicle_no:'MH-15-AB-1234',paid_to:'Toll',payment_method:'Cash',notes:'Sample expense'});
      db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}
    return json(res,201,{ok:true,message:'Sample records created. Delete them before real use.'});
  }
  throw bad('API route not found',404);
}

const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
async function handler(req,res){
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  try{
    const url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);
    if(url.pathname.startsWith('/api/')){
      if(!['GET','POST','PUT','PATCH','DELETE'].includes(req.method))throw bad('Method not allowed',405);
      if(req.method!=='GET'){
        const origin=req.headers.origin;
        if(origin){ const proto=(process.env.TRUST_PROXY==='true'&&req.headers['x-forwarded-proto']==='https')?'https':(req.socket.encrypted?'https':'http');const expected=process.env.PUBLIC_ORIGIN||`${proto}://${req.headers.host}`;if(origin!==expected)throw bad('Request origin not allowed',403);}
      }
      const user=sessionUser(req),body=['POST','PUT','PATCH'].includes(req.method)?await readBody(req):{};
      return handleApi(req,res,url,user,body);
    }
    if(req.method!=='GET'&&req.method!=='HEAD')throw bad('Method not allowed',405);
    let file;
    try{file=decodeURIComponent(url.pathname);}catch{throw bad('Invalid URL');}
    if(file==='/'||file==='')file='/index.html';
    const candidate=path.resolve(PUBLIC_DIR,'.'+file);
    if(!candidate.startsWith(PUBLIC_DIR+path.sep))throw bad('Not found',404);
    fs.stat(candidate,(err,stat)=>{
      if(err||!stat.isFile()){res.writeHead(404);res.end('Not Found');return;}
      res.writeHead(200,{'Content-Type':mime[path.extname(candidate)]||'application/octet-stream','Cache-Control':file==='/sw.js'?'no-cache':'public, max-age=3600'});
      if(req.method==='HEAD')return res.end();fs.createReadStream(candidate).pipe(res);
    });
  }catch(e){
    // node:sqlite uses ERR_SQLITE_ERROR with numeric extended constraint codes.
    if(e.errcode===2067||e.errcode===1555||e.code==='SQLITE_CONSTRAINT_UNIQUE')return json(res,409,{error:'This record already exists. Check LR number or username.'});
    if((Number(e.errcode)&255)===19||String(e.code||'').startsWith('SQLITE_CONSTRAINT'))return json(res,409,{error:'This action conflicts with existing linked records.'});
    if(!e.status)console.error('[server]',e);
    if(!res.headersSent)json(res,e.status||500,{error:e.status?e.message:'Server error. Check server console.'});
  }
}
const server=http.createServer(handler);
if(require.main===module)server.listen(PORT,HOST,()=>console.log(`\nNew Raja Transport is running at http://localhost:${PORT}\nData stored at ${path.join(DATA_DIR,'new-raja-transport.sqlite')}\n`));
module.exports={server,db,today};
