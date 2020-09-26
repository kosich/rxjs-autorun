<div align="center">
  <h1>
    <br/>
    🧙‍♂ RxJS️ Autorun
    <br/>
    <sub><sub>track(() => $(stream) + 1)</sub></sub>
    <br/>
    <br/>
  </h1>
</div>

💃 …

## Example

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
