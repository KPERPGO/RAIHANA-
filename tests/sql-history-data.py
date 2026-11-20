"""Makes a made-up but realistic pharmacy for tests/sql-history.sh: the same record kinds, paths, IDs and fields the
app saves (suppliers, purchase invoices with lines and batches, payments, returns, products, sales with batch use,
stock changes, stocktakes, customers, chronic cards, expenses, day closes, journal, events, staff, shifts, settings).
Writes SQL that saves them through erp_push in batches of 100, as two signed-in devices do. Usage: python3 this.py SEED PART
PART "base": the pharmacy before Phase 1.  PART "work": a later day of work (new sales, edits, cancels, conflicts)."""
import json, random, sys

seed, part = int(sys.argv[1]), sys.argv[2]
R = random.Random(seed)
ACCOUNT = {"sub": "5f0c6d1e-3a7b-4c2d-9e8f-1a2b3c4d5e6f", "email": "owner@example.com", "role": "authenticated"}
SESS = {"Dpc01": "8d1c2b3a-0000-4000-8000-000000000001", "Dphone": "8d1c2b3a-0000-4000-8000-000000000002"}
STAFF = [("ST-OWNER-LTH", "LTH", "owner"), ("ST-MVJGCXIU8LQ", "MUSTAFA", "owner"), ("ST-MW1ALI", "Ali ahmed", "pharmacist")]
MEDS = [("Amoxicillin", "500 mg", "Capsule", 20, 2), ("Paracetamol", "500 mg", "Tablet", 24, 2), ("Omeprazole", "20 mg", "Capsule", 14, 1),
        ("Metformin", "850 mg", "Tablet", 30, 3), ("Amlodipine", "5 mg", "Tablet", 30, 3), ("Insulin glargine", "100 IU/mL", "Pen", 5, 1),
        ("Salbutamol", "100 mcg", "Inhaler", 1, 1), ("Azithromycin", "250 mg", "Tablet", 6, 1), ("Vitamin D3", "50000 IU", "Capsule", 4, 1),
        ("Enoxaparin", "40 mg", "Prefilled syringe", 10, 1), ("Ceftriaxone", "1 g", "Vial", 1, 1), ("Ibuprofen", "400 mg", "Tablet", 20, 2),
        ("Atorvastatin", "20 mg", "Tablet", 30, 3), ("Losartan", "50 mg", "Tablet", 28, 2), ("Cetirizine", "10 mg", "Tablet", 10, 1)]
def hkey(s):
    h = 5381
    for ch in s: h = ((h << 5) + h + ord(ch)) & 0xFFFFFFFF
    n, a = h, "0123456789abcdefghijklmnopqrstuvwxyz"; out = ""
    while True:
        out = a[n % 36] + out; n //= 36
        if not n: break
    return "P" + out
def rid(p): return p + "-" + "".join(R.choice("0123456789ABCDEFGHJKMNPQRSTVWXYZ") for _ in range(11))
def day(i): return f"2026-{10 + i // 31:02d}-{1 + i % 31 if i // 31 == 0 else 1 + (i - 31) % 30:02d}"
def stamp(d, who):
    n, name, _ = who; d.update(staffBy=n, staffByName=name, staffAt="2026-11-14T09:00:00.000Z"); return d

