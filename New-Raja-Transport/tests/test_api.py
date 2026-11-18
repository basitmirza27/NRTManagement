"""Run end-to-end API checks with: python tests/test_api.py (Node.js 22.13+ required)."""
import http.cookiejar
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import unittest
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]

class TransportAPITest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory(prefix='nrt-api-test-')
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            cls.port = sock.getsockname()[1]
        cls.base = f'http://127.0.0.1:{cls.port}'
        env = dict(os.environ, PORT=str(cls.port), HOST='127.0.0.1', DATA_DIR=cls.tmp.name)
        cls.proc = subprocess.Popen(['node', str(ROOT/'server.js')], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        for _ in range(80):
            try:
                with urllib.request.urlopen(cls.base+'/api/status', timeout=0.3) as res:
                    if res.status == 200: break
            except (OSError, urllib.error.URLError): time.sleep(0.1)
        else: raise RuntimeError('Transport server did not start')
        cls.cookies = http.cookiejar.CookieJar()
        cls.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cls.cookies))

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate()
        try: cls.proc.wait(timeout=3)
        except subprocess.TimeoutExpired: cls.proc.kill()
        cls.proc.stderr.close()
        cls.tmp.cleanup()

    @classmethod
    def api(cls, path, method='GET', payload=None):
        data = None if payload is None else json.dumps(payload).encode('utf-8')
        request = urllib.request.Request(cls.base+path, data=data, method=method, headers={'Content-Type':'application/json'})
        try:
            with cls.opener.open(request, timeout=8) as res:
                body = res.read().decode('utf-8-sig')
                if path.startswith('/api/export/'):
                    return res.status, body
                return res.status, json.loads(body)
        except urllib.error.HTTPError as exc:
            return exc.code, json.loads(exc.read())

    def test_01_unauthenticated_and_initial_account(self):
        self.assertEqual(self.api('/api/status'), (200, {'setup_required':True}))
        self.assertEqual(self.api('/api/bookings')[0], 401)
        status, setup = self.api('/api/setup', 'POST', {'username':'administrator','password':'SuperStrongPassword!123'})
        self.assertEqual(status, 201)
        self.assertEqual(setup['user']['username'], 'administrator')
        self.assertEqual(self.api('/api/status'), (200, {'setup_required':False}))
        self.assertEqual(self.api('/api/setup','POST', {'username':'hacker','password':'hackerpassword'})[0],409)

    def test_02_customers_bookings_payments_balances(self):
        status, customer = self.api('/api/customers', 'POST', {'name':'Test Traders', 'phone':'9876543210','whatsapp':'9876543210','gstin':'','address':'Pune'})
        self.assertEqual(status, 201)
        type(self).customer_id = customer['id']
        self.assertEqual(self.api('/api/bookings', 'POST', {'lr_no':'X123'})[0],400)
        self.booking_payload = {
            'lr_no':'NRT-TEST-2026-1', 'booking_date':'2026-11-01', 'customer_id':self.customer_id,
            'sender_name':'Test Traders', 'receiver_name':'Mr Receiver', 'from_city':'Nashik', 'to_city':'Pune',
            'freight':'12000.50', 'due_date':'2026-11-03','delivery_status':'Booked','packages':'3'
        }
        status, booking = self.api('/api/bookings','POST',self.booking_payload)
        self.assertEqual(status,201)
        type(self).booking_id = booking['id']
        self.assertEqual(booking['balance'],12000.5)
        self.assertEqual(self.api('/api/bookings','POST',self.booking_payload)[0],409)
        status, p = self.api('/api/payments','POST',{'booking_id':self.booking_id,'amount':'3000.25', 'payment_date':'2026-11-02','payer_name':'Test Traders','method':'UPI','reference':'UTR123'})
        self.assertEqual(status,201)
        type(self).payment_id=p['id']
        self.assertEqual(p['booking']['balance'],9000.25)
        self.assertEqual(self.api('/api/payments','POST',{'booking_id':self.booking_id,'amount':'9000.26', 'payment_date':'2026-11-02','payer_name':'Test','method':'Cash'})[0],400)
        self.assertEqual(self.api('/api/bookings/'+str(self.booking_id),'PATCH',{**self.booking_payload,'freight':'2900'})[0],400)
        self.assertEqual(self.api('/api/bookings/'+str(self.booking_id),'DELETE')[0],409)
        self.assertEqual(self.api('/api/payments/'+str(self.payment_id),'PATCH',{'amount':'4000.25','payment_date':'2026-11-02','payer_name':'Test Traders','method':'Bank Transfer'})[0],200)
        status, detail = self.api('/api/bookings/'+str(self.booking_id))
        self.assertEqual(status,200)
        self.assertEqual(detail['balance'],8000.25)
        self.assertEqual(len(detail['payments']),1)
        status, dashboard = self.api('/api/dashboard')
        self.assertEqual(status,200)
        self.assertEqual(dashboard['overdue'],8000.25)
        self.assertEqual(dashboard['overdue_count'],1)
        self.assertEqual(len(self.api('/api/bookings?payment=overdue')[1]),1)
        self.assertEqual(self.api('/api/reports')[0],200)
        self.assertIn('NRT-TEST-2026-1', self.api('/api/export/bookings')[1])
        self.assertEqual(self.api('/api/customers/'+str(self.customer_id),'DELETE')[0],409)

    def test_03_expenses_backup_restore_full_payment(self):
        status, expense = self.api('/api/expenses', 'POST', {'expense_date':'2026-11-02','category':'Fuel','amount':'350.50','vehicle_no':'MH-15-AA-0001','paid_to':'Fuel pump','payment_method':'Cash'})
        self.assertEqual(status,201)
        self.assertEqual(expense['amount'],350.5)
        status, backup = self.api('/api/backup')
        self.assertEqual(status,200)
        self.assertEqual(backup['app'],'New Raja Transport')
        self.assertEqual(len(backup['bookings']),1)
        self.assertEqual(self.api('/api/restore','POST',{**backup,'confirm_replace':True})[0],200)
        self.assertEqual(len(self.api('/api/bookings')[1]),1)
        self.assertEqual(len(self.api('/api/payments')[1]),1)
        self.assertEqual(len(self.api('/api/expenses')[1]),1)
        status, pay = self.api('/api/payments','POST',{'booking_id':self.booking_id,'amount':'8000.25','payment_date':'2026-11-10','payer_name':'Receiver','method':'Cash'})
        self.assertEqual(status,201)
        self.assertEqual(pay['booking']['balance'],0)
        self.assertEqual(self.api('/api/dashboard')[1]['overdue'],0)
        self.assertEqual(self.api('/api/payments/'+str(self.payment_id),'DELETE')[0],200)
        self.assertEqual(self.api('/api/dashboard')[1]['outstanding'],4000.25)

if __name__ == '__main__':
    unittest.main(verbosity=2)
