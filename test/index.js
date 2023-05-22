import { parser, generator } from "octet-sdn";
import { createReadStream, readFileSync } from "node:fs";

const testCases = [
  {
    data: null,
    check(parsed) {
      return parsed === null;
    },
  },
  {
    data: undefined,
    check(parsed) {
      return parsed === undefined;
    },
  },
  {
    data: false,
    check(parsed) {
      return parsed === false;
    },
  },
  {
    data: true,
    check(parsed) {
      return parsed === true;
    },
  },
  {
    data: new Boolean(false),
    check(parsed) {
      return parsed === false;
    },
  },
  {
    data: new Boolean(true),
    check(parsed) {
      return parsed === true;
    },
  },
  {
    data: 0,
    check(parsed) {
      return parsed === 0;
    },
  },
  {
    data: -0,
    check(parsed) {
      return parsed === -0;
    },
  },
  {
    data: NaN,
    check(parsed) {
      return isNaN(parsed);
    },
  },
  {
    data: Infinity,
    check(parsed) {
      return parsed === Infinity;
    },
  },
  {
    data: -Infinity,
    check(parsed) {
      return parsed === -Infinity;
    },
  },
  {
    data: Number.MAX_SAFE_INTEGER,
    check(parsed) {
      return parsed === Number.MAX_SAFE_INTEGER;
    },
  },
  {
    data: Number.MAX_VALUE,
    check(parsed) {
      return parsed === Number.MAX_VALUE;
    },
  },
  {
    data: Number.MIN_SAFE_INTEGER,
    check(parsed) {
      return parsed === Number.MIN_SAFE_INTEGER;
    },
  },
  {
    data: Number.MIN_VALUE,
    check(parsed) {
      return parsed === Number.MIN_VALUE;
    },
  },
  {
    data: Math.PI,
    check(parsed) {
      return parsed === Math.PI;
    },
  },
  {
    data: Math.E,
    check(parsed) {
      return parsed === Math.E;
    },
  },
  {
    data: new Number(0.1),
    check(parsed) {
      return parsed === 0.1;
    },
  },
  {
    data: "abc中文😊",
    check(parsed) {
      return parsed === "abc中文😊";
    },
  },
  {
    data: new String("abc中文😊"),
    check(parsed) {
      return parsed === "abc中文😊";
    },
  },
  {
    data: Uint8Array.from([1, 2, 3]),
    check(parsed) {
      return Uint8Array.from([1, 2, 3]).every((v, i) => v === parsed[i]);
    },
  },
  {
    data: createReadStream(new URL(import.meta.url)),
    check(parsed) {
      return readFileSync(new URL(import.meta.url)).every((v, i) => v === parsed[i]);
    },
  },
  {
    data: ["foo", "bar", "baz"],
    check(parsed) {
      return ["foo", "bar", "baz"].every((v, i) => v === parsed[i]);
    },
  },
  {
    data: { foo: { bar: "baz" } },
    check(parsed) {
      return JSON.stringify(parsed) === JSON.stringify({ foo: { bar: "baz" } });
    },
  },
];

for (const testCase of testCases) {
  if (!testCase.check(await parser(await generator(testCase.data)))) {
    console.log(testCase.data);
    throw new Error("test case fail");
  }
}
