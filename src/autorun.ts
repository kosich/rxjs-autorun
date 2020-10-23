import { Observable, Subscription } from 'rxjs';
import { distinctUntilChanged } from 'rxjs/operators';


// an error to make mid-flight interruptions
// when a value is still not available
const HALT_ERROR = Object.create(null);

// error if tracker is used out of autorun/computed context
export const TrackerError = new Error('$ or _ can only be called within computed or autorun context');
const errorTracker: Trackers = () => { throw TrackerError; };
errorTracker.weak = errorTracker;
errorTracker.normal = errorTracker;
errorTracker.strong = errorTracker;

let context: Context = {
    _: errorTracker,
    $: errorTracker
};

const forwardTracker = (tracker: keyof Context): Trackers => {
    const r  = (<T>(o: Observable<T>): T => context[tracker](o)) as Trackers;
    r.weak   = o => context[tracker].weak(o);
    r.normal = o => context[tracker].normal(o);
    r.strong = o => context[tracker].strong(o);
    return r;
}

export const $ = forwardTracker('$');
export const _ = forwardTracker('_');

export function autorun<T>(fn: Expression<T>): Subscription {
    return combined<T>(fn).subscribe();
}

export function combined<T>(fn: Expression<T>): Observable<T> {
    return runner(fn, InputType.Raw);
}

export function computed<T>(fn: Expression<T>): Observable<T> {
    return runner(fn, InputType.Distinct).pipe(distinctUntilChanged());
}

// core function
const runner = <T>(fn: Expression<T>, inputType: InputType): Observable<T> => new Observable<T>(observer => {
    const deps = new Map<Observable<unknown>, TrackEntry<unknown>>();

    // context to be used for running expression
    const newCtx = {
        $: createTrackers(true),
        _: createTrackers(false)
    };

    // on unsubscribe/complete we destroy all subscriptions
    const sub = new Subscription(() => {
        deps.forEach(dep => {
            dep.subscription.unsubscribe();
        });
    });

    // flag that indicates that current run might've affected completion status
    // we'll check completion after the first run
    let shouldCheckCompletion = true;

    // initial run
    runFn();

    return sub;


    function runFn () {
        // Mark all deps as untracked and unused, lowering normal to weak
        const loweredStrengthDeps: TrackEntry<any>[] = [];
        deps.forEach(dep => {
            dep.track = false;
            dep.used = false;
            // setting normal strength to weak, so that if previously `a` was
            // tracked as normal and in the latest run we only see `weak(a)` -
            // we can mark it as weak. this is restored if halted
            if (dep.strength === Strength.Normal) {
                dep.strength = Strength.Weak;
                loweredStrengthDeps.push(dep);
            }
        });

        const prevCtxt = context;
        context = newCtx;
        try {
            const result = fn();
            removeUnusedDeps(Strength.Normal);
            observer.next(result);
        } catch (e) {
            // handling mid-flight interruption error
            // NOTE: check requires === strict equality
            if (e === HALT_ERROR) {
                // restore lowered strength
                loweredStrengthDeps.forEach(dep => {
                    dep.strength = Strength.Normal;
                });
                // clean-up weak subscriptions
                removeUnusedDeps(Strength.Weak);
            } else {
                // rethrow original errors
                observer.error(e);
                // we're errored, no need to check completion
                shouldCheckCompletion = false;
            }
        } finally {
            context = prevCtxt;

            // if this run was flagged as potentially completing
            if (shouldCheckCompletion) {
                checkCompletion();
            }
        }
    }

    function checkCompletion () {
        // reset the flag
        shouldCheckCompletion = false;

        // any dep is still running
        for (let dep of deps.values()) {
            if (dep.track && !dep.completed) {
                // one of the $-tracked deps is still running
                return;
            }
        }

        // All $-tracked deps completed
        observer.complete();
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
        const r  = createTracker(track, Strength.Normal) as Trackers;
        r.weak   = createTracker(track, Strength.Weak);
        r.normal = createTracker(track, Strength.Normal);
        r.strong = createTracker(track, Strength.Strong);
        return r;
    }

    function createTracker(track: boolean, strength: Strength): Tracker {
        return function tracker<O>(o: Observable<O>): O {
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
                // Eagerly create subscription that can be destroyed.
                subscription: new Subscription(),
                strength,
                track: true,
                used: true,
                completed: false
            };

            deps.set(o, v);

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
                (inputType == InputType.Distinct
                    ? o.pipe(distinctUntilChanged())
                    : o)
                .subscribe({
                    next(value) {
                        const hadValue = v.hasValue;
                        v.hasValue = true;
                        v.value = value;

                        const isUntrackFirstValue = !hadValue && !track;

                        // It could be that all tracked deps already completed.
                        // So signal that completion state might have changed.
                        if (isUntrackFirstValue) {
                            shouldCheckCompletion = true;
                        }

                        if (isAsync && v.track) {
                            runFn();
                        }

                        if (isUntrackFirstValue) {
                            // Untracked dep now has it's first value. So really untrack it.
                            v.track = false;
                        }
                    },
                    error(err) {
                        if (isAsync) {
                            observer.error(err);
                        } else {
                            syncError = err;
                            hasSyncError = true;
                        }
                    },
                    complete() {
                        v.completed = true;

                        // if we don't have a value — we interrupt evaluation
                        // and complete output. See issue #22
                        if (!v.hasValue) {
                            observer.complete();

                            // immediately halt the computation
                            if (!isAsync) {
                                hasSyncError = true;
                                syncError = HALT_ERROR;
                            }
                        }

                        if (isAsync && v.track) {
                            checkCompletion();
                        }
                    }
                })
            );
            if (hasSyncError){
                throw syncError;
            }
            isAsync = true;
            // }}} End Of Sync Section

            if (v.hasValue) {
                // Must have value because v.hasValue is true
                return v.value!;
            } else {
                throw HALT_ERROR;
            }
        };
    }
});

// Types
const enum InputType {
    Distinct,
    Raw
}

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
    _: Trackers;
    $: Trackers;
}

interface Trackers extends Tracker {
    weak: Tracker;
    normal: Tracker;
    strong: Tracker;
}

type Tracker = <T>(o: Observable<T>) => T;
