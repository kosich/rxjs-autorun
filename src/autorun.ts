import { EMPTY, Observable, of, Subject, Subscription, throwError } from 'rxjs';
import { distinctUntilChanged, startWith, switchMap, takeWhile } from 'rxjs/operators';

interface TrackEntry<V> {
    hasValue: boolean;
    value?: V;
    subscription?: Subscription;
    track: boolean;
    completed: boolean;
}

const ERROR_STUB = Object.create(null);

type $FnT<T> = (o: Observable<T>) => T;
type $Fn = <T>(o: Observable<T>) => T;
type Cb<T> = (...args: any[]) => T;

enum Update {
    Value,
    Completion
};

export function autorun<T>(fn: Cb<T>) {
    return run<T>(fn).subscribe();
}

type Context = {
    _?: $Fn,
    $?: $Fn
}
const context: Context = {
    _: void 0,
    $: void 0,
};

export const run = <T>(fn: Cb<T>): Observable<T> => new Observable(observer => {
    const deps = new Map<Observable<unknown>, TrackEntry<unknown>>();
    const update$ = new Subject<Update>();
    const $ = createTracker(true);
    const _ = createTracker(false);

    let error: any;
    let hasError = false;

    const anyDepRunning = () => {
        for (let dep of deps.values()) {
            if (dep.track && !dep.completed) {
                // One of the $-tracked deps is still running
                return true;
            }
        }
        // All $-tracked deps completed
        return false;
    }

    const runFn = () => {
        if (hasError) {
            return throwError(error);
        }
        const prev$ = context.$;
        const prev_ = context._;
        context.$ = $;
        context._ = _;
        try {
            return of(fn());
        } catch (e) {
            // rethrow original errors
            if (e != ERROR_STUB) {
                throw e;
            }
            return hasError ? throwError(error) : EMPTY;
        } finally {
            context.$ = prev$;
            context._ = prev_;
        }
    };

    const sub = update$
        .pipe(
            // run fn() and completion checker instantly
            startWith(Update.Value, Update.Completion),
            takeWhile(u => u !== Update.Completion || anyDepRunning()),
            switchMap(u => u === Update.Value ? runFn() : EMPTY),
            distinctUntilChanged(),
        )
        .subscribe(observer);

    // destroy all subscriptions
    sub.add(() => {
        deps.forEach((entry) => {
            entry.subscription?.unsubscribe();
        });
        update$.complete();
        deps.clear();
    });

    function createTracker(track: boolean) {
        return function $<O>(o: Observable<O>): O {
            if (deps.has(o)) {
                const v = deps.get(o)!;
                if (track && !v.track) {
                    // Previously tracked with _, but now also with $.
                    // So completed state becomes relevant now.
                    // Happens in case of e.g. run(() => _(o) + $(o))
                    v.track = true;
                }
                if (v.hasValue) {
                    return v.value as O;
                } else {
                    throw ERROR_STUB;
                }
            }

            const v: TrackEntry<O> = {
                hasValue: false,
                value: void 0,
                subscription: void 0,
                track,
                completed: false,
            };

            // NOTE: we will synchronously (immediately) evaluate observables
            // that can synchronously emit a value. Such observables as:
            // - of(…)
            // - timer(0, …)
            // - o.pipe( startWith(…) )
            // - BehaviorSubject
            // - ReplaySubject
            // - etc
            let isAsync = false;
            v.subscription = o
                .pipe(distinctUntilChanged())
                .subscribe({
                    next: (value) => {
                        v.hasValue = true;
                        v.value = value;

                        if (isAsync) {
                            if (track) {
                                update$.next(Update.Value);
                            } else {
                                // NOTE: what to do if the silenced value is absent?
                                // should we:
                                // - interrupt computation & w scheduling re-run when first value available
                                // - interrupt computation & w/o scheduling re-run
                                // - continue computation w/ undefined as value of _(o)
                            }
                        }
                    },
                    error: e => {
                        error = e;
                        hasError = true;
                        if (isAsync) {
                            update$.next(Update.Value);
                        }
                    },
                    complete: () => {
                        v.completed = true;
                        if (isAsync && track) {
                            update$.next(Update.Completion);
                        }
                    }
                });
            isAsync = true;

            deps.set(o, v);

            if (v.hasValue) {
                // Must have value because v.hasValue is true
                return v.value!;
            } else {
                throw ERROR_STUB;
            }
        };
    }

    return sub;
});

const tryApply = <T>(f: $FnT<T> | undefined, o: Observable<T>) => {
    if (!f) {
        throw new Error('$ or _ can only be called within a run() context');
    }
    return f(o);
}

export const $: $Fn = <T>(o: Observable<T>) => tryApply<T>(context.$, o);
export const _: $Fn = <T>(o: Observable<T>) => tryApply<T>(context._, o);
