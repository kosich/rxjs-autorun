import { EMPTY, Observable, of, Subject, Subscription, throwError } from 'rxjs';
import { distinctUntilChanged, startWith, switchMap, takeWhile } from 'rxjs/operators';


enum Strength {
    Weak = 0,
    Normal = 1,
    Strong = 2
}

interface TrackEntry<V> {
    hasValue: boolean;
    value?: V;
    subscription?: Subscription;
    track: boolean;
    used: boolean;
    completed: boolean;
    strength: Strength;
}

const ERROR_STUB = Object.create(null);

type $Fn = <T>(o: Observable<T>) => T;
type Cb<T> = (...args: any[]) => T;

type Trackers = {
    weak: $Fn;
    normal: $Fn;
    strong: $Fn;
}
type $FnWithTrackers = $Fn & Trackers;

enum Update {
    Value,
    Completion
};

export function autorun<T>(fn: Cb<T>) {
    return run<T>(fn).subscribe();
}

const errorTracker = (() => { throw new Error('$ or _ can only be called within a run() context'); }) as any as $FnWithTrackers;
errorTracker.weak = errorTracker;
errorTracker.normal = errorTracker;
errorTracker.strong = errorTracker;

type Context = {
    _: $FnWithTrackers,
    $: $FnWithTrackers
}
let context: Context = {
    _: errorTracker,
    $: errorTracker
};

const forwardTracker = (tracker: keyof Context): $FnWithTrackers => {
    const r  = (<T>(o: Observable<T>): T => context[tracker](o)) as $FnWithTrackers;
    r.weak   = o => context[tracker].weak(o);
    r.normal = o => context[tracker].normal(o);
    r.strong = o => context[tracker].strong(o);
    return r;
}

export const $ = forwardTracker('$');
export const _ = forwardTracker('_');

export const run = <T>(fn: Cb<T>): Observable<T> => new Observable(observer => {
    const deps = new Map<Observable<unknown>, TrackEntry<unknown>>();
    const update$ = new Subject<Update>();
    const createTrackers = (track: boolean) => {
        const r  = createTracker(track, Strength.Normal) as $FnWithTrackers;
        r.weak   = createTracker(track, Strength.Weak);
        r.normal = createTracker(track, Strength.Normal);
        r.strong = createTracker(track, Strength.Strong);
        return r;
    };
    const $ = createTrackers(true);
    const _ = createTrackers(false);

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

    const removeUnusedDeps = (ofStrength: Strength) => {
        for (let [key, { used, subscription, strength }] of deps.entries()) {
            if (used || strength > ofStrength) {
                continue;
            }
            subscription?.unsubscribe();
            deps.delete(key);
        }
    }

    const runFn = () => {
        if (hasError) {
            return throwError(error);
        }
        // Mark all deps as untracked and unused
        const maybeRestoreStrength: Observable<any>[] = [];
        for (let [key, dep] of deps.entries()) {
            dep.track = false;
            dep.used = false;
            if (dep.strength === Strength.Normal) {
                // Reset normal strength to weak when last run was successfull.
                dep.strength = Strength.Weak;
                maybeRestoreStrength.push(key);
            }
        }
        const prevCtxt = context;
        context = {$, _};
        try {
            const rsp = fn();
            removeUnusedDeps(Strength.Normal);
            return of(rsp);
        } catch (e) {
            for (let dep of maybeRestoreStrength) {
                deps.get(dep)!.strength = Strength.Normal;
            }
            removeUnusedDeps(Strength.Weak);
            // rethrow original errors
            if (e != ERROR_STUB) {
                throw e;
            }
            return hasError ? throwError(error) : EMPTY;
        } finally {
            context = prevCtxt;
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

    function createTracker(track: boolean, strength: Strength) {
        return function $<O>(o: Observable<O>): O {
            if (deps.has(o)) {
                const v = deps.get(o)!;
                v.used = true;
                if (track && !v.track) {
                    // Previously tracked with _, but now also with $.
                    // So completed state becomes relevant now.
                    // Happens in case of e.g. run(() => _(o) + $(o))
                    v.track = true;
                }
                if (strength > v.strength) {
                    // Previous tracking strength was weaker than it currently
                    // is. So temporarily use the stronger version.
                    v.strength = strength;
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
                track: true,
                used: true,
                completed: false,
                strength
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
                        const hadValue = v.hasValue;
                        v.hasValue = true;
                        v.value = value;

                        if (isAsync && v.track) {
                            update$.next(Update.Value);
                        }
                        if (!hadValue && !track) {
                            // Untracked dep now has it's first value. So really untrack it.
                            v.track = false;
                            // It could be that all tracked deps already completed. So signal
                            // that completion state might have changed.
                            update$.next(Update.Completion);
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
                        if (isAsync && v.track) {
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
