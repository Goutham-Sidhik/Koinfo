from flask import Flask, jsonify, request, render_template, send_file
from datetime import date, datetime
import json, uuid, os, io

APP_ROOT = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(APP_ROOT, "data")
DATA_FILE = os.path.join(DATA_DIR, "finance_data.json")

app = Flask(__name__)

# ---------------------- Data helpers ----------------------
def _load_data():
    if not os.path.exists(DATA_FILE):
        os.makedirs(DATA_DIR, exist_ok=True)
        with open(DATA_FILE, "w", encoding="utf-8") as f:
            json.dump({
                "categories":[
                    {"id": str(uuid.uuid4()), "name":"Rent","type":"expense"},
                    {"id": str(uuid.uuid4()), "name":"Groceries","type":"expense"},
                    {"id": str(uuid.uuid4()), "name":"Transport","type":"expense"},
                    {"id": str(uuid.uuid4()), "name":"Emergency Fund","type":"saving"},
                    {"id": str(uuid.uuid4()), "name":"Salary","type":"income"}
                ],
                "transactions":[],
                "debts":[],
                "goals":[]
            }, f, ensure_ascii=False, indent=2)
    with open(DATA_FILE, "r", encoding="utf-8") as f:
        return json.load(f)

def _save_data(data):
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

# ---------- name helpers ----------
def _unique_name_excluding(data, desired, exclude_id=None):
    """Return a name unique among categories, ignoring one id (for in-place updates)."""
    base = (desired or "").strip()
    names = { (c["name"] or "").strip().casefold()
              for c in data.get("categories", [])
              if c.get("id") != exclude_id }
    if base.casefold() not in names:
        return base
    i = 2
    while True:
        cand = f"{base} {i}"
        if cand.casefold() not in names:
            return cand
        i += 1

def _next_unique_category_name(data, base, kind_label=None):
    """
    Keep for non-linked categories: if duplicate, prefer semantic suffix.
    (Used when users create categories directly.)
    """
    existing = {c["name"].strip().casefold() for c in data.get("categories", [])}
    base_clean = (base or "").strip() or "Untitled"
    if base_clean.casefold() not in existing:
        return base_clean
    if kind_label:
        candidate = f"{base_clean} - {kind_label}"
        if candidate.casefold() not in existing:
            return candidate
    i = 2
    while True:
        cand = f"{base_clean} - {kind_label} {i}" if kind_label else f"{base_clean} ({i})"
        if cand.casefold() not in existing:
            return cand
        i += 1

# --- Linked category helpers (ALWAYS show origin suffix) ---
def _ensure_linked_category_for_debt(data, debt):
    """
    Always name as '<DebtName> - Debt' (ensure uniqueness).
    Payable => expense; Receivable => income.
    """
    ctype = "expense" if (debt.get("kind") or "payable") == "payable" else "income"
    base = f"{(debt.get('name') or 'Debt').strip()} - Debt"

    cat_id = debt.get("linked_category_id")
    if cat_id:
        # Update existing linked category in place, ensuring suffix & uniqueness (excluding itself).
        for c in data.get("categories", []):
            if c["id"] == cat_id:
                c["type"] = ctype
                desired = _unique_name_excluding(data, base, exclude_id=cat_id)
                c["name"] = desired
                return c["id"]

    # Create new linked category with suffixed, unique name
    name = _unique_name_excluding(data, base, exclude_id=None)
    new_cat = {"id": str(uuid.uuid4()), "name": name, "type": ctype}
    data.setdefault("categories", []).append(new_cat)
    debt["linked_category_id"] = new_cat["id"]
    return new_cat["id"]

def _ensure_linked_category_for_goal(data, goal):
    """
    Always name as '<GoalName> - Goal' (ensure uniqueness).
    Goals are type 'saving'.
    """
    ctype = "saving"
    base = f"{(goal.get('name') or 'Goal').strip()} - Goal"

    cat_id = goal.get("linked_category_id")
    if cat_id:
        for c in data.get("categories", []):
            if c["id"] == cat_id:
                c["type"] = ctype
                desired = _unique_name_excluding(data, base, exclude_id=cat_id)
                c["name"] = desired
                return c["id"]

    name = _unique_name_excluding(data, base, exclude_id=None)
    new_cat = {"id": str(uuid.uuid4()), "name": name, "type": ctype}
    data.setdefault("categories", []).append(new_cat)
    goal["linked_category_id"] = new_cat["id"]
    return new_cat["id"]