docs = []  # (device, path, data)
if part == "base":
    sups = [("SUP-001", "Oceansky", "أوشن سكاي"), ("SUP-002", "Gudea drugstore", "مذخر كوديا"), ("SUP-003", "Al-Rafidain", "الرافدين")]
    for sid, n, ar in sups:
        docs.append(("Dpc01", f"suppliers/{sid}", {"id": sid, "name": n, "nameAr": ar, "openingBalance": None,
                     "discountTiers": [{"days": 0, "pct": 0.1}, {"days": 30, "pct": 0.05}], "statements": [], "notes": ""}))
    batches = []
    for i in range(1, 61):
        sid = sups[i % 3][0]; lines = []
        for lid in range(R.randint(6, 14)):
            m = R.choice(MEDS); qty = R.randint(1, 20); price = R.choice([2500, 3750, 4250, 6000, 8500, 12000, 18500, 26000])
            line = {"lid": str(lid), "desc": f"{m[0]} {m[1]} {m[2]} {m[3]}", "name": m[0], "strength": m[1], "form": m[2], "pack": m[3],
                    "blisters": m[4], "qty": qty, "price": price, "value": qty * price, "batch": f"B{R.randint(10000, 99999)}",
                    "expiry": f"20{R.randint(27, 29)}-{R.randint(1, 12):02d}"}
            if R.random() < .3: line["bonus"] = R.randint(1, 3)
            if m[0] in ("Insulin glargine", "Enoxaparin"): line["note"] = "براد"
            pid = hkey(line["desc"]); lines.append(line); batches.append((f"PI-2026-{i:04d}", lid, pid, m))
        total = sum(l["value"] for l in lines)
        docs.append(("Dpc01", f"invoices/PI-2026-{i:04d}", {"id": f"PI-2026-{i:04d}", "pid": f"PI-2026-{i:04d}", "supplierId": sid,
                     "invoiceNo": str(115000 + i), "date": day(i % 45), "type": R.choice(["cash", "credit"]), "printedTotal": total,
                     "invoiceDiscountPct": 10 if i % 4 == 0 else None, "status": "Approved", "receiving": "ok", "lines": lines,
                     "lidSeq": len(lines), "createdAt": "2026-10-21T08:00:00.000Z", "lastBy": "dev_x1"}))
    for i in range(40):
        pid = rid("PAY"); docs.append(("Dpc01", f"payments/{pid}", stamp({"id": pid, "supplierId": sups[i % 3][0], "amount": R.randint(100, 900) * 1000,
                     "date": day(i), "method": "cash", "verified": i % 2 == 0, "voided": False}, STAFF[0])))
    for i in range(10):
        inv, lid, pid, m = R.choice(batches); cid = rid("CR")
        docs.append(("Dpc01", f"credits/{cid}", {"id": cid, "supplierId": "SUP-001", "invoiceId": inv, "type": "return", "reason": "Short expiry",
                     "amount": 25000, "lines": [{"k": lid, "lid": str(lid), "qty": 1}], "verified": True, "voided": False}))
    for pid, m in {b[2]: b[3] for b in batches}.items():
        docs.append(("Dpc01", f"products/{pid}", stamp({"id": pid, "name": m[0], "strength": m[1], "form": m[2], "sub": m[3],
                     "sellBox": R.randint(3, 30) * 1000, "barcode": str(R.randint(10**12, 10**13)), "min": 2,
                     "priceHistory": [{"at": "2026-10-22T10:00:00.000Z", "by": "dev_x1", "box": 5000, "oldBox": None}]}, STAFF[0])))
    for n, name, role in STAFF:
        docs.append(("Dpc01", f"staff/{n}", {"id": n, "name": name, "role": role, "perms": ["sell", "newinv"] if role != "owner" else [],
                     "pinHash": "p2$" + "".join(R.choice("0123456789abcdef") for _ in range(64)), "payType": "monthly",
                     "rate": 750000 if role != "owner" else None, "active": True, "createdAt": "2026-10-22T07:00:00.000Z"}))
    shifts = []
    for i in range(150):
        s = STAFF[i % 3]; shid = rid("SH"); dev = "Dpc01" if i % 2 else "Dphone"; shifts.append((shid, s, dev))
        docs.append((dev, f"shifts/{shid}", {"id": shid, "staffId": s[0], "staffName": s[1], "start": f"{day(i % 45)}T08:00:00.000Z",
                     "end": f"{day(i % 45)}T16:00:00.000Z", "device": dev, "openCount": 50000, "closeCount": R.randint(300, 900) * 1000}))
    custs = []
    for i in range(120):
        cu = rid("CU"); custs.append(cu)
        docs.append(("Dpc01", f"customers/{cu}", stamp({"id": cu, "name": f"زبون {i}", "phone": f"0770{R.randint(1000000, 9999999)}", "notes": ""}, STAFF[2])))
    for i in range(2500):
        shid, s, dev = R.choice(shifts); lines = []; sub = 0
        for _ in range(R.randint(1, 4)):
            inv, lid, pid, m = R.choice(batches); q = R.randint(1, 3); price = R.randint(1, 20) * 250 * 4
            lines.append({"pid": pid, "name": m[0], "mode": "box", "unit": "box", "per": m[3], "qty": q, "price": price, "total": q * price,
                          "alloc": [{"key": f"{inv}:{lid}", "batch": "B1", "expiry": "2028-01", "q": q * m[3], "per": m[3], "cost": 112.5}]})
            sub += q * price
        sl = rid("SL"); d = day(i % 45)
        docs.append((dev, f"sales/{sl}", stamp({"id": sl, "no": f"{d[2:4]}{d[5:7]}{d[8:]}-{dev[1:4].upper()}-{i:03d}", "date": d, "at": f"{d}T10:00:00.000Z",
                     "staffId": s[0], "staffName": s[1], "shiftId": shid, "lines": lines, "subtotal": sub, "discount": 0, "total": sub,
                     "method": R.choice(["cash", "cash", "card", "split"]), "customerId": R.choice(custs) if R.random() < .1 else None,
                     "chronicId": None, "createdBy": "dev_x1", "given": sub, "change": 0}, s)))
    for i in range(200):
        inv, lid, pid, m = R.choice(batches); mv = rid("MV")
        docs.append(("Dpc01", f"moves/{mv}", stamp({"id": mv, "pid": pid, "key": f"{inv}:{lid}" if i % 4 else f"adj:{pid}", "q": R.randint(1, 5),
                     "per": m[3], "reason": R.choice(["Damaged", "Count correction (less found)", "Customer return"]), "date": day(i % 45)}, STAFF[i % 3])))
    for i in range(20):
        c = rid("CT"); docs.append(("Dpc01", f"counts/{c}", stamp({"id": c, "date": day(i), "started": f"{day(i)}T07:00:00.000Z", "lines": [{"pid": "Pabc", "want": 10, "got": 9}]}, STAFF[0])))
    for i in range(40):
        c = rid("CP"); docs.append(("Dpc01", f"custpays/{c}", stamp({"id": c, "customerId": R.choice(custs), "amount": 15000, "date": day(i)}, STAFF[2])))
    for i in range(30):
        c = rid("CH"); docs.append(("Dpc01", f"chronic/{c}", stamp({"id": c, "name": f"مريض مزمن {i}", "phone": "07701234567", "day": 1 + i % 28,
                     "meds": [{"pid": batches[i][2], "qty": 1, "mode": "box"}], "given": {"2026-10": rid("SL")}}, STAFF[2])))
    for i in range(90):
        c = rid("EX"); docs.append(("Dpc01", f"expenses/{c}", stamp({"id": c, "category": R.choice(["Rent", "Generator", "Electricity", "Salaries"]), "amount": R.randint(5, 500) * 1000, "date": day(i % 45)}, STAFF[0])))
    for i in range(45):
        docs.append(("Dpc01", f"closes/{day(i)}", stamp({"id": day(i), "counted": 650000, "expected": 650000, "diff": 0}, STAFF[0])))
    for i in range(20):
        c = rid("JE"); docs.append(("Dpc01", f"journal/{c}", {"id": c, "date": day(i), "desc": "Owner drawing", "lines": [{"acc": "Cash", "cr": 100000}, {"acc": "Owner", "dr": 100000}], "by": "ST-OWNER-LTH", "voided": False}))
    for i in range(100):
        c = rid("EV"); docs.append(("Dphone", f"events/{c}", {"id": c, "type": "blocked_sale", "at": "2026-11-01T10:00:00.000Z", "date": day(i % 45), "staffId": "ST-MW1ALI", "staffName": "Ali ahmed", "want": 5, "avail": 2}))
    docs.append(("Dpc01", "meta/erp", {"name": "صيدلية ريحانة", "phone": "07700000000", "alertDays": 7, "staffDiscPct": 0, "pinOff": False, "lockTo": "2026-10-31"}))
    docs.append(("Dpc01", "meta/backup", {"lastAt": "2026-11-14T20:00:00.000Z", "by": "dev_x1"}))
    docs.append(("Dphone", "meta/pushsub-Dphone", {"endpoint": "https://push.example/abc", "keys": {"p256dh": "x", "auth": "y"}, "stock": True}))
    docs.append(("Dpc01", "meta/pushnote", {"title": "Raihana", "body": "3 items to order"}))
    fixture = json.load(open(sys.argv[3])) if len(sys.argv) > 3 else None
    if fixture: docs.append(("Dpc01", "invoices/" + fixture.get("id", "PI-FIXTURE"), fixture))

