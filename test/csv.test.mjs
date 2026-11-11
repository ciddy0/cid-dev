import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCSV } from "../scripts/lib/csv.mjs";

test("parses rows into objects keyed by the header", () => {
  assert.deepEqual(parseCSV("a,b\n1,2\n3,4\n"), [{ a: "1", b: "2" }, { a: "3", b: "4" }]);
});

test("handles a BOM, CRLF, blank lines, quotes and a missing last newline", () => {
  const text = '﻿id,name\r\n1,"Pico, Aliso"\r\n\r\n2,"say ""hi"""\r\n3,"two\nlines"';
  assert.deepEqual(parseCSV(text), [
    { id: "1", name: "Pico, Aliso" },
    { id: "2", name: 'say "hi"' },
    { id: "3", name: "two\nlines" },
  ]);
});

test("short rows are padded, and nothing in gives nothing out", () => {
  assert.deepEqual(parseCSV("a,b,c\n1,2\n"), [{ a: "1", b: "2", c: "" }]);
  assert.deepEqual(parseCSV(""), []);
});
