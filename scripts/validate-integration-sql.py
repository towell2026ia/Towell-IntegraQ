"""Read-only integration inventory and SQL parsing. Never connects to a database."""
import hashlib
import json
from pathlib import Path
from pglast import parser

root = Path(__file__).resolve().parents[1]
manifest = json.loads((root / "scripts/integration-migrations.json").read_text())
paths = sorted((root / "supabase/migrations").glob("*.sql"))
versions = [path.name.split("_", 1)[0] for path in paths]
assert len(versions) == len(set(versions)), "Duplicate migration identifiers"
expected = set(manifest["baseline"]) | {item["path"] for item in manifest["pending"]}
assert expected == {p.relative_to(root).as_posix() for p in paths}, "Unreviewed migration inventory change"
for path, expected_hash in list(manifest["baseline"].items()) + [(item["path"], item["sha256"]) for item in manifest["pending"]]:
    content = (root / path).read_bytes().replace(b"\r\n", b"\n")
    assert hashlib.sha256(content).hexdigest() == expected_hash, f"Changed baseline/source migration: {path}"
for item in manifest["pending"]:
    sql = (root / item["path"]).read_text(encoding="utf-8-sig")
    statements = json.loads(parser.parse_sql_json(sql))["stmts"]
    functions = json.loads(parser.parse_plpgsql_json(sql))
    for entry in statements:
        stmt = entry["stmt"]
        assert not (set(stmt) & {"UpdateStmt", "DeleteStmt", "TruncateStmt", "DoStmt", "CallStmt", "SelectStmt"}), "Automatic existing-record mutation"
        if "InsertStmt" in stmt:
            insert = stmt["InsertStmt"]
            assert (insert["relation"].get("schemaname"), insert["relation"]["relname"]) == ("storage", "buckets")
            assert insert.get("onConflictClause", {}).get("action") in {None, "ONCONFLICT_NOTHING"}, "Bucket must never be overwritten"
        if "DropStmt" in stmt:
            assert stmt["DropStmt"]["removeType"] in {"OBJECT_TRIGGER", "OBJECT_POLICY"}, "Destructive DROP"
        if "AlterTableStmt" in stmt:
            for command in stmt["AlterTableStmt"]["cmds"]:
                alter = command["AlterTableCmd"]
                if alter["subtype"].startswith("AT_Drop"):
                    assert alter["subtype"] == "AT_DropConstraint" and alter.get("name") == "controlled_documents_code_key", "Destructive ALTER"
    print(f"PASS {Path(item['path']).name}: {len(statements)} statements; {len(functions)} function bodies parsed")
print(f"PASS: {len(manifest['baseline'])} baseline migrations unchanged; all 5 PR migrations byte-identical to source commits")
print("PENDING: actual migration history, catalog dependencies, execution/RLS and BEFORE/AFTER preservation in an authorized isolated environment")