def push(rows, dev):
    claims = {**ACCOUNT, "session_id": SESS[dev]}
    print(f"select set_config('request.jwt.claims', '{json.dumps(claims)}', false);")
    print("set role authenticated;")
    body = json.dumps([{"path": p, "data": d, "base": b, "device": dev} for p, d, b in rows], ensure_ascii=False).replace("'", "''")
    print(f"select count(*) filter (where (x->>'ok')::boolean) as saved from jsonb_array_elements(erp_push('{body}')) x;")
    print("reset role;")

if part == "base":
    for dev in ("Dpc01", "Dphone"):
        mine = [(p, d, 0) for dv, p, d in docs if dv == dev]
        for i in range(0, len(mine), 100): push(mine[i:i + 100], dev)
else:
    # a day of work, written as SQL that reads the current versions (as the app knows them after its last sync)
    print("select set_config('request.jwt.claims', '" + json.dumps({**ACCOUNT, "session_id": SESS["Dphone"]}) + "', false);")
    print("set role authenticated;")
    for i in range(300):  # new sales from the phone
        sl = f"SL-WORK{i:05d}"
        d = {"id": sl, "no": f"261115-PHO-{i:03d}", "date": "2026-11-15", "at": "2026-11-15T09:00:00.000Z", "staffId": "ST-MW1ALI",
             "staffName": "Ali ahmed", "staffBy": "ST-MW1ALI", "staffByName": "Ali ahmed", "lines": [{"pid": "Pxyz", "qty": 1, "price": 5000, "total": 5000,
             "alloc": [{"key": "PI-2026-0001:0", "q": 20, "per": 20, "cost": 112.5}]}], "subtotal": 5000, "discount": 0, "total": 5000, "method": "cash"}
        print(f"select erp_push('{json.dumps([{'path': 'sales/' + sl, 'data': d, 'base': 0, 'device': 'Dphone'}], ensure_ascii=False)}')->0->>'ok';")
    # cancel 5 old sales (allowed: only the cancel mark changes)
    print("""select erp_push(jsonb_build_array(jsonb_build_object('path', path, 'data', data || '{"voided":true,"voidReason":"customer changed mind","voidedBy":"ST-OWNER-LTH"}', 'base', ver, 'device', 'Dphone')))->0->>'ok'
             from (select path, data, ver from erp_docs where path like 'sales/%' and path not like 'sales/SL-WORK%' order by path limit 5) s;""")
    # try to change an old sale's total (refused, kept in erp_conflicts)
    print("""select erp_push(jsonb_build_array(jsonb_build_object('path', path, 'data', data || '{"total":1}', 'base', ver, 'device', 'Dphone')))->0->>'ok'
             from (select path, data, ver from erp_docs where path like 'sales/%' order by path offset 10 limit 1) s;""")
    print("reset role;")
    print("select set_config('request.jwt.claims', '" + json.dumps({**ACCOUNT, "session_id": SESS["Dpc01"]}) + "', false);")
    print("set role authenticated;")
    # price changes from the PC, one stale edit from the phone (conflict), a staff change, a settings change
    print("""select erp_push(jsonb_build_array(jsonb_build_object('path', path, 'data', data || jsonb_build_object('sellBox', (data->>'sellBox')::int + 250, 'staffBy', 'ST-OWNER-LTH', 'staffByName', 'LTH'), 'base', ver, 'device', 'Dpc01')))->0->>'ok'
             from (select path, data, ver from erp_docs where path like 'products/%' order by path limit 20) s;""")
    print("""select erp_push(jsonb_build_array(jsonb_build_object('path', path, 'data', data || '{"sellBox":1}', 'base', 1, 'device', 'Dphone')))->0->>'ok'
             from (select path, data from erp_docs where path like 'products/%' order by path limit 1) s;""")
    print("""select erp_push(jsonb_build_array(jsonb_build_object('path', 'staff/ST-MW1ALI', 'data', data || '{"perms":["sell","newinv","stock"]}', 'base', ver, 'device', 'Dpc01')))->0->>'ok' from erp_docs where path = 'staff/ST-MW1ALI';""")
    print("""select erp_push(jsonb_build_array(jsonb_build_object('path', 'meta/erp', 'data', data || '{"pinOff":true}', 'base', ver, 'device', 'Dpc01')))->0->>'ok' from erp_docs where path = 'meta/erp';""")
    print("""select erp_push(jsonb_build_array(jsonb_build_object('path', 'meta/erp', 'data', data, 'base', 0, 'device', 'Dpc01')))->0->>'ok' from erp_docs where path = 'meta/erp';""")
    print("reset role;")
    # the daily notification function marks a phone's subscription as gone (service role, direct update)
    print("select set_config('request.jwt.claims', '{\"role\":\"service_role\"}', false);")
    print("set role service_role;")
    print("""update public.erp_docs set data = data || '{"off":true}' where path = 'meta/pushsub-Dphone';""")
    print("reset role;")
    print("select set_config('request.jwt.claims', '', false);")
