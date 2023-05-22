import { Splitable, createSplitable } from "async-iterable-split";
import { TYPES } from "./constants.js";

export type options = {
  // 限制一个 STREAM 类型的数据最多可以包含多少个字节，默认是 Infinity
  streamMaxSize?: number;
  // 限制一个 STRING 类型的数据最多可以包含多少个字节，默认是 Infinity，注意：这个限制的不是字符个数，而是 utf-8 编码后的字节数
  stringMaxSize?: number;
  // 限制一个 ARRAY 类型的数据最多可以包含多少个“元素”，默认是 Infinity
  arrayMaxLength?: number;
  // 限制一个 OBJECT 类型的数据最多可以包含多少个“键值对”，默认是 Infinity
  objectMaxLength?: number;
  // 限制数据最深可以到多少层，默认是 Infinity
  maxDepth?: number;
};

// 当解析到了 ARRAY 或 OBJECT 类型的数据时，如果不是空数组或空对象，parser 函数会被递归调用，
// 此时调用 parser 的 paths 参数就是要解析的数据的访问路径，我们在外部调用 parser 时不需要设置 paths 参数
// 以对象 {foo: {bar: 'baz'}} 为例，当我们解析 'baz' 这部分数据时，调用 parser 的 paths 参数就是 ['foo', 'bar']，
// 由于 'baz' 也是这个对象最深的一个数据，所以我们称数据 {foo: {bar: 'baz'}} 的深度为 2，如下所示：
// 深度 0 ---- {foo: {bar: 'baz'}}
//               /
// 深度 1 --- {bar: 'baz'}
//             /
// 深度 2 -- 'baz'
// 再比如 [[]]，它的深度就是 1，因为最深的数据就是内层的 [], 没有更深的数据了，但如果是 [[false]]，则深度为 2，因为 false 的访问路径是 [0, 0]
// 当解析的数据的路径长度（即深度）超出了 maxDepth，parser 函数会抛出错误。

export async function parser(splitable: Splitable | Uint8Array | Iterable<Uint8Array> | AsyncIterable<Uint8Array>, options: options = {}, paths: (string | number)[] = []): Promise<any> {
  const _options: Required<options> = {
    streamMaxSize: Infinity,
    stringMaxSize: Infinity,
    arrayMaxLength: Infinity,
    objectMaxLength: Infinity,
    maxDepth: Infinity,
    ...options,
  };

  if (paths.length > _options.maxDepth) {
    throw new Error(`Depth exceeded ${_options.maxDepth}`);
  }

  if (!(splitable instanceof Splitable)) {
    splitable = createSplitable(splitable);
  }

  const type = (await splitable.readEnoughSize(1))[0];

  if (type === TYPES.NULL) {
    return null;
  }
  if (type === TYPES.UNDEFINED) {
    return undefined;
  }
  if (type === TYPES.BOOLEAN) {
    const data = await splitable.readEnoughSize(1);
    if (data[0] === 0) {
      return false;
    }
    if (data[0] === 1) {
      return true;
    }
    throw new Error("Invalid data");
  }
  if (type === TYPES.NUMBER) {
    const data = await splitable.readEnoughSize(8);
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    return dv.getFloat64(0, false);
  }
  // 这里会把 STREAM 类型的数据全部读取到内存中，所以有可能导致内存泄漏，如果是文件上传等数据较大的场景，建议结合业务改写这部分或设置一个合理的 streamMaxSize 参数
  if (type === TYPES.STREAM) {
    return splitable.readChunkedStream(_options.streamMaxSize);
  }
  if (type === TYPES.STRING) {
    let result: string = "";
    let size: number = 0;
    const subIterable = splitable.splitChunkedStream();
    const decoder = new TextDecoder("utf-8");
    for await (const chunk of subIterable) {
      if ((size += chunk.length) > _options.stringMaxSize) {
        throw new Error(`String size exceeded ${_options.stringMaxSize} bytes`);
      }
      result += decoder.decode(chunk, { stream: true });
    }
    return result;
  }
  if (type === TYPES.ARRAY) {
    let result: any[] = [];
    const subIterable = splitable.splitChunkedStream();
    const subSplitable = new Splitable(subIterable);
    while (await subSplitable.hasValue) {
      if (result.length >= _options.arrayMaxLength) {
        throw new Error(`Array length exceeded ${_options.arrayMaxLength}`);
      }
      const element = await parser(subSplitable, _options, [...paths, result.length]);
      result.push(element);
    }
    return result;
  }
  if (type === TYPES.OBJECT) {
    let result: { [key: string]: any } = {};
    let length: number = 0;
    const subIterable = splitable.splitChunkedStream();
    const subSplitable = new Splitable(subIterable);
    while (await subSplitable.hasValue) {
      if (length >= _options?.objectMaxLength) {
        throw new Error(`Object key value pairs count exceeded ${_options?.objectMaxLength}`);
      }
      if ((await subSplitable.readEnoughSize(1))[0] !== TYPES.STRING) {
        throw new Error("Invalid key");
      }
      const key = new TextDecoder("utf-8").decode(await subSplitable.readChunkedStream(_options.stringMaxSize));
      const value = await parser(subSplitable, _options, [...paths, key]);
      result[key] = value;
    }
    return result;
  }

  throw new Error("Invalid type");
}
