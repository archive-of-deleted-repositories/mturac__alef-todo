# alef-todo

A multi-user, team-shared CLI todo app **written entirely in Alef**.

The only TypeScript is the Alef compiler and the Node bridges that
back `std.crypto` and `std.db`. The schema, ACL rules, business
logic, and CLI dispatch all live in [`src/main.alef`](src/main.alef)
— about 1000 lines of Alef.

## Why

Tier 1.7 of the [aleflang](https://github.com/mturac/aleflang)
release plan was "build a non-trivial Alef app to prove the
language supports a real program, not just tutorial snippets."
`alef-todo` is that app. It exercises:

- structs (user, team, todo) with optional fields encoded as
  empty strings
- the Alef `match` dispatch (the v1 parser has an `else if`
  dangling-else quirk that we work around with nested if-else)
- imports from five stdlib modules: `std.process`, `std.os`,
  `std.fs`, `std.json`, `std.crypto`, `std.db`
- the Alef string interpolation lexer (we have to encode the
  result envelope as a Struct and let `std.json.encode` do the
  brace escaping, because typing raw `{}` in a string literal
  opens an interpolation)

The persistence is a single JSON file with dotted keys, written
atomically by `std.db` and protected by an advisory `flock`. No
external services. No build step beyond `alef run`.

## Install

```sh
# From this repo:
export PATH="$PWD/bin:$PATH"

# Or, if you have alef installed:
ln -s "$PWD/bin/alef-todo" /usr/local/bin/alef-todo
```

`alef-todo` will look for the Alef repo at `$ALEF_REPO` (or
`../aleflang` next to this repo). Set `ALEF_REPO` if you keep
them in different places.

## Usage

```
alef-todo register <name> <password>
alef-todo login <name> <password>
alef-todo logout
alef-todo whoami
alef-todo team create <name>
alef-todo team join <team_id>
alef-todo team members <team_id>
alef-todo add <text...> [--team <team_id>]
alef-todo list [--team <team_id>] [--all]
alef-todo done <id>
alef-todo remove <id>
alef-todo share <todo_id> <user_id>
```

Personal todos are private. Team todos are visible to team
members. A user can `share` a personal todo with another user
to grant one-off access.

## Persistence

State lives in `$ALEF_TODO_DIR/db.json` (defaults to
`~/.alef-todo/db.json`). The session token is in
`~/.alef-todo/session`. Delete the directory to reset.

The on-disk format is a flat JSON object with dotted keys:

```
"users.<id>"              -> {id, name, pass_hash}
"users_by_name.<name>"    -> <id>
"tokens.<token>"          -> <user_id>
"teams.<id>"              -> {id, name, owner_id, created_at}
"teams_by_name.<name>"    -> <id>
"team_members.<t>.<u>"    -> {role}
"todos.<id>"              -> {id, owner_id, team_id, text, done, created_at}
"shares.<todo>.<user>"    -> {}
```

`tokens` is a single-use auth handle: the wrapper writes a
session file on `login` and reads it on every subsequent
invocation. `tokens.<token> -> <user_id>` resolves the
caller. `logout` deletes the entry.

## lib mode (IPC)

For scripts, tests, and (in v1.1) a TS web server, `alef-todo
lib <method> <args...>` emits a single JSON envelope on stdout:

```json
{"ok":true,"result":<value>}
{"ok":false,"err":"<message>"}
```

Methods:

```
lib register <name> <password>
lib login    <name> <password>
lib logout
lib whoami
lib team_create <name>
lib team_join   <team_id>
lib team_members <team_id>
lib add         <text...> [--team <team_id>]
lib list        [--team <team_id>] [--all]
lib done        <id>
lib remove      <id>
lib share       <todo_id> <user_id>
```

The `result` field for `add` and the various `list` calls is a
JSON-encoded string the consumer must `JSON.parse` to recover
the array/object. (This is a v1.0 workaround for the brace
issue in Alef string interpolation — see KNOWN_ISSUES in the
main aleflang repo for the parser-level fix that would let us
emit a real nested JSON object directly.)

## Security

- Passwords are hashed with PBKDF2-SHA256, 200k iterations, 16
  random bytes of salt. The on-disk format is
  `pbkdf2$<iterations>$<salt-hex>$<hash-hex>`. Verification
  uses `crypto.timingSafeEqual`.
- Session tokens are 16 random bytes (hex). They're invalidated
  on logout; there's no expiration yet.
- File writes are atomic (`write tmp; rename`) and serialized
  with a sidecar `flock`. Concurrent writers wait briefly and
  retry, then fall through on persistent contention (rare
  unless multiple processes are hitting the same db).
- `std.db` auto-creates the parent dir on first write, so a
  fresh install doesn't error out with ENOENT.

There is no rate limiting on login attempts and no password
strength check. Those are out of scope for v1.0.

## Tests

```sh
# From the aleflang repo (so node_modules/tsx is available):
node --import tsx --test /Users/mehmet.turac/Projects/alef-todo/tests/cli.test.ts
```

The suite is 9 cases covering register, login, duplicate-name
rejection, wrong-password rejection, whoami-before-login, add
and list, team create/join/ACL, share, done/remove, and
`--all` ACL bypass. Each test uses a fresh `$ALEF_TODO_DIR`
in `os.tmpdir()` for hermeticity.

## What's missing (deferred to v1.1)

- A web tier. The Alef v1.0 interpreter is synchronous; a
  Node http server needs the event loop, which Alef's `main()`
  would tear down. Bridging them is real work — likely: split
  the interpreter into a tick-driven scheduler and suspend on
  `await`. v1.0 users can call the CLI's lib mode from a TS
  server today; the lib mode IPC shape was designed with that
  use case in mind.
- Token expiration.
- Login rate limiting.
- Search and tags.
- Bulk operations (mark all done, archive).
- The `else if` parser quirk (`alef-todo` works around it with
  explicit nested if-else; the underlying fix is in
  [aleflang](https://github.com/mturac/aleflang) v1.1).
- Recursive `if n < 5 { lib_fail; return }` patterns — the
  Alef parser happily accepts a single-statement body, but two
  statements in a row confuse it if the second is an
  assignment. We split dispatch into multiple cases rather than
  fight it.

## License

Same as aleflang.
