"""Static checks only. No database or network connection."""
import json
from pathlib import Path
from pglast import parser
root = Path(__file__).resolve().parents[1]
path = root / "supabase/migrations/202610220001_document_retention_code_reuse.sql"
sql = path.read_text(encoding="utf-8")
statements = json.loads(parser.parse_sql_json(sql))["stmts"]
functions = json.loads(parser.parse_plpgsql_json(sql))
versions = [p.name.split("_", 1)[0] for p in path.parent.glob("*.sql")]
assert len(versions) == len(set(versions)), "Duplicate migration identifiers"
for item in statements:
    assert not (set(item["stmt"]) & {"InsertStmt", "UpdateStmt", "DeleteStmt", "TruncateStmt", "DoStmt", "CallStmt", "SelectStmt"}), "Migration must not modify existing records automatically"
for guard in [
    "DOCUMENT_ACTIVE_CODE_CONFLICT", "pg_advisory_xact_lock", "where deleted_at is null",
    "REASON_REQUIRED", "DOCUMENT_ADMIN_SCOPE_REQUIRED", "DOCUMENT_HISTORY_IMMUTABLE",
    "DOCUMENT_RESTORED", "DOCUMENT_DELETED", "previous_state,new_state", "DOCUMENT_SCOPE_FORBIDDEN",
]:
    assert guard.lower() in sql.lower(), f"Missing retention boundary: {guard}"
fixture = (root / "supabase/tests/document-retention.sql").read_text(encoding="utf-8")
parser.parse_sql(fixture)
parser.parse_plpgsql_json(fixture)
print(f"PASS static document SQL: {len(statements)} statements, {len(functions)} parsed functions; integration fixture syntax PASS")
print("PENDING: isolated Preview application, catalog dependencies, live RLS, rollback, concurrency and record-preservation acceptance")