def _delete_linked_category(data, cat_id):
    if not cat_id: return
    data["categories"] = [c for c in data.get("categories", []) if c["id"] != cat_id]

# ---------------------- Pages ----------------------
@app.get("/")
def page_root():
    return render_template("dashboard.html", title="Dashboard", main_class="main main--dashboard")

@app.get("/dashboard")
def page_dashboard():
    return render_template("dashboard.html", title="Dashboard", main_class="main main--dashboard")

@app.get("/manage")
def page_manage():
    return render_template("manage.html", title="Manage", page_heading="Finance Control Center", main_class="main main--manage")

# ---------------------- API ----------------------
@app.get("/api/data")
def api_get_data():
    return jsonify(_load_data())

# Categories
@app.post("/api/category")
def api_add_category():
    p = request.get_json(force=True)
    name = (p.get("name") or "").strip()
    ctype = (p.get("type") or "expense").strip()
    if not name:
        return jsonify({"error":"Category name required"}), 400
    data = _load_data()
    names = {c["name"].strip().casefold() for c in data["categories"]}
    if name.casefold() in names:
        return jsonify({"error": f"Category '{name}' already exists"}), 409
    new_cat = {"id": str(uuid.uuid4()), "name": name, "type": ctype}
    data["categories"].append(new_cat)
    _save_data(data)
    return jsonify(new_cat), 201

@app.put("/api/category/<cid>")
def api_update_category(cid):
    p = request.get_json(force=True)
    data = _load_data()
    for c in data["categories"]:
        if c["id"] == cid:
            if "name" in p:
                new_name = (p.get("name") or "").strip()
                if not new_name:
                    return jsonify({"error":"Category name required"}), 400
                if new_name.casefold() != c["name"].strip().casefold():
                    names = {x["name"].strip().casefold() for x in data["categories"] if x["id"] != cid}
                    if new_name.casefold() in names:
                        return jsonify({"error": f"Category '{new_name}' already exists"}), 409
                c["name"] = new_name
            if "type" in p:
                c["type"] = p.get("type") or c["type"]
            _save_data(data)
            return jsonify(c)
    return jsonify({"error":"Not found"}), 404

@app.delete("/api/category/<cid>")
def api_delete_category(cid):
    data = _load_data()
    # prevent deleting linked categories
    if any((d.get("linked_category_id")==cid) for d in data.get("debts",[])) or any((g.get("linked_category_id")==cid) for g in data.get("goals",[])):
        return jsonify({"error":"Category is linked to a Debt/Goal and cannot be deleted here"}), 409
    before = len(data["categories"])
    data["categories"] = [c for c in data["categories"] if c["id"] != cid]
    _save_data(data)
    if len(data["categories"]) == before:
        return jsonify({"error":"Not found"}), 404
    return jsonify({"ok":True})

# Debts
@app.post("/api/debt")
def api_add_debt():
    p = request.get_json(force=True)
    data = _load_data()
    name = (p.get("name") or "Unnamed Debt").strip()
    kind = (p.get("kind") or "payable").strip()
    if kind not in {"payable","receivable"}:
        kind = "payable"
    names = {d.get("name"," ").strip().casefold() for d in data.get("debts", [])}
    if name.casefold() in names:
        return jsonify({"error": f"Debt '{name}' already exists"}), 409
    d = {"id": str(uuid.uuid4()), "name": name, "balance": float(p.get("balance") or 0), "kind": kind}
    _ensure_linked_category_for_debt(data, d)
    data.setdefault("debts", []).append(d)
    _save_data(data)
    return jsonify(d), 201

@app.put("/api/debt/<did>")
def api_update_debt(did):
    p = request.get_json(force=True)
    data = _load_data()
    for d in data.get("debts", []):
        if d["id"] == did:
            if "name" in p:
                new_name = (p.get("name") or "").strip()
                if not new_name:
                    return jsonify({"error":"Debt name required"}), 400
                if new_name.casefold() != d.get("name"," ").strip().casefold():
                    names = {x.get("name"," ").strip().casefold() for x in data.get("debts", []) if x["id"] != did}
                    if new_name.casefold() in names:
                        return jsonify({"error": f"Debt '{new_name}' already exists"}), 409
                d["name"] = new_name
            if "balance" in p:
                d["balance"] = float(p["balance"])
            if "kind" in p:
                k = (p.get("kind") or "payable").strip()
                if k in {"payable","receivable"}:
                    d["kind"] = k
            _ensure_linked_category_for_debt(data, d)
            _save_data(data)
            return jsonify(d)
    return jsonify({"error":"Not found"}), 404

