from flask import Flask, jsonify, request, render_template
from datetime import date
import json, uuid, os
from copy import deepcopy

APP_ROOT = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(APP_ROOT, "data")
DATA_FILE = os.path.join(DATA_DIR, "finance_data.json")

# A default data structure used when resetting the dataset.  This defines
# the initial categories and empty lists for transactions, debts and
# goals.  Note: we deliberately do not include the 'id' values from
# existing data as new UUIDs will be generated when the app first
# starts.  The categories provided here must match those created in
# _load_data() on first run.
DEFAULT_DATA = {
    "categories": [
        {"id": str(uuid.uuid4()), "name": "Salary", "type": "income", "deleted": False},
        {"id": str(uuid.uuid4()), "name": "Groceries", "type": "expense", "deleted": False},
        {"id": str(uuid.uuid4()), "name": "Investments", "type": "saving", "deleted": False}
    ],
    "transactions": [],
    "debts": [],
    "goals": [],
    "open_balance": 0.0
}

app = Flask(__name__)

# ---------------------- Data helpers ----------------------
def _load_data():
    """
    Load the JSON finance data file.  If the file does not exist, create a
    default dataset with some starting categories and zeroed lists.  The
    returned dict will always contain an ``open_balance`` field so the
    application can support an optional opening balance.
    """
    if not os.path.exists(DATA_FILE):
        # Initialize with some default categories. Each category includes a
        # `deleted` flag so that categories can be soft‑deleted without
        # losing the reference for existing transactions. A missing flag is
        # treated as not deleted (False) for backwards compatibility.
        os.makedirs(DATA_DIR, exist_ok=True)
        with open(DATA_FILE, "w", encoding="utf-8") as f:
            json.dump({
                "categories":[
                    {"id": str(uuid.uuid4()), "name":"Salary","type":"income", "deleted": False},
                    # {"id": str(uuid.uuid4()), "name":"Rent","type":"expense", "deleted": False},
                    {"id": str(uuid.uuid4()), "name":"Groceries","type":"expense", "deleted": False},
                    # {"id": str(uuid.uuid4()), "name":"Transport","type":"expense", "deleted": False},
                    {"id": str(uuid.uuid4()), "name":"Investments","type":"saving", "deleted": False},
                    
                ],
                "transactions":[],
                "debts":[],
                "goals":[],
                # An optional starting balance to carry over from before using
                # the app.  Users can update this value via the API.
                "open_balance": 0.0
            }, f, ensure_ascii=False, indent=2)
    with open(DATA_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)
    # Ensure the open_balance key is always present
    if "open_balance" not in data:
        data["open_balance"] = 0.0
    return data

def _save_data(data):
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

# ---------- name helpers ----------
def _unique_name_excluding(data, desired, exclude_id=None):
    """Return a name unique among categories, ignoring one id (for in-place updates)."""
    base = (desired or "").strip()
    # Only consider active (not deleted) categories when determining existing names.
    names = { (c.get("name") or "").strip().casefold()
              for c in data.get("categories", [])
              if c.get("id") != exclude_id and not c.get("deleted") }
    if base.casefold() not in names:
        return base
    i = 2
    while True:
        cand = f"{base} {i}"
        if cand.casefold() not in names:
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

    # Always create a new linked category with a unique name. We intentionally
    # do not reuse deleted categories so that old transactions remain tied
    # to their original (now deleted) category.
    name = _unique_name_excluding(data, base, exclude_id=None)
    new_cat = {"id": str(uuid.uuid4()), "name": name, "type": ctype, "deleted": False}
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

    # Always create a new linked category with a unique name. We do not
    # revive deleted categories so that transactions referencing deleted
    # categories remain locked.
    name = _unique_name_excluding(data, base, exclude_id=None)
    new_cat = {"id": str(uuid.uuid4()), "name": name, "type": ctype, "deleted": False}
    data.setdefault("categories", []).append(new_cat)
    goal["linked_category_id"] = new_cat["id"]
    return new_cat["id"]

