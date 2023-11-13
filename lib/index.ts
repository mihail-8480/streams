export type Subscriber<T> = (arr: T | undefined) => void;
export interface ISubject<T> {
  subscribe(sub: Subscriber<T>): void;
  unsubscribe(sub: Subscriber<T>): void;
}

export function createSubscriber<T>({
  end,
  data,
}: {
  end: () => void;
  data: (item: T) => void;
}): Subscriber<T> {
  return (item) => {
    if (!item) {
      return end();
    }
    return data(item);
  };
}

interface IBaseBlock<T> {
  block(): Promise<boolean>;
  get current(): T | undefined;
}

export type ISync<T> = {
  sync: () => Promise<T>;
};

async function* iteratorFromBaseBlock<T>(ref: IBaseBlock<T>): AsyncIterable<T> {
  while (await ref.block()) {
    if (ref.current !== undefined) {
      yield ref.current;
    }
  }
}

function pipeBase<T, TResult>(
  block: IBaseBlock<T>,
  map: (input: AsyncIterable<T>) => AsyncIterable<TResult>
): IBaseBlock<TResult> {
  return iterableToBaseBlock(map(iteratorFromBaseBlock(block)));
}

function iterableToBaseBlock<T>(iterable: AsyncIterable<T>): IBaseBlock<T> {
  const iterator = iterable[Symbol.asyncIterator]();
  let current: T | undefined = undefined;
  return {
    async block() {
      const { value, done } = await iterator.next();
      current = value;
      return !done;
    },
    get current() {
      return current;
    },
  };
}

function subjectToBaseBlock<T>(subject: ISubject<T>): IBaseBlock<T> {
  let current: T | undefined = undefined;
  return {
    block() {
      return new Promise((resolve) => {
        subject.subscribe(function handler(data) {
          subject.unsubscribe(handler);
          current = data;
          resolve(data !== undefined);
        });
      });
    },
    get current() {
      return current;
    },
  };
}

type IPipeIterable<T> = <TResult>(
  map: (input: AsyncIterable<T>) => AsyncIterable<TResult>
) => IBlock<TResult>;

type IPipeSubscriber<T> = (subscriber: Subscriber<T>) => ISync<void>;

export interface IBlock<T> extends ISync<Iterable<T>> {
  pipe: IPipeIterable<T>;
  copyTo: IPipeSubscriber<T>;
  async(): AsyncIterable<T>;
  map<TResult>(transform: (value: T) => TResult): IBlock<TResult>;
}

function blockFromBase<T>(base: IBaseBlock<T>): IBlock<T> {
  return {
    async sync() {
      const arr: T[] = [];
      for await (const item of this.async()) {
        arr.push(item);
      }
      return arr;
    },
    copyTo(subscriber: Subscriber<T>) {
      const ref = this;
      return {
        async sync() {
          for await (const item of ref.async()) {
            subscriber(item);
          }
          subscriber(undefined);
        },
      };
    },
    pipe<TResult>(map: (input: AsyncIterable<T>) => AsyncIterable<TResult>) {
      return blockFromBase(pipeBase<T, TResult>(base, map));
    },
    async() {
      return iteratorFromBaseBlock(base);
    },
    map<TResult>(transform: (value: T) => TResult) {
      return blockFromBase(
        pipeBase<T, TResult>(base, async function* (src) {
          for await (const item of src) {
            yield transform(item);
          }
        })
      );
    },
  };
}

export function blockFromSubject<T>(subject: ISubject<T>): IBlock<T> {
  return blockFromBase(subjectToBaseBlock(subject));
}

export function blockFromAsyncIterable<T>(
  iterable: AsyncIterable<T>
): IBlock<T> {
  return blockFromBase(iterableToBaseBlock(iterable));
}

let streams: Promise<void>[] = [];

export async function waitForStreams() {
  while (streams.length) {
    await Promise.allSettled([...streams]);
  }
}

export function commit({ sync }: ISync<void>) {
  const promise = sync();
  streams.push(promise);
  promise.finally(() => {
    streams = streams.filter((item) => item !== promise);
  });
}

export function createSubject<T>() {
  let subscribers: Subscriber<T>[] = [];
  const subject: ISubject<T> = {
    subscribe(sub) {
      subscribers.push(sub);
    },
    unsubscribe(sub) {
      subscribers = subscribers.filter((item) => item != sub);
    },
  };
  return {
    notify: (item: T) => {
      setTimeout(() => {
        for (const sub of subscribers) {
          sub(item);
        }
      });
    },
    close: () => {
      setTimeout(() => {
        for (const sub of subscribers) {
          sub(undefined);
        }
      });
    },
    subject,
  };
}
