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

Tastes best with Observables that always contain a value, such as `BehaviorSubject`s, `of`, `startWith`, etc.

**⚠️ WARNING:** use at your own risk!

## 🔧 API

- `computed` returns an Observable that will emit evaluation resulst with each update

- `autorun` internally subscribes to `computed` and returns the subscription

- `$(O)` tells `computed` that it should be re-evaluated when `O` emits, with it's latest value

- `_(O)` still provides latest value to `computed`, but doesn't enforce re-evaluation with `O` emission

See examples for more details

## 💃 Examples

Instant evaluation:

```ts
const o = of(1);
const r = computed(() => $(o));
r.subscribe(console.log); // > 1
```

Delayed evaluation, when `o` emits:

```ts
const o = new Subject();
const r = computed(() => $(o));
r.subscribe(console.log);
o.next('🐈'); // > 🐈
```

Expression with two observables:

```ts
const a = new BehaviorSubject('#');
const b = new BehaviorSubject(1);
const c = computed(() => _(a) + $(b));

c.subscribe(observer); // > #1
a.next('💡'); // ~no update~
b.next(42); // > 💡42
```

## ⚠️ Precautions

### Sideeffects

If an observable doesn't emit a synchronous value when it is subscribed, the expression will be **interrupted midflight** until observable emits.
Therefore side-effects are dangerous inside `computed`. E.g:

```ts
const o = new Subject();
computed(() => {
  console.log('Hello'); // perform a side-effect
  return $(o);          // will fail here since o has not emitted yet
}).subscribe(console.log);
o.next('World');

/** OUTPUT:
 * > Hello
 * > Hello
 * > World
 */
```

*We might introduce [alternative APIs](https://github.com/kosich/rxjs-autorun/issues/3) to handle this*

### Logic branching

Logic branching might lead to late subscription & unpredictable results:

```ts
const a = timer(0, 1000).pipe( take(2) );
const b = timer(0, 1000).pipe( take(2) );

computed(() => {
  if ($(a) % 2) return $(b);
  return $(a);
})
.subscribe(console.log);

/** OUTPUT:
 * > 0
 * > 0
 * > 1
 */
```

*We might introduce [alternative APIs](https://github.com/kosich/rxjs-autorun/issues/3) to handle this*

### Synchronous values skipping

Currently `computed` might skip sync emissions and run only with latest value emmitted, e.g.:

```ts
const o = of('a', 'b', 'c');

computed(() => $(o)).subscribe(console.log);

/** OUTPUT:
 * > c
 */
```

*This will probably be fixed in future updates*

## 🤝 Want to contribute to this project?

That will be awesome!

Please create an issue before submiting a PR — we'll be able to discuss it first!

Thanks!

## Enjoy 🙂
