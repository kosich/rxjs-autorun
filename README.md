<div align="center">
  <h1>
    <br/>
    🧙‍♂️ RxJS️ Autorun 🧙‍♀️
    <br/>
    <br/>
    <img src="https://dev-to-uploads.s3.amazonaws.com/i/ts0dd1366mz4naczd55p.png" width="341px" />
    <br/>
    <br/>
  </h1>
</div>

Autorun re-evaluates given expression, whenever dependant observables emit

Tastes best with `BehaviorSubject`s

**⚠️ WARNING:** use at your own risk!

## 🔧 API

- `run` returns an Observable that will emit evaluation resulst with each update

- `autorun` internally subscribes to `run` and returns the subscription

- `$(O)` tells `run` that it should be re-evaluated when `O` emits, with it's latest value

- `_(O)` still provides latest value to `run`, but doesn't enforce re-evaluation with `O` emission

See examples for more details

## 💃 Examples

Instant evaluation:

```ts
const o = of(1);
const r = run(() => $(o));
r.subscribe(console.log); // > 1
```

Delayed evaluation, when `o` emits:

```ts
const o = new Subject();
const r = run(() => $(o));
r.subscribe(console.log);
o.next('🐈'); // > 🐈
```

Expression with two observables:

```ts
const a = new BehaviorSubject('#');
const b = new BehaviorSubject(1);
const c = run(() => _(a) + $(b));

c.subscribe(observer); // > #1
a.next('💡'); // ~no update~
b.next(42); // > 💡42
```

## 🤝 Want to contribute to this project?

That will be awesome!

Please create an issue before submiting a PR — we'll be able to discuss it first!

Thanks!

## Enjoy 🙂