@app.delete("/api/debt/<did>")
def api_delete_debt(did):
    data = _load_data()
    before = len(data.get("debts", []))
    cat_id = next((d.get("linked_category_id") for d in data.get("debts", []) if d["id"] == did), None)
    data["debts"] = [d for d in data.get("debts", []) if d["id"] != did]
    _delete_linked_category(data, cat_id)
    _save_data(data)
    if len(data.get("debts", [])) == before:
        return jsonify({"error":"Not found"}), 404
    return jsonify({"ok": True})

# Goals
@app.post("/api/goal")
def api_add_goal():
    p = request.get_json(force=True)
    data = _load_data()
    name = (p.get("name") or "New Goal").strip()
    deadline = (p.get("deadline") or "").strip()
    if not deadline:
        return jsonify({"error":"Deadline required"}), 400
    try:
        dl = date.fromisoformat(deadline)
    except Exception:
        return jsonify({"error":"Invalid deadline date"}), 400
    if dl <= date.today():
        return jsonify({"error":"Deadline must be after today"}), 400
    names = {g.get("name"," ").strip().casefold() for g in data.get("goals", [])}
    if name.casefold() in names:
        return jsonify({"error": f"Goal '{name}' already exists"}), 409
    created = date.today().isoformat()
    g = {"id": str(uuid.uuid4()), "name": name, "target": float(p.get("target") or 0), "current": float(p.get("current") or 0), "deadline": deadline, "created": created,}
    _ensure_linked_category_for_goal(data, g)
    data.setdefault("goals", []).append(g)
    _save_data(data)
    return jsonify(g), 201

@app.put("/api/goal/<gid>")
def api_update_goal(gid):
    p = request.get_json(force=True)
    data = _load_data()
    for g in data.get("goals", []):
        if g["id"] == gid:
            if "name" in p:
                new_name = (p.get("name") or "").strip()
                if not new_name:
                    return jsonify({"error":"Goal name required"}), 400
                if new_name.casefold() != g.get("name"," ").strip().casefold():
                    names = {x.get("name"," ").strip().casefold() for x in data.get("goals", []) if x["id"] != gid}
                    if new_name.casefold() in names:
                        return jsonify({"error": f"Goal '{new_name}' already exists"}), 409
                g["name"] = new_name
            if "target" in p: g["target"] = float(p["target"])
            if "current" in p: g["current"] = float(p["current"])
            if "deadline" in p:
                try:
                    dl = date.fromisoformat(p.get("deadline") or "")
                except Exception:
                    return jsonify({"error":"Invalid deadline date"}), 400
                if dl <= date.today():
                    return jsonify({"error":"Deadline must be after today"}), 400
                g["deadline"] = p.get("deadline")
            _ensure_linked_category_for_goal(data, g)
            _save_data(data)
            return jsonify(g)
    return jsonify({"error":"Not found"}), 404

@app.delete("/api/goal/<gid>")
def api_delete_goal(gid):
    data = _load_data()
    before = len(data.get("goals", []))
    cat_id = next((g.get("linked_category_id") for g in data.get("goals", []) if g["id"] == gid), None)
    data["goals"] = [g for g in data.get("goals", []) if g["id"] != gid]
    _delete_linked_category(data, cat_id)
    _save_data(data)
    if len(data.get("goals", [])) == before:
        return jsonify({"error":"Not found"}), 404
    return jsonify({"ok": True})

# Transactions
@app.post("/api/transaction")
def api_add_txn():
    p = request.get_json(force=True)
    data = _load_data()
    txn = {
        "id": str(uuid.uuid4()),
        "date": p.get("date") or date.today().isoformat(),
        "category_id": p.get("category_id"),
        "amount": float(p.get("amount") or 0),
        "note": p.get("note", ""),
    }
    c = next((c for c in data["categories"] if c["id"] == txn["category_id"]), None)
    if not c:
        return jsonify({"error":"Invalid category_id"}), 400
    txn["type"] = c["type"]
    data.setdefault("transactions", []).append(txn)

    # Auto reflect on linked accounts
    for d in data.get("debts", []):
        if d.get("linked_category_id") == txn["category_id"]:
            d["balance"] = max(0.0, float(d.get("balance") or 0) - abs(txn["amount"]))
            break
    for g in data.get("goals", []):
        if g.get("linked_category_id") == txn["category_id"]:
            cur = float(g.get("current") or 0)
            delta = float(txn["amount"]) 
            g["current"] = max(0.0, cur + delta)
            break

    _save_data(data)
    return jsonify(txn), 201

