#!/usr/bin/env node
// tests/cli.test.ts — lib-mode integration tests for
// alef-todo. Each test shells out to the `alef-todo` wrapper
// (which execs `alef run src/main.alef` under the hood) and
// asserts on the JSON envelope. We use a temporary
// $ALEF_TODO_DIR for hermeticity so multiple test runs and
// parallel CI jobs don't see each other's state.
//
// Run with: `node --import tsx --test tests/cli.test.ts`
// or via `npm test` (the repo's vitest runner picks these up).

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

const REPO = process.env.ALEF_REPO ||
  "/Users/mehmet.turac/Documents/Projects/xtheideas/aleflang";
const WRAPPER = join(
  process.env.ALEF_TODO_REPO || join(process.env.HOME || "", "Projects/alef-todo"),
  "bin/alef-todo"
);
let dir: string;

function run(...args: string[]): { ok: boolean; result?: any; err?: string } {
  try {
    const stdout = execFileSync(WRAPPER, args, {
      env: { ...process.env, ALEF_TODO_DIR: dir, ALEF_REPO: REPO },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    return JSON.parse(stdout);
  } catch (e: any) {
    // The CLI exits non-zero on lib-fail too (the json
    // envelope still prints). Try to parse stdout anyway.
    const out = (e.stdout ?? "").toString().trim();
    if (out.startsWith("{")) {
      try { return JSON.parse(out); } catch { /* fallthrough */ }
    }
    return { ok: false, err: out || (e.message ?? String(e)) };
  }
}

before(() => {
  dir = mkdtempSync(join(tmpdir(), "alef-todo-test-"));
});

after(() => {
  rmSync(dir, { recursive: true, force: true });
});

test("register then login", () => {
  const r = run("lib", "register", "alice", "hunter2");
  assert.equal(r.ok, true, `register: ${JSON.stringify(r)}`);
  assert.equal(typeof r.result.id, "string");
  assert.equal(r.result.name, "alice");

  const l = run("lib", "login", "alice", "hunter2");
  assert.equal(l.ok, true, `login: ${JSON.stringify(l)}`);
  assert.equal(l.result.id, r.result.id);
});

test("duplicate register fails", () => {
  const r = run("lib", "register", "alice2", "pw");
  assert.equal(r.ok, true);
  const dup = run("lib", "register", "alice2", "other-pw");
  assert.equal(dup.ok, false, "duplicate should fail");
  assert.match(dup.err, /already taken/);
});

test("wrong password fails", () => {
  run("lib", "register", "carol", "right");
  const bad = run("lib", "login", "carol", "wrong");
  assert.equal(bad.ok, false);
  assert.match(bad.err, /incorrect password/);
});

test("whoami requires login", () => {
  // Logout first to clear session.
  run("lib", "logout");
  const w = run("lib", "whoami");
  assert.equal(w.ok, false);
  assert.match(w.err, /not logged in/);
});

test("add and list personal todo", () => {
  run("lib", "register", "dan", "pw");
  run("lib", "login", "dan", "pw");
  const a = run("lib", "add", "buy milk");
  assert.equal(a.ok, true);
  const list = run("lib", "list");
  assert.equal(list.ok, true);
  const items = JSON.parse(list.result);
  assert.equal(items.length, 1);
  assert.equal(items[0].text, "buy milk");
  assert.equal(typeof items[0].owner_id, "string");
  assert.equal(items[0].done, false);
  assert.equal(items[0].team_id, "");
});

test("team create, join, ACL", () => {
  run("lib", "register", "eve", "pw");
  run("lib", "login", "eve", "pw");
  const team = run("lib", "team_create", "alpha");
  assert.equal(team.ok, true);
  const tid = team.result.id;

  // eve is owner, can add team todos
  const t1 = run("lib", "add", "team task", "--team", tid);
  assert.equal(t1.ok, true);

  // outsider cannot see the team todo
  run("lib", "logout");
  run("lib", "register", "frank", "pw");
  run("lib", "login", "frank", "pw");
  const before = run("lib", "list", "--team", tid);
  const beforeItems = JSON.parse(before.result);
  assert.equal(beforeItems.length, 0, "outsider sees no team todos");

  // after joining, frank sees the team todo
  const join = run("lib", "team_join", tid);
  assert.equal(join.ok, true);
  const after = run("lib", "list", "--team", tid);
  const afterItems = JSON.parse(after.result);
  assert.equal(afterItems.length, 1);
  assert.equal(afterItems[0].text, "team task");
});

test("share makes a personal todo visible", () => {
  run("lib", "register", "gina", "pw");
  run("lib", "login", "gina", "pw");
  const t = run("lib", "add", "private task");
  assert.equal(t.ok, true);

  // register a target user (still as gina is fine;
  // anyone can register; gina's session is preserved
  // for the share)
  run("lib", "logout");
  run("lib", "register", "harry", "pw");
  run("lib", "login", "harry", "pw");
  const harryId = run("lib", "whoami").result.id;

  // gina shares her todo with harry
  run("lib", "logout");
  run("lib", "login", "gina", "pw");
  const share = run("lib", "share", t.result.id, harryId);
  assert.equal(share.ok, true, `share: ${JSON.stringify(share)}`);

  // harry now sees the shared todo
  run("lib", "logout");
  run("lib", "login", "harry", "pw");
  const list = run("lib", "list");
  const items = JSON.parse(list.result);
  assert.equal(items.length, 1);
  assert.equal(items[0].text, "private task");
});

test("done and remove", () => {
  run("lib", "register", "irene", "pw");
  run("lib", "login", "irene", "pw");
  const t = run("lib", "add", "to be done");
  assert.equal(t.ok, true);

  const done = run("lib", "done", t.result.id);
  assert.equal(done.ok, true);

  const list1 = run("lib", "list");
  const items1 = JSON.parse(list1.result);
  assert.equal(items1.length, 1);
  assert.equal(items1[0].done, true);

  const remove = run("lib", "remove", t.result.id);
  assert.equal(remove.ok, true);

  const list2 = run("lib", "list");
  const items2 = JSON.parse(list2.result);
  assert.equal(items2.length, 0);
});

test("list --all bypasses ACL", () => {
  run("lib", "register", "jack", "pw");
  run("lib", "login", "jack", "pw");
  // jack creates a personal todo
  const a = run("lib", "add", "jack's private");
  assert.equal(a.ok, true);

  // login as another user
  run("lib", "logout");
  run("lib", "register", "kate", "pw");
  run("lib", "login", "kate", "pw");

  // without --all, kate sees nothing of jack's
  const noAll = run("lib", "list");
  const noAllItems = JSON.parse(noAll.result);
  // kate might have her own todos from prior tests
  // filtered by `list` (no --all), so the count
  // depends on the db state. We just check that
  // jack's text isn't in the result.
  const containsJack = noAllItems.some(
    (x: any) => x.text === "jack's private"
  );
  assert.equal(containsJack, false, "--all omitted: should not see jack's");

  // with --all, kate sees jack's
  const all = run("lib", "list", "--all");
  const allItems = JSON.parse(all.result);
  const containsJackAll = allItems.some(
    (x: any) => x.text === "jack's private"
  );
  assert.equal(containsJackAll, true, "--all: should see jack's");
});
