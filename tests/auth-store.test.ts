import { it, expect } from "vitest";
import { Store } from "../server/store";

it("persists, reads and updates application profiles using the users table columns", () => {
  const store = new Store(":memory:");
  try {
    const user = store.createUser({ supabaseUserId: "supabase-member", email: "member@example.com", name: "Member", role: "USER" });
    expect(store.findUserBySupabaseId(user.supabaseUserId)).toEqual(user);
    expect(store.findUserById(user.id)).toEqual(user);
    expect(store.listUsers()).toEqual([user]);
    const updated = store.setUserRole(user.id, "TEACHER");
    expect(updated.role).toBe("TEACHER");
    expect(store.findUserById(user.id)).toEqual(updated);
    expect(store.findUserById("missing")).toBeUndefined();
  } finally {
    store.db.close();
  }
});