def _delete_linked_category(data, cat_id):
    """
    Soft-delete a linked category by setting its `deleted` flag instead of
    removing it from the list. This allows existing transactions to
    continue referencing the category's name while preventing new
    selections. If the category is not found, no action is taken.
    """
    if not cat_id:
        return
    for c in data.get("categories", []):
        if c.get("id") == cat_id:
            c["deleted"] = True
            return

# ---------------------- Pages ----------------------
@app.get("/")
def page_root():
    return render_template("dashboard.html", title="Koinfo", main_class="main main--dashboard")

@app.get("/dashboard")
def page_dashboard():
    return render_template("dashboard.html", title="Koinfo-Dashboard", main_class="main main--dashboard")
    # return render_template("dashboard.html", title="Dashboard",  page_heading="KoinSight", main_class="main main--dashboard")

@app.get("/manage")
def page_manage():
    return render_template("manage.html", title="Koinfo-Manage", main_class="main main--manage")
    # return render_template("manage.html", title="Manage", page_heading="KoinStudio", main_class="main main--manage")

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
    # Only consider active (not deleted) categories when checking for duplicates
    active_names = {c["name"].strip().casefold() for c in data.get("categories", []) if not c.get("deleted")}
    if name.casefold() in active_names:
        return jsonify({"error": f"Category '{name}' already exists"}), 409
    # Create a new category with a deleted flag set to False. We deliberately
    # do not revive soft‑deleted categories with the same name so that
    # transactions tied to deleted categories remain locked even if a new
    # category with the same name is created later.
    new_cat = {"id": str(uuid.uuid4()), "name": name, "type": ctype, "deleted": False}
    data.setdefault("categories", []).append(new_cat)
    _save_data(data)
    return jsonify(new_cat), 201

@app.put("/api/category/<cid>")
def api_update_category(cid):
    p = request.get_json(force=True)
    data = _load_data()
    for c in data.get("categories", []):
        if c["id"] == cid:
            if "name" in p:
                new_name = (p.get("name") or "").strip()
                if not new_name:
                    return jsonify({"error":"Category name required"}), 400
                # Only consider active categories (excluding this one) when checking for duplicates
                active_names = {x["name"].strip().casefold() for x in data.get("categories", []) if x["id"] != cid and not x.get("deleted")}
                if new_name.casefold() != c.get("name", "").strip().casefold() and new_name.casefold() in active_names:
                    return jsonify({"error": f"Category '{new_name}' already exists"}), 409
                c["name"] = new_name
            if "type" in p:
                c["type"] = p.get("type") or c.get("type")
            _save_data(data)
            return jsonify(c)
    return jsonify({"error":"Not found"}), 404