@app.put("/api/transaction/<tid>")
def api_update_txn(tid):
    p = request.get_json(force=True)
    data = _load_data()

    # find existing txn
    old = next((t for t in data.get("transactions", []) if t["id"] == tid), None)
    if not old:
        return jsonify({"error": "Not found"}), 404

    old_cat = old.get("category_id")
    old_amt = float(old.get("amount") or 0.0)

    # ---- APPLY new values to the txn ----
    # Only allow known fields, cast amount to float
    new_date = p.get("date", old["date"])
    new_cat  = p.get("category_id", old["category_id"])
    new_amt  = float(p.get("amount", old.get("amount") or 0.0))
    new_note = p.get("note", old.get("note", ""))

    # validate category
    cat = next((c for c in data.get("categories", []) if c["id"] == new_cat), None)
    if not cat:
        return jsonify({"error": "Invalid category_id"}), 400
    
    # ---- Adjust linked Debts / Goals using deltas ----
    if old_cat == new_cat:
        # Same linked target -> simple delta
        delta = new_amt - old_amt
        if delta != 0:
            for g in data.get("goals", []):
                if g.get("linked_category_id") == new_cat:
                    g["current"] = max(0.0, float(g.get("current") or 0.0) + delta)
                    break
            for d in data.get("debts", []):
                if d.get("linked_category_id") == new_cat:
                    # debt shrinks by payment size; delta on |amount|
                    d["balance"] = max(0.0, float(d.get("balance") or 0.0) - (abs(new_amt) - abs(old_amt)))
                    break
    else:
        # Category changed -> undo old, apply new
        for g in data.get("goals", []):
            if g.get("linked_category_id") == old_cat:
                g["current"] = max(0.0, float(g.get("current") or 0.0) - old_amt)
                break
        for d in data.get("debts", []):
            if d.get("linked_category_id") == old_cat:
                d["balance"] = max(0.0, float(d.get("balance") or 0.0) + old_amt)
                break

        for g in data.get("goals", []):
            if g.get("linked_category_id") == new_cat:
                g["current"] = max(0.0, float(g.get("current") or 0.0) + new_amt)
                break
        for d in data.get("debts", []):
            if d.get("linked_category_id") == new_cat:
                d["balance"] = max(0.0, float(d.get("balance") or 0.0) - new_amt)
                break

    # update txn record
    old.update({
        "date": new_date,
        "category_id": new_cat,
        "amount": new_amt,
        "note": new_note,
        "type": cat["type"],
    })

    _save_data(data)
    return jsonify(old)

@app.delete("/api/transaction/<tid>")
def api_delete_txn(tid):
    data = _load_data()
    # Find the txn first
    txn = next((t for t in data.get("transactions", []) if t["id"] == tid), None)
    if not txn:
        return jsonify({"error": "Not found"}), 404

    cat_id = txn.get("category_id")
    amt = float(txn.get("amount") or 0.0)
    # Roll back effects on Debt: original add reduced balance by |amt| → add it back
    for d in data.get("debts", []):
        if d.get("linked_category_id") == cat_id:
            d["balance"] = float(d.get("balance") or 0.0) + abs(amt)
            break

    # Roll back effects on Goal: original add added (+amt) to current → subtract it
    for g in data.get("goals", []):
        if g.get("linked_category_id") == cat_id:
            g["current"] = max(0.0, float(g.get("current") or 0.0) - amt)
            break

    # Remove the transaction
    data["transactions"] = [t for t in data.get("transactions", []) if t["id"] != tid]
    _save_data(data)
    return jsonify({"ok": True})

# Downloads
@app.get("/download/json")
def download_json():
    ts = datetime.now().strftime("%Y-%m-%d_%H-%M")
    fname = f"finance_{ts}.json"
    data_bytes = json.dumps(_load_data(), ensure_ascii=False, indent=2).encode("utf-8")
    return send_file(
        io.BytesIO(data_bytes),
        mimetype="application/json",
        as_attachment=True,
        download_name=fname
    )

if __name__ == "__main__":
    app.run(debug=True)
