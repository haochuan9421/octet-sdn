import { concat, asyncConcat } from "async-iterable-split";
import { TYPES } from "./constants.js";

// 用于定长的数据
class CommonIterator implements AsyncIterator<Uint8Array, undefined> {
  done: boolean = false;
  prefix?: Uint8Array;
  source: Iterator<Uint8Array, undefined> | AsyncIterator<Uint8Array, undefined>;

  constructor(type: TYPES, source: Iterable<Uint8Array> | AsyncIterable<Uint8Array>) {
    this.prefix = new Uint8Array([type]);
    this.source = Symbol.asyncIterator in source ? source[Symbol.asyncIterator]() : source[Symbol.iterator]();
  }

  async next(): Promise<IteratorResult<Uint8Array, undefined>> {
    if (this.done) {
      return { done: true, value: undefined };
    }

    let item: IteratorResult<Uint8Array, undefined>;
    if (this.prefix !== undefined) {
      item = { done: false, value: this.prefix };
      this.prefix = undefined;
      return item;
    }

    item = await this.source.next();

    if (item.done) {
      this.done = true;
      return { done: true, value: undefined };
    }

    if (!(item.value instanceof Uint8Array)) {
      throw new Error("Invalid data");
    }
    return item;
  }

  async return(): Promise<IteratorResult<Uint8Array, undefined>> {
    this.done = true;
    if (this.source.return) {
      return this.source.return();
    }
    return { done: true, value: undefined };
  }

  async throw(error?: any): Promise<IteratorResult<Uint8Array, undefined>> {
    this.done = true;
    if (this.source.throw) {
      return this.source.throw(error);
    }
    return Promise.reject(error);
  }
}

// 用于不定长的数据
class StreamIterator implements AsyncIterator<Uint8Array, undefined> {
  done: boolean = false;
  prefix?: Uint8Array;
  source: Iterator<Uint8Array, undefined> | AsyncIterator<Uint8Array, undefined>;

  // 从数据源获取的数据会先暂存在 chunkData 数组中，而不是立即排出
  // 当暂存的数据达到 65536 字节或原始迭代器结束时，才会创建一个区块并排出
  // 如果数据源提供的某块数据过大，可能无法塞入一个区块中（一个区块最多只能包含 4294967295 字节的数据），就会把剩余部分暂存在 remain 中
  chunkData: Uint8Array[] = [];
  chunkSize: number = 0;
  remain?: Uint8Array;

  constructor(type: TYPES, source: Iterable<Uint8Array> | AsyncIterable<Uint8Array>) {
    this.prefix = new Uint8Array([type]);
    this.source = Symbol.asyncIterator in source ? source[Symbol.asyncIterator]() : source[Symbol.iterator]();
  }

  async next(): Promise<IteratorResult<Uint8Array, undefined>> {
    if (this.done) {
      return { done: true, value: undefined };
    }

    let item: IteratorResult<Uint8Array, undefined>;
    if (this.prefix !== undefined) {
      item = { done: false, value: this.prefix };
      this.prefix = undefined;
      return item;
    }

    if (this.chunkSize >= 65536) {
      return { done: false, value: this.flushChunk(false) };
    }

    if (this.remain?.length) {
      item = { done: false, value: this.remain };
      this.remain = undefined;
    } else {
      item = await this.source.next();
    }

    if (item.done) {
      this.done = true;
      return { done: false, value: this.flushChunk(true) };
    }

    if (!(item.value instanceof Uint8Array)) {
      throw new Error("Invalid data");
    }

    // 保证 this.chunkSize 不大于 4294967295
    const space = 4294967295 - this.chunkSize;
    if (space >= item.value.length) {
      this.chunkData.push(item.value);
      this.chunkSize += item.value.length;
    } else {
      this.chunkData.push(item.value.subarray(0, space));
      this.chunkSize = 4294967295;
      this.remain = item.value.subarray(space);
    }

    return this.next();
  }

  async return(): Promise<IteratorResult<Uint8Array, undefined>> {
    this.done = true;
    if (this.source.return) {
      return this.source.return();
    }
    return { done: true, value: undefined };
  }

  async throw(error?: any): Promise<IteratorResult<Uint8Array, undefined>> {
    this.done = true;
    if (this.source.throw) {
      return this.source.throw(error);
    }
    return Promise.reject(error);
  }