@app.delete("/api/category/<cid>")
def api_delete_category(cid):
    data = _load_data()
    # prevent deleting linked categories
    if any((d.get("linked_category_id") == cid) for d in data.get("debts", [])) or any((g.get("linked_category_id") == cid) for g in data.get("goals", [])):
        return jsonify({"error":"Category is linked to a Debt/Goal and cannot be deleted here"}), 409
    # Determine if the category exists and gather transaction references
    cat_index = None
    for idx, c in enumerate(data.get("categories", [])):
        if c.get("id") == cid:
            cat_index = idx
            break
    if cat_index is None:
        return jsonify({"error":"Not found"}), 404

    # Count how many transactions reference this category across all time
    txn_count = sum(1 for t in data.get("transactions", []) if t.get("category_id") == cid)

    # If there are no transactions referencing this category and it is not linked to a debt or goal,
    # remove it entirely from the list.  Otherwise, perform a soft delete so that existing
    # transactions continue to show their original category name.
    if txn_count == 0:
        # Also ensure it's not linked to any debt or goal (should have been checked above)
        data["categories"].pop(cat_index)
    else:
        data["categories"][cat_index]["deleted"] = True
    _save_data(data)
    return jsonify({"ok": True})

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
    # New goals always start at zero progress.  The 'current' field from
    # the payload is ignored to prevent users from injecting arbitrary
    # current values.  The current progress will accumulate from
    # transactions in the linked category.
    g = {"id": str(uuid.uuid4()), "name": name, "target": float(p.get("target") or 0), "current": 0.0, "deadline": deadline, "created": created,}
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
            if "target" in p:
                # Always update the target if provided
                g["target"] = float(p["target"])
            # Intentionally ignore any 'current' value from the payload to
            # prevent manual manipulation of progress.  The current value
            # is updated automatically based on transactions.
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
    # Respect use_open_balance flag from client; treat missing as False.
    txn = {
        "id": str(uuid.uuid4()),
        "date": p.get("date") or date.today().isoformat(),
        "category_id": p.get("category_id"),
        "amount": float(p.get("amount") or 0),
        "note": p.get("note", ""),
        # Flags for special transaction behaviors
        "use_open_balance": bool(p.get("use_open_balance")),
        "debt_claim": bool(p.get("debt_claim", False)),
        "goal_withdrawal": bool(p.get("goal_withdrawal", False)),
    }
    c = next((c for c in data["categories"] if c["id"] == txn["category_id"]), None)
    if not c:
        return jsonify({"error":"Invalid category_id"}), 400
    txn["type"] = c["type"]
    # Persist transaction immediately
    data.setdefault("transactions", []).append(txn)

    # Helper functions to compute effect on debts/goals based on flags
    def _debt_effect(kind, amount, debt_claim):
        amt = abs(amount)
        if debt_claim:
            # Claim means we lent money -> increase balance for receivable, decrease for payable
            return amt if (kind or "payable") == "receivable" else -amt
        else:
            # Regular payment: always reduce balance
            return -amt

    def _goal_effect(amount, goal_withdrawal):
        # Withdrawals reduce current; deposits increase current
        return -amount if goal_withdrawal else amount

    # Apply effects to linked debt
    for d in data.get("debts", []):
        if d.get("linked_category_id") == txn["category_id"]:
            eff = _debt_effect(d.get("kind"), txn["amount"], txn.get("debt_claim", False))
            d["balance"] = max(0.0, float(d.get("balance") or 0.0) + eff)
            break
    # Apply effects to linked goal
    for g in data.get("goals", []):
        if g.get("linked_category_id") == txn["category_id"]:
            eff = _goal_effect(txn["amount"], txn.get("goal_withdrawal", False))
            g["current"] = max(0.0, float(g.get("current") or 0.0) + eff)
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
    old_debt_claim = bool(old.get("debt_claim", False))
    old_goal_withdrawal = bool(old.get("goal_withdrawal", False))

    # ---- APPLY new values to the txn ----
    # Only allow known fields, cast amount to float
    new_date = p.get("date", old["date"])
    new_cat  = p.get("category_id", old["category_id"])
    new_amt  = float(p.get("amount", old.get("amount") or 0.0))
    new_note = p.get("note", old.get("note", ""))

    # Determine the new value for use_open_balance.  If the client
    # explicitly passes this flag, cast it to bool; otherwise keep the
    # existing value.  This prevents accidental toggles when editing.
    if "use_open_balance" in p:
        new_use_open = bool(p.get("use_open_balance"))
    else:
        new_use_open = bool(old.get("use_open_balance", False))

    # Determine new flags for debt_claim and goal_withdrawal.  If not
    # provided by the client, retain existing values.
    if "debt_claim" in p:
        new_debt_claim = bool(p.get("debt_claim"))
    else:
        new_debt_claim = old_debt_claim

    if "goal_withdrawal" in p:
        new_goal_withdrawal = bool(p.get("goal_withdrawal"))
    else:
        new_goal_withdrawal = old_goal_withdrawal

    # validate category
    cat = next((c for c in data.get("categories", []) if c["id"] == new_cat), None)
    if not cat:
        return jsonify({"error": "Invalid category_id"}), 400

    # Helper functions to compute effect on debts/goals based on flags
    def _debt_effect(kind, amount, debt_claim):
        amt = abs(amount)
        if debt_claim:
            return amt if (kind or "payable") == "receivable" else -amt
        else:
            return -amt

    def _goal_effect(amount, goal_withdrawal):
        return -amount if goal_withdrawal else amount

    # ---- Adjust linked Debts / Goals by reverting old and applying new ----
    # Revert old
    if old_cat:
        for d in data.get("debts", []):
            if d.get("linked_category_id") == old_cat:
                eff_old = _debt_effect(d.get("kind"), old_amt, old_debt_claim)
                d["balance"] = max(0.0, float(d.get("balance") or 0.0) - eff_old)
                break
        for g in data.get("goals", []):
            if g.get("linked_category_id") == old_cat:
                eff_old_g = _goal_effect(old_amt, old_goal_withdrawal)
                g["current"] = max(0.0, float(g.get("current") or 0.0) - eff_old_g)
                break
    # Apply new
    if new_cat:
        for d in data.get("debts", []):
            if d.get("linked_category_id") == new_cat:
                eff_new = _debt_effect(d.get("kind"), new_amt, new_debt_claim)
                d["balance"] = max(0.0, float(d.get("balance") or 0.0) + eff_new)
                break
        for g in data.get("goals", []):
            if g.get("linked_category_id") == new_cat:
                eff_new_g = _goal_effect(new_amt, new_goal_withdrawal)
                g["current"] = max(0.0, float(g.get("current") or 0.0) + eff_new_g)
                break

    # update txn record
    old.update({
        "date": new_date,
        "category_id": new_cat,
        "amount": new_amt,
        "note": new_note,
        "type": cat["type"],
        "use_open_balance": new_use_open,
        "debt_claim": new_debt_claim,
        "goal_withdrawal": new_goal_withdrawal
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
    debt_claim = bool(txn.get("debt_claim", False))
    goal_withdrawal = bool(txn.get("goal_withdrawal", False))

    # Helper functions
    def _debt_effect(kind, amount, debt_claim):
        a = abs(amount)
        if debt_claim:
            return a if (kind or "payable") == "receivable" else -a
        else:
            return -a

    def _goal_effect(amount, goal_withdrawal):
        return -amount if goal_withdrawal else amount

    # Roll back effects on Debt and Goal: subtract the effect we previously applied
    for d in data.get("debts", []):
        if d.get("linked_category_id") == cat_id:
            eff = _debt_effect(d.get("kind"), amt, debt_claim)
            d["balance"] = max(0.0, float(d.get("balance") or 0.0) - eff)
            break
    for g in data.get("goals", []):
        if g.get("linked_category_id") == cat_id:
            effg = _goal_effect(amt, goal_withdrawal)
            g["current"] = max(0.0, float(g.get("current") or 0.0) - effg)
            break

    # Remove the transaction
    data["transactions"] = [t for t in data.get("transactions", []) if t["id"] != tid]
    _save_data(data)
    return jsonify({"ok": True})

# ---------------------- Opening Balance ----------------------
@app.put("/api/open_balance")
def api_update_open_balance():
    """
    Update the global opening balance.  This value represents money
    brought forward before using the app and is added to the remaining
    budget calculations.  The client must send a JSON body with an
    ``open_balance`` numeric field.  Returns the updated value on
    success.
    """
    p = request.get_json(force=True)
    try:
        new_val = float(p.get("open_balance", 0))
    except Exception:
        return jsonify({"error": "Invalid open_balance value"}), 400
    data = _load_data()
    data["open_balance"] = new_val
    _save_data(data)
    return jsonify({"open_balance": new_val})


# Reset all data back to the default dataset.  This endpoint overwrites
# the finance_data.json file with DEFAULT_DATA and returns the new
# contents.  A POST method is required to avoid accidental resets via
# GET requests.  Clients should confirm with the user before
# invoking this endpoint.
@app.post("/api/reset_data")
def api_reset_data():
    # Deep copy the default data to avoid modifying the constant
    fresh = deepcopy(DEFAULT_DATA)
    _save_data(fresh)
    return jsonify(fresh)

import webbrowser
from threading import Timer

def open_browser():
    webbrowser.open("http://127.0.0.1:2901")

if __name__ == "__main__":
    # open the browser 1 second after the server starts
    Timer(1, open_browser).start()
    app.run(host="127.0.0.1", port=2901, debug=False)

