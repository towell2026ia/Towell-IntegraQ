"""Parse FIX-03 SQL only. Never connects to a database."""
import json
import re
from pathlib import Path
from pglast import parser
root = Path(__file__).resolve().parents[1]
path = root / "supabase/migrations/20261028153100_iq_fix03_user_permissions_portal_isolation.sql"
sql = path.read_text(encoding="utf-8")
statements = json.loads(parser.parse_sql_json(sql))["stmts"]
functions = json.loads(parser.parse_plpgsql_json(sql))
for entry in statements:
    assert not (set(entry["stmt"]) & {"InsertStmt", "UpdateStmt", "DeleteStmt", "TruncateStmt", "DoStmt", "CallStmt", "SelectStmt"}), "Automatic data mutation is forbidden"
versions = [p.name.split("_", 1)[0] for p in path.parent.glob("*.sql")]
assert len(versions) == len(set(versions)), "Duplicate migration version"
for token in ["ACCESS_STALE", "for update", "previous_value,new_value", "ACCESS_CANNOT_DELEGATE", "as restrictive", "p.workspace_mode='production'", "save_user_access"]:
    assert token.lower() in sql.lower(), token
assert not re.search(r"\b(delete\s+from|truncate|drop\s+table|db\s+reset)\b", sql, re.I), "Destructive operation in prepared migration"
print(f"PASS FIX-03 static SQL: {len(statements)} statements; {len(functions)} parsed functions")
print("PENDING: isolated application, dependencies, RLS, concurrent writes, rollback and session persistence")
