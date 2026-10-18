# Admin user management

The `/admin/users` route connects to the existing core user-management API.
Only an Admin sees the Administration navigation group (including command
search), can enter the route, or starts the user-list query. The backend remains
the authority for all permissions and account protections.

## API coverage

| Action | Endpoint |
| --- | --- |
| List, role/status filters, include deleted, pagination | `GET /api/admin/users` |
| Inspect current account details | `GET /api/admin/users/{user_id}` |
| Create User or Admin | `POST /api/admin/users` |
| Edit display name, role, status, or password | `PATCH /api/admin/users/{user_id}` |
| Soft-delete after confirmation | `DELETE /api/admin/users/{user_id}` |

Usernames are immutable after creation. New passwords require 8–256 characters;
leaving the edit password empty preserves the existing password. Passwords are
never stored in browser storage or displayed in the table. Edits send only changed
fields so that a display-name change does not unintentionally revoke sessions.

Self-deletion is disabled. The server's last-active-admin protection and other
409/403 errors are shown without claiming success or closing a failed form.
Deleted accounts can be inspected but cannot be edited or restored by this API.
Disabling an account is reversible through its status field.

Changing the current Admin's role or password, or disabling their account, clears
the frontend session and query cache and returns to sign-in after success.
Peer-admin accounts use the same CRUD flow as other roles.

## Validation

Automated tests exercise the real typed client against mocked HTTP responses,
including bearer authorization, filters, pagination, payloads, bodyless 204
deletion, and backend conflicts. Browser component tests cover validation,
peer-admin editing, detail loading, deletion confirmation and retry, navigation
visibility, non-admin query blocking, and self-role changes.

Manual checks use the existing signed-in Admin against the local backend for
list/detail/filter reads and desktop/mobile layouts. No existing account is
created, changed, or deleted during those checks. Write behavior is exercised
with isolated test doubles.