  flushChunk(done: boolean): Uint8Array {
    // 每个区块的前 4 个字节固定用于声明该区块实际所含数据的大小
    const dv = new DataView(new ArrayBuffer(4));
    dv.setUint32(0, this.chunkSize, false);
    this.chunkData.unshift(new Uint8Array(dv.buffer));
    // 如果是最后一个区块，尾部还需要补上一个大小为 0 的终止区块
    if (this.chunkSize !== 0 && done) {
      this.chunkData.push(new Uint8Array([0, 0, 0, 0]));
    }

    const chunk = concat(this.chunkData);
    this.chunkData = [];
    this.chunkSize = 0;
    return chunk;
  }
}

function hasCircular(value: any, refs = new WeakSet()): boolean {
  if (refs.has(value)) {
    return true;
  }
  if (value !== null && typeof value === "object") {
    refs.add(value);
    for (const key in value) {
      if (hasCircular(value[key], refs)) {
        return true;
      }
    }
    refs.delete(value);
  }
  return false;
}

export function generator(value: any): AsyncIterable<Uint8Array> {
  if (value === null) {
    return {
      [Symbol.asyncIterator]() {
        return new CommonIterator(TYPES.NULL, []);
      },
    };
  }
  if (value === undefined) {
    return {
      [Symbol.asyncIterator]() {
        return new CommonIterator(TYPES.UNDEFINED, []);
      },
    };
  }
  if (typeof value === "boolean" || value instanceof Boolean) {
    return {
      [Symbol.asyncIterator]() {
        return new CommonIterator(TYPES.BOOLEAN, [new Uint8Array([+value])]);
      },
    };
  }
  if (typeof value === "number" || value instanceof Number) {
    return {
      [Symbol.asyncIterator]() {
        const dv = new DataView(new ArrayBuffer(8));
        dv.setFloat64(0, +value, false);
        return new CommonIterator(TYPES.NUMBER, [new Uint8Array(dv.buffer)]);
      },
    };
  }
  if (typeof value === "string" || value instanceof String) {
    return {
      [Symbol.asyncIterator]() {
        return new StreamIterator(TYPES.STRING, [new TextEncoder().encode("" + value)]);
      },
    };
  }
  // Node.js 中的 Buffer 是 Uint8Array 的子类，“可读流”是异步可迭代对象（v10.0.0+）
  // 不过要注意的是，异步可迭代对象迭代出的数据也不一定都是 Uint8Array，如果不是，则会在迭代时抛出错误
  if (value instanceof Uint8Array || Symbol.asyncIterator in value) {
    return {
      [Symbol.asyncIterator]() {
        return new StreamIterator(TYPES.STREAM, value instanceof Uint8Array ? [value] : value);
      },
    };
  }
  if (Object.prototype.toString.call(value) === "[object Array]") {
    return {
      [Symbol.asyncIterator]() {
        if (hasCircular(value)) {
          throw new Error("Circular reference!");
        }
        return new StreamIterator(TYPES.ARRAY, multiGenerator(value));
      },
    };
  }
  if (Object.prototype.toString.call(value) === "[object Object]") {
    return {
      [Symbol.asyncIterator]() {
        if (hasCircular(value)) {
          throw new Error("Circular reference!");
        }
        const flatted: any[] = [];
        for (const key in value) {
          flatted.push(key);
          flatted.push(value[key]);
        }
        return new StreamIterator(TYPES.OBJECT, multiGenerator(flatted));
      },
    };
  }
  throw new Error("Invalid data");
}

export function multiGenerator(values: any[]): AsyncIterable<Uint8Array> {
  return {
    [Symbol.asyncIterator]() {
      let index = 0;
      let iterator: Iterator<Uint8Array, undefined> | AsyncIterator<Uint8Array, undefined> | undefined;

      return {
        async next(): Promise<IteratorResult<Uint8Array, undefined>> {
          if (index === values.length) {
            return { done: true, value: undefined };
          }

          if (iterator === undefined) {
            iterator = generator(values[index])[Symbol.asyncIterator]();
          }

          const item = await iterator.next();
          if (!item.done) {
            return item;
          }

          index++;
          iterator = undefined;
          return this.next();
        },
        async return(): Promise<IteratorResult<Uint8Array, undefined>> {
          index = values.length;
          if (iterator?.return) {
            return iterator?.return();
          }
          return { done: true, value: undefined };
        },
        async throw(error?: any): Promise<IteratorResult<Uint8Array, undefined>> {
          index = values.length;
          if (iterator?.throw) {
            return iterator?.throw(error);
          }
          return Promise.reject(error);
        },
      };
    },
  };
}

export function easyGenerator(value: any, maxSize: number): Promise<Uint8Array> {
  return asyncConcat(generator(value), maxSize);
}

export function easyMultiGenerator(values: any[], maxSize: number): Promise<Uint8Array> {
  return asyncConcat(multiGenerator(values), maxSize);
}
