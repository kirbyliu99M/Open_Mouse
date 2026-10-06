import { describe, expect, it } from "vitest";
import {
  ACCOUNT_RESET_PATH,
  EMAIL_MAX_CHARS,
  PASSWORD_MAX_CHARS,
  PASSWORD_MIN_CHARS,
  RESERVED_USERNAMES,
  RESET_TOKEN_BYTES,
  USERNAME_MAX_CHARS,
  USERNAME_MIN_CHARS,
  passwordEqualsUsername,
  passwordSchema,
  resetCompleteSchema,
  resetRequestSchema,
  signInSchema,
  signUpSchema,
  usernameSchema,
} from "../../src/lib/contracts/auth";

const TOKEN = "A".repeat(43);
const accepts =
  (schema: { safeParse: (v: unknown) => { success: boolean } }) =>
  (v: unknown) =>
    schema.safeParse(v).success;
const username = accepts(usernameSchema);
const password = accepts(passwordSchema);
const signUp = accepts(signUpSchema);
const signIn = accepts(signInSchema);

describe("pinned numbers", () => {
  // Literal on purpose: a test built from the constant passes for any value.
  it("keeps the values Kirby approved on 2026-10-04", () => {
    expect(USERNAME_MIN_CHARS).toBe(3);
    expect(USERNAME_MAX_CHARS).toBe(32);
    expect(PASSWORD_MIN_CHARS).toBe(10);
    expect(PASSWORD_MAX_CHARS).toBe(128);
    expect(EMAIL_MAX_CHARS).toBe(254);
    expect(RESET_TOKEN_BYTES).toBe(32);
    expect(ACCOUNT_RESET_PATH).toBe("/account/reset");
  });

  it("pins the reserved list literally", () => {
    expect([...RESERVED_USERNAMES]).toEqual([
      "admin",
      "administrator",
      "root",
      "system",
      "support",
      "help",
      "security",
      "staff",
      "moderator",
      "owner",
      "official",
      "openmouse",
      "open_mouse",
      "anonymous",
      "null",
      "undefined",
    ]);
  });
});

describe("usernameSchema", () => {
  it("stores the lower-cased, trimmed name", () => {
    expect(usernameSchema.parse("  Kirby.Liu_99  ")).toBe("kirby.liu_99");
  });

  it("accepts the length edges and the whole character set", () => {
    expect(username("abc")).toBe(true);
    expect(username("a".repeat(32))).toBe(true);
    expect(username("a-b_c.d-0")).toBe(true);
    expect(username("-._")).toBe(true); // candidate: no rule on leading marks
  });

  it("refuses what is outside the limits", () => {
    expect(username("ab")).toBe(false);
    expect(username("a".repeat(33))).toBe(false);
    expect(username("")).toBe(false);
    expect(username("   ")).toBe(false);
    for (const bad of [
      "has space",
      "a@b",
      "名字名字",
      "tab\there",
      "new\nline",
      "ａｂｃｄ", // full-width letters lower-case to themselves, not to a-z
      "ab/cd",
    ]) {
      expect(username(bad), bad).toBe(false);
    }
  });

  it("refuses every reserved name, in any case", () => {
    for (const name of RESERVED_USERNAMES) {
      expect(username(name), name).toBe(false);
      expect(username(name.toUpperCase()), name).toBe(false);
      expect(username(` ${name} `), name).toBe(false);
    }
    expect(username("admin2")).toBe(true);
  });

  it("refuses a non-string", () => {
    for (const bad of [undefined, null, 12345, {}, ["abc"]]) {
      expect(username(bad)).toBe(false);
    }
  });
});

describe("passwordSchema", () => {
  it("accepts 10 and 128 characters, refuses 9 and 129", () => {
    expect(password("a".repeat(10))).toBe(true);
    expect(password("a".repeat(128))).toBe(true);
    expect(password("a".repeat(9))).toBe(false);
    expect(password("a".repeat(129))).toBe(false);
    expect(password("")).toBe(false);
  });

  it("counts characters, not UTF-16 units", () => {
    expect(password("😀".repeat(10))).toBe(true); // 10 characters, 20 units
    expect(password("😀".repeat(5))).toBe(false); // 5 characters, 10 units
    expect(password("😀".repeat(128))).toBe(true);
    expect(password("😀".repeat(129))).toBe(false);
  });

  it("has no composition rules and does not trim", () => {
    expect(password("aaaaaaaaaa")).toBe(true);
    expect(password("1234567890")).toBe(true);
    expect(password("          ")).toBe(true); // ten spaces are ten characters
    expect(passwordSchema.parse("  pass word  ")).toBe("  pass word  ");
  });

  it("refuses unpaired surrogates", () => {
    expect(password("abcdefghi\ud800")).toBe(false);
    expect(password("abcdefghi\udc00")).toBe(false);
    expect(password("abcdefghi😀")).toBe(true); // a real pair
  });
});

