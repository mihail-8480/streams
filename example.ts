import { blockFromAsyncIterable } from "./lib";

const incrementStream = blockFromAsyncIterable<number>(
  (async function* () {
    let i = 0;
    while (true) {
      yield i++;
    }
  })()
);

function take<T>(
  items: number
): (source: AsyncIterable<T>) => AsyncIterable<T> {
  return async function* (source: AsyncIterable<T>) {
    for await (const item of source) {
      if (items-- === 0) {
        break;
      }
      yield item;
    }
  };
}

const oddStream = incrementStream.map((num) => num * 2 + 1);
oddStream.pipe(take(10)).sync().then(console.log);
