"""Temporary admin site for browser styling checks; never uses saved credentials."""
from pathlib import Path
import sys
import tempfile
import threading
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server
from rider_portal_checks import fixtures

if __name__ == "__main__":
    with tempfile.TemporaryDirectory(prefix="fiable-admin-style-") as directory:
        fixtures(directory)
        for name in ["ADMIN_CREDENTIALS_FILE", "PAYMENTS_FILE", "RIDER_PAYMENTS_FILE", "SUPPORT_TICKETS_FILE", "UNIT_ADJUSTMENTS_FILE"]:
            setattr(server, name, Path(directory) / (name.lower() + ".json"))
        server.save_admin_credentials([{"id":1,"email":"owner@example.test","name":"Test Owner","role":"owner","status":"active","salt":"test-salt","passwordHash":server.password_hash("Admin-style-password","test-salt"),"mfaEnabled":False}])
        server.atomic_write_json(server.ACCOUNTS_FILE, [{"email":"vendor@example.test","name":"Example Vendor","subscriberId":"FL-SUB-0001","plan":"Basic","paymentStatus":"pending","createdAt":server.now_iso()}])
        orders=server.load_deliveries()
        for order in orders:
            order["email"]="vendor@example.test"
            order["details"]["recipientName"]="Example Recipient"
        server.save_deliveries(orders)
        server.atomic_write_json(server.SUPPORT_TICKETS_FILE,[{"id":1,"ticketRef":"TICKET-1","vendorEmail":"vendor@example.test","subject":"Delivery enquiry","category":"delivery_issue","status":"open","priority":"normal","createdAt":server.now_iso(),"messages":[]}])
        httpd=server.ThreadingHTTPServer(("127.0.0.1",8092),server.FiableHandler)
        print("Isolated admin styling site ready at http://127.0.0.1:8092/admin-login.html",flush=True)
        try: httpd.serve_forever()
        finally: httpd.server_close()
