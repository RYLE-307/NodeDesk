import { test } from "node:test";
import assert from "node:assert/strict";
import { decideTerminalPaste, MAX_TERMINAL_PASTE_BYTES } from "../src/terminalPaste.ts";

test("terminal paste allows ordinary single-line text and Unicode", () => {
  for (const value of ["", "ls -la", "Привет мир", "echo 'hello'\t# comment"]) {
    assert.equal(decideTerminalPaste(value), "allow");
  }
});

test("terminal paste requires consent before any newline or carriage return", () => {
  for (const value of ["pwd\nwhoami", "pwd\rwhoami", "\n", "first\r\nsecond"]) {
    assert.equal(decideTerminalPaste(value), "confirm");
  }
});

test("terminal paste rejects escape, NUL, DEL, C1 and bidi controls", () => {
  for (const value of ["\u001b[31m", "echo\u0000hi", "\u0007", "\u007f", "\u0085", "abc\u202e123", "\u2066whoami\u2069"]) {
    assert.equal(decideTerminalPaste(value), "reject-control");
  }
});

test("terminal paste enforces a UTF-8 byte limit without truncating text", () => {
  assert.equal(decideTerminalPaste("a".repeat(MAX_TERMINAL_PASTE_BYTES)), "allow");
  assert.equal(decideTerminalPaste("a".repeat(MAX_TERMINAL_PASTE_BYTES + 1)), "reject-size");
  assert.equal(decideTerminalPaste("🙂".repeat(5000)), "reject-size");
  assert.equal(decideTerminalPaste("🙂".repeat(100)), "allow");
});
