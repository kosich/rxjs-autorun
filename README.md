<div align="center">
  <h1>
    <br/>
    🧙‍♂️ RxJS️ Autorun 🧙‍♀️
    <br/>
    <br/>
    <img src="https://dev-to-uploads.s3.amazonaws.com/i/509pq2z20ea3hn4d3ug5.png" width="358px" />
    <br/>
    <sub><sub>Evaluates given expression whenever dependant Observables emit</sub></sub>
    <br/>
    <br/>
    <a href="https://www.npmjs.com/package/rxjs-autorun"><img src="https://img.shields.io/npm/v/rxjs-autorun" alt="NPM"></a>
    <a href="https://bundlephobia.com/result?p=rxjs-autorun@latest"><img src="https://img.shields.io/bundlephobia/minzip/rxjs-autorun?label=gzipped" alt="Bundlephobia"></a>
    <a href="https://opensource.org/licenses/MIT" rel="nofollow"><img src="https://img.shields.io/npm/l/rxjs-autorun" alt="MIT license"></a>
  </h1>
</div>

## 📦 Install

```
npm i rxjs-autorun
```

Or **[try it online](https://stackblitz.com/edit/rxjs-autorun-repl?file=index.ts)**

**⚠️ WARNING:** at this stage it's a very experimental library, use at your own risk!

## 💃 Examples

### Instant evaluation:

```ts
const o = of(1);
const r = combined(() => $(o));
r.subscribe(console.log); // > 1
```

### Delayed evaluation:

_`combined` waits for Observable `o` to emit a value_

```ts
const o = new Subject();
const r = combined(() => $(o));
r.subscribe(console.log);
o.next('🐈'); // > 🐈
```

### Two Observables:

_recompute `c` with latest `a` and `b`, only when `b` updates_

```ts
const a = new BehaviorSubject('#');
const b = new BehaviorSubject(1);
const c = combined(() => _(a) + $(b));

c.subscribe(observer); // > #1
a.next('💡'); // ~no update~
b.next(42); // > 💡42
```

### Filtering:

_use [NEVER](https://rxjs.dev/api/index/const/NEVER) to suspend emission till `source$` emits again_

```ts
const source$ = timer(0, 1_000);
const even$ = combined(() => $(source$) % 2 == 0 ? _(source$) : _(NEVER));
```

### Switchmap:

_fetch data every second_

```ts
function fetch(x){
  // mock delayed fetching of x
  return of('📦' + x).pipe(delay(100));
}

const a = timer(0, 1_000);
const b = combined(() => fetch($(a)));
const c = combined(() => $($(b)));
c.subscribe(console.log);
// > 📦 1
// > 📦 2
// > 📦 3
// > …
```


## 🔧 API

To run an expression, you must wrap it in one of these:

- `combined` returns an Observable that will emit evaluation results

- `computed` returns an Observable that will emit **distinct** evaluation results with **distinctive updates**

- `autorun` internally subscribes to `combined` and returns the subscription

E.g:

```ts
combined(() => { … });
```

### 👓 Tracking

You can read values from Observables inside `combined` (or `computed`, or `autorun`) in two ways:

- `$(O)` tells `combined` that it should be re-evaluated when `O` emits, with it's latest value

- `_(O)` still provides latest value to `combined`, but doesn't enforce re-evaluation with `O` emission

Both functions would interrupt mid-flight if `O` has not emitted before and doesn't produce a value synchronously.

If you don't want interruptions — try Observables that always contain a value, such as `BehaviorSubject`s, `of`, `startWith`, etc.

Usually this is all one needs when to use `rxjs-autorun`

### 💪 Strength

Some times you need to tweak what to do with **subscription of an Observable that is not currently used**.

So we provide three levels of subscription strength:

- `normal` - default - will unsubscribe if the latest run of expression didn't use this Observable:

  ```ts
  combined(() => $(a) ? $(b) : 0)
  ```

  when `a` is falsy — `b` is not used and will be **dropped when expression finishes**

  _NOTE: when you use `$(…)` — it applies normal strength, but you can be explicit about that via `$.normal(…)` notation_


- `strong` - will keep the subscription for the life of the expression:

  ```ts
  combined(() => $(a) ? $.strong(b) : 0)
  ```

  when `a` is falsy — `b` is not used, but the subscription will be **kept**


- `weak` - will unsubscribe eagerly, if waiting for other Observable to emit:

  ```ts
  combined(() => $(a) ? $.weak(b) : $.weak(c));
  ```

  When `a` is truthy — `c` is not used and we'll wait `b` to emit,
  meanwhile `c` will be unsubscribed eagerly, even before `b` emits

  And vice versa:
  When `a` is falsy — `b` is not used and we'll wait `c` to emit,
  meanwhile `b` will be unsubscribed eagerly, even before `c` emits

  Another example:

  ```ts
  combined(() => $(a) ? $(b) + $.weak(c) : $.weak(c))
  ```

  When `a` is falsy — `b` is not used and will be dropped, `c` is used
  When `a` becomes truthy - `b` and `c` are used
  Although `c` will now have to wait for `b` to emit, which takes indefinite time
  And that's when we might want to mark `c` for **eager unsubscription**, until `a` or `b` emits


See examples for more use-case details

## ⚠️ Precautions

### Sub-functions

`$` and `_` memorize Observables that you pass to them. That is done to keep subscriptions and values and not to re-subscribe to same `$(O)` on each re-run.

Therefore if you create a new Observable on each run of the expression:

```ts
let a = timer(0, 100);
let b = timer(0, 1000);
let c = combined(() => $(a) + $(fetch($(b))));

function fetch(): Observable<any> {
  return ajax.getJSON('…');
}
```

It might lead to unexpected fetches with each `a` emission!

If that's not what we need — we can go two ways:

- create a separate `combined()` that will call `fetch` only when `b` changes — see [switchMap](#switchmap) example for details

- use some memoization or caching technique on `fetch` function that would return same Observable, when called with same arguments

### Side-effects

If an Observable doesn't emit a synchronous value when it is subscribed, the expression will be **interrupted mid-flight** until the Observable emits.
So if you must make side-effects inside `combined` — put that after reading from streams:

```ts
const o = new Subject();
combined(() => {
  console.log('Hello'); // DANGEROUS: perform a side-effect before reading from stream
  return $(o);          // will fail here since o has not emitted yet
}).subscribe(console.log);
o.next('World');

/** OUTPUT:
 * > Hello
 * > Hello
 * > World
 */
```

 While:

```ts
const o = new Subject();
combined(() => {
  let value = $(o); // will fail here since o has not emitted yet
  console.log('Hello'); // SAFE: perform a side-effect after reading from stream
  return value;
}).subscribe(console.log);
o.next('World');

/** OUTPUT:
 * > Hello
 * > World
 */
```

*We might introduce [alternative APIs](https://github.com/kosich/rxjs-autorun/issues/3) to help with this*

### Logic branching

Logic branches might lead to late subscription to a given Observable, because it was not seen on previous runs. And if your Observable doesn't produce a value synchronously when subscribed — then expression will be **interrupted mid-flight** until any visited Observable from this latest run emits a new value.

*We might introduce [alternative APIs](https://github.com/kosich/rxjs-autorun/issues/3) to help with this*

Also note that you might want different handling of unused subscriptions, please see [strength](#-strength) section for details.

### Synchronous values skipping

Currently `rxjs-autorun` will skip synchronous emissions and run expression only with latest value emitted, e.g.:

```ts
const o = of('a', 'b', 'c');

combined(() => $(o)).subscribe(console.log);

/** OUTPUT:
 * > c
 */
```

*This might be fixed in future updates*

## 🤝 Want to contribute to this project?

That will be awesome!

Please create an issue before submitting a PR — we'll be able to discuss it first!

Thanks!

## Enjoy 🙂