describe("signUpSchema", () => {
  const base = { username: "Kirby", password: "correct horse battery" };

  it("parses to the stored values", () => {
    expect(signUpSchema.parse(base)).toEqual({
      username: "kirby",
      password: "correct horse battery",
      email: undefined,
    });
    expect(
      signUpSchema.parse({ ...base, email: "  Kirby@Example.COM " }).email,
    ).toBe("kirby@example.com");
  });

  it("treats an empty email as none and a bad one as an error", () => {
    expect(signUp({ ...base, email: "" })).toBe(true);
    expect(signUp({ ...base, email: "   " })).toBe(true);
    expect(signUp({ ...base, email: undefined })).toBe(true);
    for (const bad of ["not-an-email", "a@", "@b.co", "a b@c.de", 5, null]) {
      expect(signUp({ ...base, email: bad }), String(bad)).toBe(false);
    }
  });

  it("limits the email to 254 characters", () => {
    const local = "a".repeat(64);
    const domain = `${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(57)}.com`;
    const at254 = `${local}@${domain}`;
    expect(at254.length).toBe(254);
    expect(signUp({ ...base, email: at254 })).toBe(true);
    expect(signUp({ ...base, email: `x${at254}` })).toBe(false);
  });

  it("refuses a password equal to the username, case aside", () => {
    expect(signUp({ username: "kirbyliu99", password: "kirbyliu99" })).toBe(
      false,
    );
    expect(signUp({ username: "KirbyLiu99", password: "kirbyliu99" })).toBe(
      false,
    );
    expect(signUp({ username: "kirbyliu99", password: " KIRBYLIU99 " })).toBe(
      false,
    );
    expect(signUp({ username: "kirbyliu99", password: "kirbyliu99!" })).toBe(
      true,
    );
    const r = signUpSchema.safeParse({
      username: "kirbyliu99",
      password: "kirbyliu99",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.map((i) => i.path.join("."))).toEqual(["password"]);
    }
  });

  it("refuses fields it does not know and missing ones", () => {
    expect(signUp({ ...base, role: "admin" })).toBe(false);
    expect(signUp({ username: "kirby" })).toBe(false);
    expect(signUp({ password: "correct horse battery" })).toBe(false);
  });
});

describe("passwordEqualsUsername", () => {
  it("compares after normalising both, for the reset step", () => {
    expect(passwordEqualsUsername("Kirby.L", "kirby.l")).toBe(true);
    expect(passwordEqualsUsername("kirby.l", " KIRBY.L ")).toBe(true);
    expect(passwordEqualsUsername("kirby.l", "kirby.l1")).toBe(false);
  });
});

describe("signInSchema", () => {
  it("normalises the username like sign-up does", () => {
    expect(
      signInSchema.parse({ username: " Kirby ", password: "x" }).username,
    ).toBe("kirby");
  });

  it("does not judge a username's shape or a password's strength", () => {
    expect(signIn({ username: "a", password: "x" })).toBe(true);
    expect(signIn({ username: "has space", password: "short" })).toBe(true);
    expect(signIn({ username: "admin", password: "x" })).toBe(true);
  });

  it("still stops an oversized body before it reaches the hash", () => {
    expect(signIn({ username: "a".repeat(33), password: "x" })).toBe(false);
    expect(signIn({ username: "abc", password: "x".repeat(256) })).toBe(true);
    expect(signIn({ username: "abc", password: "x".repeat(257) })).toBe(false);
    expect(signIn({ username: "", password: "x" })).toBe(false);
    expect(signIn({ username: "abc", password: "" })).toBe(false);
  });

  it("accepts a 128-character password written in emoji", () => {
    expect(signIn({ username: "abc", password: "😀".repeat(128) })).toBe(true);
  });
});

describe("resetRequestSchema", () => {
  it("keeps what was typed, trimmed, up to 254 characters", () => {
    expect(resetRequestSchema.parse({ identifier: "  Kirby@Ex.com " })).toEqual(
      { identifier: "Kirby@Ex.com" },
    );
    expect(
      resetRequestSchema.safeParse({ identifier: "a".repeat(254) }).success,
    ).toBe(true);
    expect(
      resetRequestSchema.safeParse({ identifier: "a".repeat(255) }).success,
    ).toBe(false);
    expect(resetRequestSchema.safeParse({ identifier: "  " }).success).toBe(
      false,
    );
    expect(
      resetRequestSchema.safeParse({ identifier: "x", extra: 1 }).success,
    ).toBe(false);
  });
});

describe("resetCompleteSchema", () => {
  const good = { token: TOKEN, password: "a new password!" };

  it("accepts a base64url token of at least 43 characters", () => {
    expect(resetCompleteSchema.safeParse(good).success).toBe(true);
    expect(
      resetCompleteSchema.safeParse({ ...good, token: "A_-".repeat(20) })
        .success,
    ).toBe(true);
    expect(
      resetCompleteSchema.safeParse({ ...good, token: "A".repeat(128) })
        .success,
    ).toBe(true);
  });

  it("refuses a short, long or non-base64url token", () => {
    for (const token of [
      "A".repeat(42),
      "A".repeat(129),
      `${"A".repeat(42)}=`,
      `${"A".repeat(42)} `,
      `${"A".repeat(42)}+`,
      "",
    ]) {
      expect(
        resetCompleteSchema.safeParse({ ...good, token }).success,
        token,
      ).toBe(false);
    }
  });

  it("applies the password rules", () => {
    expect(
      resetCompleteSchema.safeParse({ ...good, password: "short" }).success,
    ).toBe(false);
    expect(resetCompleteSchema.safeParse({ token: TOKEN }).success).toBe(false);
  });
});
