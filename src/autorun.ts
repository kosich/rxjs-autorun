import { EMPTY, Observable, of, Subject, Subscription, throwError } from 'rxjs';
import { distinctUntilChanged, filter, mergeMap, startWith, takeWhile } from 'rxjs/operators';


// an error to make mid-flight interruptions
// when a value is still not available
const HALT_ERROR = Object.create(null);

// error if tracker is used out of autorun/computed context
export const TrackerError = new Error('$ or _ can only be called within computed or autorun context');
const errorTracker: $FnWithTrackers = () => { throw TrackerError; };
errorTracker.weak = errorTracker;
errorTracker.normal = errorTracker;
errorTracker.strong = errorTracker;

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

export function autorun<T>(fn: Expression<T>) {
    return computed<T>(fn).subscribe();
}

export const computed = <T>(fn: Expression<T>): Observable<T> => new Observable(observer => {
    const deps = new Map<Observable<unknown>, TrackEntry<unknown>>();
    const update$ = new Subject<UpdateSignal>();

    // context to be used for running expression
    const newCtx = {
        $: createTrackers(true),
        _: createTrackers(false)
    };

    const sub = update$
        .pipe(
            // run fn() and completion checker instantly
            // for synchronous and untrack-only expressions
            startWith(UpdateSignal.Next, UpdateSignal.Complete),
            // while any dependency is alive
            takeWhile(shouldKeepAlive),
            // re-run only on Update.Value
            filter(u => u === UpdateSignal.Next),
            mergeMap(runFn),
            distinctUntilChanged(),
        )
        .subscribe(observer);

    // on unsubscribe/complete we destroy all subscriptions
    sub.add(() => {
        deps.forEach(dep => {
            dep.subscription.unsubscribe();
        });
        update$.complete();
        deps.clear();
    });

    return sub;

    function shouldKeepAlive (u: UpdateSignal): boolean {
        // not a completion signal
        if (u !== UpdateSignal.Complete) {
            return true;
        }

        // any dep is still running
        for (let dep of deps.values()) {
            if (dep.track && !dep.completed) {
                // One of the $-tracked deps is still running
                return true;
            }
        }
        // All $-tracked deps completed
        return false;
    }

    function runFn (): Observable<T> {
        // Mark all deps as untracked and unused
        const maybeRestoreStrength: Observable<any>[] = [];
        deps.forEach((dep, key) => {
            dep.track = false;
            dep.used = false;
            if (dep.strength === Strength.Normal) {
                // Reset normal strength to weak when last run was successfull.
                dep.strength = Strength.Weak;
                maybeRestoreStrength.push(key);
            }
        });
        const prevCtxt = context;
        context = newCtx;
        try {
            const rsp = fn();
            removeUnusedDeps(Strength.Normal);
            return of(rsp);
        } catch (e) {
            maybeRestoreStrength.forEach(dep => {
                deps.get(dep)!.strength = Strength.Normal;
            });
            removeUnusedDeps(Strength.Weak);

            // suppress mid-flight interruption error
            // NOTE: check requires === if e is primitive, JS engine will try to
            //       convert ERROR_STUB to primitive
            if (e === HALT_ERROR) {
                return EMPTY;
            }

            // rethrow original errors
            return throwError(e);
        } finally {
            context = prevCtxt;
        }
    }

    function removeUnusedDeps (ofStrength: Strength) {
        deps.forEach((dep, key) => {
            if (dep.used || dep.strength > ofStrength) {
                return;
            }
            dep.subscription.unsubscribe();
            deps.delete(key);
        });
    }

    function createTrackers (track: boolean) {
        const r  = createTracker(track, Strength.Normal) as $FnWithTrackers;
        r.weak   = createTracker(track, Strength.Weak);
        r.normal = createTracker(track, Strength.Normal);
        r.strong = createTracker(track, Strength.Strong);
        return r;
    }

    function createTracker(track: boolean, strength: Strength): $Fn {
        return function $<O>(o: Observable<O>): O {
            if (deps.has(o)) {
                const v = deps.get(o)!;
                v.used = true;
                if (track && !v.track) {
                    // Previously tracked with _, but now also with $.
                    // So completed state becomes relevant now.
                    // Happens in case of e.g. computed(() => _(o) + $(o))
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
                    throw HALT_ERROR;
                }
            }

            const v: TrackEntry<O> = {
                hasValue: false,
                value: void 0,
                // Eagerly create subscription that can be destroyed. This is a
                // precaution if this entry is unsubscribed synchronously
                subscription: new Subscription(),
                strength,
                track: true,
                used: true,
                completed: false
            };

            // Sync Code Section {{{
            // NOTE: we will synchronously (immediately) evaluate observables
            // that can synchronously emit a value. Such observables as:
            // - of(…)
            // - o.pipe( startWith(…) )
            // - BehaviorSubject
            // - ReplaySubject
            // - etc
            let isAsync = false;
            let hasSyncError = false;
            let syncError = void 0;
            v.subscription.add(
                o.pipe(distinctUntilChanged())
                .subscribe({
                    next(value) {
                        const hadValue = v.hasValue;
                        v.hasValue = true;
                        v.value = value;

                        if (isAsync && v.track) {
                            update$.next(UpdateSignal.Next);
                        }

                        if (!hadValue && !track) {
                            // Untracked dep now has it's first value. So really untrack it.
                            v.track = false;
                            // It could be that all tracked deps already completed. So signal
                            // that completion state might have changed.
                            update$.next(UpdateSignal.Complete);
                        }
                    },
                    error(err) {
                        if (isAsync) {
                            update$.error(err);
                        } else {
                            syncError = err;
                            hasSyncError = true;
                        }
                    },
                    complete() {
                        v.completed = true;
                        if (isAsync && v.track) {
                            update$.next(UpdateSignal.Complete);
                        }
                    }
                })
            );
            if (hasSyncError){
                throw syncError;
            }
            isAsync = true;
            // }}} End Of Sync Section

            deps.set(o, v);

            if (v.hasValue) {
                // Must have value because v.hasValue is true
                return v.value!;
            } else {
                throw HALT_ERROR;
            }
        };
    }
});

type Expression<T> = () => T;

interface TrackEntry<V> {
    hasValue: boolean;
    value?: V;
    /** subscription to source */
    subscription: Subscription;
    /** subscription strength */
    strength: Strength;
    /** is tracked $ or untracked _ */
    track: boolean;
    /** has been used in latest run */
    used: boolean;
    /** source completion status */
    completed: boolean;
}

const enum Strength {
    Weak = 0,
    Normal = 1,
    Strong = 2
}

interface Context {
    _: $FnWithTrackers;
    $: $FnWithTrackers;
}

type $Fn = <T>(o: Observable<T>) => T;
interface $FnWithTrackers extends $Fn {
    weak: $Fn;
    normal: $Fn;
    strong: $Fn;
}

const enum UpdateSignal {
    Next,
    Complete
}
