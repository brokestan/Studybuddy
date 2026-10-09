import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeNamespaces } from "@/lib/namespaceStats";
import { privateNamespace, roomNamespace } from "@/lib/identity";

test("summarizeNamespaces: counts private profiles (sb-u-*), study rooms (sb-r-*) and everything else separately", () => {
  const s = summarizeNamespaces([
    { name: privateNamespace("sam-secret-code-1111"), memory_count: 5 },
    { name: privateNamespace("alex-secret-code-2222"), memory_count: 2 },
    { name: roomNamespace("room-abcd-efgh"), memory_count: 7 },
    { name: "studybuddy-default", memory_count: 1 },
  ]);
  assert.deepEqual(s, { privateProfiles: 2, studyRooms: 1, other: 1, privateMemories: 7, roomMemories: 7 });
});

test("summarizeNamespaces: a namespace with nothing stored is not 'used'", () => {
  const s = summarizeNamespaces([
    { name: "sb-u-abc", memory_count: 0 },
    { name: "sb-r-room-x", memory_count: 0 },
    { name: "sb-u-def", memory_count: 3 },
  ]);
  assert.equal(s.privateProfiles, 1);
  assert.equal(s.studyRooms, 0);
});

test("summarizeNamespaces: a namespace repeated across listing pages is counted once", () => {
  const s = summarizeNamespaces([
    { name: "sb-u-abc", memory_count: 3 },
    { name: "sb-u-abc", memory_count: 3 },
  ]);
  assert.equal(s.privateProfiles, 1);
  assert.equal(s.privateMemories, 3);
});

test("summarizeNamespaces: empty and malformed input never throws", () => {
  assert.deepEqual(summarizeNamespaces([]), { privateProfiles: 0, studyRooms: 0, other: 0, privateMemories: 0, roomMemories: 0 });
  const s = summarizeNamespaces([{ name: "sb-u-x", memory_count: Number.NaN }, { name: "sb-u-y", memory_count: 2 }]);
  assert.equal(s.privateProfiles, 1);
});

test("PRIVACY: the summary contains only numbers — no namespace name, memory key or room code can leak through it", () => {
  const key = "sam-secret-code-1111";
  const room = "room-abcd-efgh";
  const s = summarizeNamespaces([
    { name: privateNamespace(key), memory_count: 4 },
    { name: roomNamespace(room), memory_count: 4 },
  ]);
  assert.ok(Object.values(s).every((v) => typeof v === "number"));
  const dump = JSON.stringify(s);
  for (const secret of [key, room, privateNamespace(key), "sb-u-", "sb-r-"]) assert.ok(!dump.includes(secret), `leaked ${secret}`);
  // and the private namespace is a one-way hash: it does not contain the key it was derived from
  assert.ok(!privateNamespace(key).includes(key));
});
