"""Parse SQL/PLpgSQL and check deployment boundaries. Never connects to a database."""
import json
from pathlib import Path
from pglast import parser

path = Path(__file__).resolve().parents[1] / "supabase/migrations/202610220001_home_image_slots.sql"
sql = path.read_text(encoding="utf-8")
statements = json.loads(parser.parse_sql_json(sql))["stmts"]
functions = json.loads(parser.parse_plpgsql_json(sql))
assert len(functions) == 2, "Expected immutable-history trigger and guarded publication RPC"
for item in statements:
    statement = item["stmt"]
    assert not (set(statement) & {"UpdateStmt", "DeleteStmt", "TruncateStmt", "DropStmt", "SelectStmt", "CallStmt", "DoStmt"}), "Automatic record operations are forbidden"
    if "InsertStmt" in statement:
        target = statement["InsertStmt"]["relation"]
        assert (target.get("schemaname"), target["relname"]) == ("storage", "buckets"), "Only the new private bucket may be initialized"
lower = sql.lower()
for guard in [
    "enable row level security", "p.organization_id = home_image_versions.organization_id",
    "home_image_versions.workspace_mode", "actor.status <> 'active'", "actor.user_type <> 'administrator'",
    "where id = auth.uid() for share", "confirmed is distinct from true", "pg_advisory_xact_lock",
    "coalesce(previous.revision, 0) <> expected_revision", "home_image_stale_revision",
    "before update or delete", "previous_value, new_value", "restore_version", "security definer set search_path = ''",
    "revoke all on function public.publish_home_image", "from public, anon",
]:
    assert guard in lower, f"Missing safety boundary: {guard}"
print(f"PASS static SQL/PLpgSQL: {len(statements)} statements, {len(functions)} function bodies")
print("PENDING: schema application, catalog compatibility, transactional behavior, RLS and integration in isolated Preview")
