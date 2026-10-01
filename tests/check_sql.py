"""Syntax-check supabase.sql and supabase-update.sql with a real PostgreSQL parser (pip install pglast).
Validates every statement and the body of every plpgsql function."""
import sys
from pglast import parse_sql, parse_plpgsql
from pglast.stream import RawStream

files = sys.argv[1:]
if not files:
    print('usage: check_sql.py file.sql [...]'); sys.exit(2)
bad = 0
for f in files:
    sql = open(f, encoding='utf-8').read()
    stmts = parse_sql(sql)
    funcs = 0
    for raw in stmts:
        if raw.stmt.__class__.__name__ == 'CreateFunctionStmt':
            parse_plpgsql(RawStream()(raw)); funcs += 1
    print(f'{f}: OK ({len(stmts)} statements, {funcs} functions)')
sys.exit(bad)
