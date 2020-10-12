<div align="center">
  <h1>
    <br/>
    🧙‍♂️ RxJS️ Autorun 🧙‍♀️
    <br/>
    <br/>
    <img src="https://dev-to-uploads.s3.amazonaws.com/i/509pq2z20ea3hn4d3ug5.png" width="358px" />
    <br/>
    <br/>
  </h1>
</div>

Autorun re-evaluates given expression, whenever dependant observables emit

Tastes best with Observables that always contain a value, such as `BehaviorSubject`s, `of`, `startWith`, etc.

**⚠️ WARNING:** use at your own risk!

## 📦 Install

```
npm i rxjs-autorun
```

Or **[try it online](https://stackblitz.com/edit/rxjs-autorun-repl?file=index.ts)**

## 🔧 API

- `computed` returns an Observable that will emit evaluation results with each update

- `autorun` internally subscribes to `computed` and returns the subscription

### 👓 Tracking

Your can access values from Observables inside `computed` (or `autorun`) in two ways:

- `$(O)` tells `computed` that it should be re-evaluated when `O` emits, with it's latest value

- `_(O)` still provides latest value to `computed`, but doesn't enforce re-evaluation with `O` emission

Both functions would interrupt midflight if `O` has not emitted yet and doesn't produce a value synchronously.

### 💪 Strength

Some times you want to manage what to do with **subscription of an Observable that is not currently used**.

So we provide three levels of subscription strength:

- `normal` - default - will unsubscribe if the latest run of expression didn't use this observable

  ```ts
  compute(() => $(a) ? $(b) : 0)
  ```

  when `a` is falsy — `b` is not used and will be **dropped when expression finishes**

  _NOTE: `$(…)` has normal strength, but you can also be explicit about that via `$.normal(…)`_

- `strong` - will keep the subscription for the life of expression

  ```ts
  compute(() => $(a) ? $.strong(b) : 0)
  ```

  when `a` is falsy — `b` is not used, but the subscription will be **kept**


- `weak` - will unsubscribe eagerly, if waiting for other observable to emit

  ```ts
  compute(() => $(a) ? $.weak(b) : $.weak(c));
  ```

  When `a` is truthy — `c` is not used and we'll wait `b` to emit,
  meanwhile `c` will be unsubscribed eagerly, even before `b` emits

  And vice verca:
  When `a` is falsy — `b` is not used and we'll wait `c` to emit,
  meanwhile `b` will be unsubscribed eagerly, even before `c` emits

  Another example:

  ```ts
  compute(() => $(a) ? $(b) + $.weak(c) : $.weak(c))
  ```

  When `a` is falsy — `b` is not used and will be dropped, `c` is used
  When `a` becomes truthy - `b` and `c` are used
  Although `c` will now have to wait for `b` to emit, which takes indefinite time
  And that's when we might want to mark `c` for **eager unsubscription**, until `a` or `b` emits


See examples for more use-case details

## 💃 Examples

### Instant evaluation:

```ts
const o = of(1);
const r = computed(() => $(o));
r.subscribe(console.log); // > 1
```

### Delayed evaluation:

_`computed` waits for observable `o` to emit a value_

```ts
const o = new Subject();
const r = computed(() => $(o));
r.subscribe(console.log);
o.next('🐈'); // > 🐈
```

### Two observables:

_recompute `c` with latest `a` and `b`, only when `b` updates_

```ts
const a = new BehaviorSubject('#');
const b = new BehaviorSubject(1);
const c = computed(() => _(a) + $(b));

c.subscribe(observer); // > #1
a.next('💡'); // ~no update~
b.next(42); // > 💡42
```

### Filtering:

_use [EMPTY](https://rxjs.dev/api/index/const/EMPTY) to suspend emission till `source$` emits again_

```ts
const source$ = timer(0, 1_000);
const even$ = computed(() => $(source$) % 2 == 0 ? _(source$) : _(EMPTY));
```

### Switchmap:

_fetch data every second_

```ts
function fetch(x){
  // mock delayed fetching of x
  return of('📦' + x).pipe(delay(100));
}

const a = timer(0, 1_000);
const b = computed(() => fetch($(a)));
const c = computed(() => $($(b)));
c.subscribe(console.log);
// > 📦 1
// > 📦 2
// > 📦 3
// > …
```

## ⚠️ Precautions

### Sub-functions

`$` and `_` memorize observables that you pass to them. That is done to keep subscriptions and values and not to re-subscribe to same `$(O)` on each re-run.

Therefore if you create a new Observable on each run of the expression:

```ts
let a = timer(0, 100);
let b = timer(0, 1000);
let c = computed(() => $(a) + $(fetch($(b))));

function fetch(): Observable<any> {
  return ajax.getJSON('…');
}
```

It might lead to unexpected fetches with each `a` emission!

If that's not what we need — we can go two ways:

- create a separate `computed()` that will call `fetch` only when `b` changes — see [switchMap](#switchmap) example for details

- use some memoization or caching technique on `fetch` function that would return same observable, when called with same arguments

### Side-effects

If an observable doesn't emit a synchronous value when it is subscribed, the expression will be **interrupted midflight** until observable emits.
So if you must make side-effects inside `computed` — put that after reading streams:

```ts
const o = new Subject();
computed(() => {
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
computed(() => {
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

Logic branches might lead to late subscription to a given Observable, because it was not seen on previous runs. And if your observable doesn't produce a value synchronously when subscribed — then expression will be **interrupted midflight** until any visited Observable from this run emits a new value.

*We might introduce [alternative APIs](https://github.com/kosich/rxjs-autorun/issues/3) to help with this*

Also note that you might want different handling of unused subscriptions, please see [strength](#-strength) section for details.

### Synchronous values skipping

Currently `computed` will skip synchronous emissions and run expression only with latest value emmitted, e.g.:

```ts
const o = of('a', 'b', 'c');

computed(() => $(o)).subscribe(console.log);

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
