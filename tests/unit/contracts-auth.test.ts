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
    // The sanity limit counts characters, as the password schema does.
    expect(signIn({ username: "abc", password: "😀".repeat(256) })).toBe(true);
    expect(signIn({ username: "abc", password: "😀".repeat(257) })).toBe(false);
  });

  it("never changes the password it is given", () => {
    for (const p of [
      "  Pass Word  ",
      "MiXeD Case\t",
      " lead",
      "trail ",
      "ｐａｓｓ", // full-width: a normalising schema would turn it into ASCII
      "cafe\u0301", // decomposed accent: NFC or NFKC would compose it
      "nul\u0000inside",
      "esc\u001binside",
    ]) {
      expect(
        signInSchema.parse({ username: "abc", password: p }).password,
      ).toBe(p);
    }
  });

  it("accepts a password with format characters, which a username may not have", () => {
    // Only the username and the reset identifier refuse them. A family emoji
    // holds zero-width joiners and a Persian word holds a zero-width non-joiner;
    // both are ordinary passwords, and sign-up accepts them too.
    for (const p of [
      "👨\u200d👩\u200d👧\u200d👦pass-word",
      "می\u200cخواهم-ورود",
      "\u200dlead-joiner",
    ]) {
      expect(signIn({ username: "abc", password: p }), p).toBe(true);
      expect(
        signInSchema.parse({ username: "abc", password: p }).password,
      ).toBe(p);
    }
    expect(password("👨\u200d👩\u200d👧\u200d👦pass-word")).toBe(true);
  });

  it("drops keys it does not know, because Auth.js sends them", () => {
    const parsed = signInSchema.parse({
      username: "Kirby",
      password: "secret-ish",
      callbackUrl: "http://localhost:3000/account",
      csrfToken: "abc",
    });
    expect(parsed).toEqual({ username: "kirby", password: "secret-ish" });
  });

  it("refuses a username that cannot exist, whatever its look", () => {
    for (const bad of [
      "a\u0000b",
      "a\u001bb",
      "a\nb",
      "a\u202eb",
      "a\u200bb",
      "a\u2028b",
      "a\u2029b",
      "a\ud800b",
      "a\udc00b",
      "a\udc00\ud800b",
    ]) {
      expect(
        signIn({ username: bad, password: "x" }),
        JSON.stringify(bad),
      ).toBe(false);
    }
  });

  it("refuses a lone surrogate in a password, as sign-up does", () => {
    expect(signIn({ username: "abc", password: "abc\ud800" })).toBe(false);
    expect(signIn({ username: "abc", password: "abc\udc00" })).toBe(false);
    expect(signIn({ username: "abc", password: "abc\udc00\ud800" })).toBe(
      false,
    );
    expect(signIn({ username: "abc", password: "abc😀" })).toBe(true);
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

  it("counts the 254 characters after the trim", () => {
    const edge = `  ${"a".repeat(254)}  `;
    expect(resetRequestSchema.safeParse({ identifier: edge }).success).toBe(
      true,
    );
  });

  it("accepts what a person really types, in any script", () => {
    for (const ok of ["kirby", "Kirby.Liu@Example.com", "josé@exämple.de"]) {
      expect(resetRequestSchema.safeParse({ identifier: ok }).success, ok).toBe(
        true,
      );
    }
  });

  it("refuses control, format and separator characters and lone surrogates", () => {
    // A NUL cannot be stored in a Postgres text column; the others would let
    // a stranger put an escape sequence or a forged line on the operator's
    // terminal when the requests are listed.
    for (const bad of [
      "a\u0000b",
      "\u001b[2J\u001b[Hfake",
      "line1\nforged-id 2026 matched=yes",
      "line1\rforged",
      "tab\there",
      "a\u202eb",
      "a\u200bb",
      "a\u2028b",
      "a\u2029b",
      "x\ud800y",
      "\u0000",
    ]) {
      expect(
        resetRequestSchema.safeParse({ identifier: bad }).success,
        JSON.stringify(bad),
      ).toBe(false);
    }
  });
});

describe("no schema message carries what was typed", () => {
  // The contract says a handler maps issues to its own fixed strings, and the
  // schemas' own messages are static. Zod's message for an unknown KEY repeats
  // the key, which is why a handler never returns those messages as they are.
  const SENTINEL = "SENTINEL-8f3a";
  const bad: Array<[string, { safeParse: (v: unknown) => unknown }, unknown]> =
    [
      ["username", usernameSchema, `${SENTINEL}!`],
      ["reserved username", usernameSchema, "ADMIN"],
      ["short password", passwordSchema, SENTINEL.slice(0, 8)],
      [
        "sign-up email",
        signUpSchema,
        {
          username: "sentinel-user1",
          password: "sentinel-user1",
          email: SENTINEL,
        },
      ],
      [
        "sign-in username",
        signInSchema,
        { username: `${SENTINEL}\u0000`, password: "x" },
      ],
      [
        "sign-in password",
        signInSchema,
        { username: "abc", password: `${SENTINEL}\ud800` },
      ],
      [
        "reset identifier",
        resetRequestSchema,
        { identifier: `${SENTINEL}\u0000` },
      ],
      [
        "reset token",
        resetCompleteSchema,
        { token: SENTINEL, password: "a new password!" },
      ],
      [
        "reset password",
        resetCompleteSchema,
        { token: TOKEN, password: SENTINEL.slice(0, 8) },
      ],
    ];

  it.each([
    [
      "sign-up",
      signUpSchema,
      { username: "abc", password: "a long enough pass", [SENTINEL]: 1 },
    ],
    ["reset request", resetRequestSchema, { identifier: "abc", [SENTINEL]: 1 }],
    [
      "reset complete",
      resetCompleteSchema,
      { token: TOKEN, password: "a new password!", [SENTINEL]: 1 },
    ],
  ])("an unknown key gets a fixed message (%s)", (_name, schema, input) => {
    const r = schema.safeParse(input);
    expect(r.success).toBe(false);
    const messages = (r.error?.issues ?? []).map((i) => i.message);
    // Zod's own message would repeat the key, which is the caller's text.
    expect(messages).toEqual(["unexpected field"]);
  });

  it("a reserved username is not repeated back", () => {
    const r = usernameSchema.safeParse("ADMIN");
    expect(r.success).toBe(false);
    const text = JSON.stringify(r.error?.issues ?? []).toLowerCase();
    expect(text).not.toContain("admin");
  });

  it.each(bad)("%s", (_name, schema, input) => {
    const result = schema.safeParse(input) as {
      success: boolean;
      error?: { issues: unknown[] };
    };
    expect(result.success).toBe(false);
    const text = JSON.stringify(result.error?.issues ?? []);
    expect(text).not.toContain(SENTINEL);
    expect(text.toLowerCase()).not.toContain("sentinel");
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

  it("refuses keys it does not know", () => {
    const r = resetCompleteSchema.safeParse({ ...good, role: "admin" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.map((i) => i.code)).toEqual(["unrecognized_keys"]);
    }
  });
});
