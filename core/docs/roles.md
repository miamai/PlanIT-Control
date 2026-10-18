# Account roles

The application accepts exactly two role values: `user` and `admin`.

| Capability | User | Admin |
| --- | --- | --- |
| Read sites, observations, risks, alerts, and briefings | Yes | Yes |
| Submit field hazard reports | Yes | Yes |
| Read submitted reports | No | Yes |
| Acknowledge and resolve alerts | No | Yes |
| Manage accounts | No | Yes |

The backend reads the account's current database role for authorization rather
than trusting the JWT role claim. Existing access tokens therefore use the new
permissions immediately after migration; refresh/login responses return the new
role names. Reload the frontend after deploying the updated build.

## Migration

Run `uv run alembic upgrade head` from `core/` before starting the updated API.
Revision `20261017_0005` maps stored SQLAlchemy enum member names `CREW` to `USER`
and `SUPERVISOR` to `ADMIN`, including disabled and deleted accounts. Existing
`ADMIN` accounts remain unchanged. Account IDs, passwords, statuses, and refresh
sessions are preserved. A database check constraint rejects other role values.
Old API values `crew` and `supervisor` are rejected with validation errors.

Downgrading maps `USER` back to `CREW`. Merged admins remain `ADMIN`; their prior
supervisor/admin distinction cannot be inferred and is not reconstructed.
Historical migrations intentionally retain their original role names.

The `crew_reports` table, report schemas, and ML report payloads describe field
reporting data and retain their existing names. They are not account roles.
