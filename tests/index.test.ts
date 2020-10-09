import { BehaviorSubject, defer, Observable, of, Subject, Subscription, throwError } from 'rxjs';
import { $, run, _ } from '../src';

describe('autorun', () => {

    type MockObserver = {
        next: jest.Mock;
        error: jest.Mock;
        complete: jest.Mock;
    };

    const makeObserver = (): MockObserver => ({
        next: jest.fn(),
        error: jest.fn(),
        complete: jest.fn(),
    });
    let observer: MockObserver;
    let sub: Subscription;

    beforeEach(() => {
        observer = makeObserver();
    });

    afterEach(() => {
        if (sub) {
            sub.unsubscribe();
        }
    });

    test('Simple instant/cold track', () => {
        const o = of(1);
        const r = run(() => $(o));
        sub = r.subscribe(observer);
        expect(observer.next.mock.calls).toEqual([[1]]);
    });

    test('Simple hot track', () => {
        const o = new Subject();
        const r = run(() => $(o));
        sub = r.subscribe(observer);
        o.next('test');
        expect(observer.next.mock.calls).toEqual([['test']]);
    });

    test('Simple instant/cold untrack', () => {
        const o = of(1);
        const r = run(() => _(o));
        sub = r.subscribe(observer);
        expect(observer.next.mock.calls.length).toEqual(1);
    });

    test('Simple untrack', () => {
        const o = new Subject();
        const r = run(() => _(o));
        sub = r.subscribe(observer);
        o.next('test');
        expect(observer.next).toBeCalledWith('test');
        expect(observer.complete).toBeCalled();
    });

    test('Dependant runners', () => {
        const o = of(1);
        const r1 = run(() => $(o));
        const r2 = run(() => $(r1));
        sub = r2.subscribe(observer);
        expect(observer.next.mock.calls).toEqual([[1]]);
    });

    test('Silent with trackable', () => {
        const a = new BehaviorSubject('#');
        const b = new BehaviorSubject(1);
        const c = run(() => _(a) + $(b));
        sub = c.subscribe(observer); // instant update
        expect(observer.next.mock.calls.length).toBe(1);
        expect(observer.next.mock.calls[0]).toEqual(['#1']);
        a.next('💡'); // no update
        expect(observer.next.mock.calls.length).toBe(1);
        b.next(42); // > 💡42
        expect(observer.next.mock.calls.length).toBe(2);
        expect(observer.next.mock.calls[1]).toEqual(['💡42']);
    });

    it('should only react to distinctive value changes', () => {
        const o = new Subject<number>();
        const fn = jest.fn(() => 0);
        const r = run(() => $(o) + fn());
        sub = r.subscribe(observer);
        o.next(0);
        o.next(0);
        expect(fn.mock.calls.length).toBe(1);
    });

    it('should only emit distinctive results', () => {
        const o = new Subject<number>();
        const r = run(() => $(o) - $(o));
        sub = r.subscribe(observer);
        o.next(0);
        o.next(1);
        o.next(2);
        expect(observer.next.mock.calls.length).toBe(1);
    });

    it('should interrupt expression midflight', () => {
        const o = new Subject<number>();
        const fn = jest.fn(() => 0);
        const r = run(() => fn() + $(o));
        sub = r.subscribe(observer);
        expect(fn.mock.calls.length).toBe(1);
        expect(observer.next.mock.calls.length).toBe(0);
        o.next(0);
        expect(fn.mock.calls.length).toBe(2);
        expect(observer.next.mock.calls.length).toBe(1);
    });

    // this might not be desired behavior
    it('will skip sync emissions', () => {
        const o = of('a', 'b', 'c');
        const r = run(() => $(o));
        sub = r.subscribe(observer);
        expect(observer.next.mock.calls).toEqual([['c']]);
    });

    it('will not accept running $ and _ outside run', () => {
        // Before run
        const e = new Error('$ or _ can only be called within a run() context');
        expect($).toThrow(e);
        expect(_).toThrow(e);
        expect($.weak).toThrow(e);
        expect(_.normal).toThrow(e);
        expect($.weak).toThrow(e);
        expect(_.normal).toThrow(e);

        const r = run(() => $(of(1)));
        sub = r.subscribe(observer);

        // After run
        expect($).toThrow(e);
        expect(_).toThrow(e);
        expect($.weak).toThrow(e);
        expect(_.normal).toThrow(e);
        expect($.weak).toThrow(e);
        expect(_.normal).toThrow(e);
    });

    describe('completion', () => {
        it('will complete when deps complete', () => {
            const o = new BehaviorSubject(1);
            const o2 = new BehaviorSubject(2);
            const r = run(() => $(o) + $(o2));
            sub = r.subscribe(observer);

            expect(observer.next).toBeCalledWith(3);
            expect(observer.complete).not.toHaveBeenCalled();

            // 1 of 2 completes. Result doesn't complete.
            o2.complete();
            o.next(3);
            expect(observer.next).toBeCalledWith(5);
            expect(observer.complete).not.toHaveBeenCalled();

            // Both deps completed. Result completes as well.
            o.complete();
            expect(observer.complete).toHaveBeenCalled();
        });

        it('doesn\'t care about completion of untracked dep', () => {
            const o = new BehaviorSubject(1);
            const o2 = new BehaviorSubject(2);
            const r = run(() => $(o) + _(o2));
            sub = r.subscribe(observer);

            expect(observer.next).toBeCalledWith(3);
            expect(observer.complete).not.toHaveBeenCalled();

            // The only tracked dep completes, so result completes
            o.complete();
            expect(observer.complete).toHaveBeenCalled();
        });

        it('completes immediately when only using untracked values', () => {
            const o = new BehaviorSubject(1);
            const o2 = new BehaviorSubject(2);
            const r = run(() => _(o) + _(o2));
            sub = r.subscribe(observer);

            expect(observer.next).toBeCalledWith(3);
            expect(observer.complete).toHaveBeenCalled();
        });

        it('doesn\'t rerun expression on completion of dep', () => {
            const o = new BehaviorSubject(1);
            let runCount = 0;
            const r = run(() => $(o) + ++runCount);
            sub = r.subscribe(observer);

            expect(observer.next).toBeCalledWith(2);
            expect(runCount).toEqual(1);

            o.complete();
            expect(observer.next).toBeCalledWith(2);
            expect(runCount).toEqual(1);
        });

        it('completes correctly when deps complete synchronously', () => {
            const o = of(1);
            const o2 = of(2);
            const r = run(() => $(o) + $(o2));
            sub = r.subscribe(observer);

            expect(observer.next).toBeCalledWith(3);
            expect(observer.complete).toHaveBeenCalled();
        });
    });

    describe('error', () => {
        it('errors out when one of the deps errors out', () => {
            const o = new BehaviorSubject(1);
            const o2 = new BehaviorSubject(2);
            const r = run(() => $(o) + $(o2));
            sub = r.subscribe(observer);

            expect(observer.next).toBeCalledWith(3);
            expect(observer.error).not.toHaveBeenCalled();

            o2.error('Some failure');
            expect(observer.error).toHaveBeenCalledWith('Some failure');
        });

        it('errors out even when error value is undefined', () => {
            const o = new BehaviorSubject(1);
            const r = run(() => $(o));
            sub = r.subscribe(observer);

            expect(observer.next).toBeCalledWith(1);
            expect(observer.error).not.toHaveBeenCalled();

            o.error(void 0);
            expect(observer.error).toHaveBeenCalledWith(void 0);
        });

        it('also considers untracked observable errors', () => {
            const o = new BehaviorSubject(1);
            const o2 = new BehaviorSubject(2);
            const r = run(() => $(o) + _(o2));
            sub = r.subscribe(observer);

            expect(observer.next).toBeCalledWith(3);
            expect(observer.error).not.toHaveBeenCalled();

            // Untracked observer errors out
            o2.error('Byebye');
            expect(observer.error).toHaveBeenCalledWith('Byebye');
        });

        it('completes correctly when deps error out synchronously', () => {
            const o = of(1);
            const o2 = throwError('Byebye');
            const r = run(() => $(o) + $(o2));
            sub = r.subscribe(observer);

            expect(observer.next).not.toBeCalled();
            expect(observer.error).toHaveBeenCalledWith('Byebye');
        });
    });

    describe('multiple subscribers', () => {
        it('should subscribe twice', () => {
            let count = 0;
            const o = defer(() => of(++count));
            const r = run(() => $(o));

            r.subscribe();
            r.subscribe();
            expect(count).toBe(2);
        });

        it('can be subscribed multiple times', () => {
            const o = new BehaviorSubject(1);
            const o2 = new BehaviorSubject(2);
            const observer2 = makeObserver();
            const r = run(() => $(o) + _(o2));

            sub = new Subscription();
            sub.add(r.subscribe(observer));
            expect(observer.next).toBeCalledWith(3);
            expect(observer2.next).not.toHaveBeenCalled();

            o.next(3);
            expect(observer.next).toBeCalledWith(5);
            expect(observer.next).toBeCalledTimes(2);
            expect(observer2.next).not.toHaveBeenCalled();

            sub.add(r.subscribe(observer2));
            expect(observer.next).toBeCalledWith(5);
            expect(observer.next).toBeCalledTimes(2);
            expect(observer.complete).not.toHaveBeenCalled();
            expect(observer2.next).toBeCalledWith(5);
            expect(observer2.next).toBeCalledTimes(1);
            expect(observer2.complete).not.toHaveBeenCalled();

            o.complete();
            expect(observer.next).toBeCalledWith(5);
            expect(observer.next).toBeCalledTimes(2);
            expect(observer.complete).toHaveBeenCalled();
            expect(observer2.next).toBeCalledWith(5);
            expect(observer2.next).toBeCalledTimes(1);
            expect(observer2.complete).toHaveBeenCalled();
        });

        it('subscribes upstream obserables multiple times', () => {
            let counter = 0;
            const o = defer(() => new BehaviorSubject(++counter));
            const observer2 = makeObserver();
            const r = run(() => $(o));

            sub = new Subscription();
            sub.add(r.subscribe(observer));
            expect(observer.next).toBeCalledWith(1);

            sub.add(r.subscribe(observer2));
            expect(observer2.next).toBeCalledWith(2);
        });

        it('subscriptions complete independently', () => {
            let counter = 0;
            const os = [new BehaviorSubject(1), new BehaviorSubject(2)];
            const o = defer(() => os[counter++]);
            const observer2 = makeObserver();
            const r = run(() => $(o));

            sub = new Subscription();
            sub.add(r.subscribe(observer));
            sub.add(r.subscribe(observer2));
            expect(observer.complete).not.toBeCalled();
            expect(observer2.complete).not.toBeCalled();

            os[0].complete();
            expect(observer.complete).toBeCalled();
            expect(observer2.complete).not.toBeCalled();

            os[1].complete();
            expect(observer.complete).toBeCalled();
            expect(observer2.complete).toBeCalled();
        });

        it('subscriptions error out independently', () => {
            let counter = 0;
            const os = [new BehaviorSubject(1), new BehaviorSubject(2)];
            const o = defer(() => os[counter++]);
            const observer2 = makeObserver();
            const r = run(() => $(o));

            sub = new Subscription();
            sub.add(r.subscribe(observer));
            sub.add(r.subscribe(observer2));
            expect(observer.error).not.toBeCalled();
            expect(observer2.error).not.toBeCalled();

            os[0].error('First error');
            expect(observer.error).toBeCalledWith('First error');
            expect(observer2.error).not.toBeCalled();

            os[1].error('Second error');
            expect(observer.error).toBeCalledWith('First error');
            expect(observer2.error).toBeCalledWith('Second error');
        });
    });

    describe('branching', () => {
        describe('tracking', () => {
            it('untracks a dep when not tracked any longer due to branching', () => {
                const o = new BehaviorSubject(1);
                const o2 = new BehaviorSubject(2);
                let counter = 0;
                const r = run(() => {
                    ++counter;
                    _(o2); // Make o2 strong so it stays subscribed
                    // When o is odd, o2 is tracked
                    // When o is even, o2 is not tracked (but still observed/subscribed)
                    return ($(o) % 2) ? $(o2) : -1;
                });
                sub = r.subscribe(observer);

                expect(observer.next).toBeCalledWith(2);
                expect(counter).toEqual(1);

                o2.next(3); // o2 is tracked, so new value expected
                expect(observer.next).toBeCalledWith(3);
                expect(counter).toEqual(2);

                o.next(2); // o2 now becomes untracked cause o is even
                expect(observer.next).toBeCalledWith(-1);
                expect(counter).toEqual(3);

                o2.next(4); // o2 is not tracked, so no effect.
                expect(observer.next).toBeCalledWith(-1);
                expect(counter).toEqual(3);

                o.next(1); // o2 now becomes tracked again
                expect(observer.next).toBeCalledWith(4);
                expect(counter).toEqual(4);

                o2.next(10); // o2 is tracked again, so new value expected
                expect(observer.next).toBeCalledWith(10);
                expect(counter).toEqual(5);
            });

            it('untracks a dep when it becomes unreachable due to late subscription', () => {
                let counter = 0;
                // o is the discriminator. It determines whether o3 is observed
                const o  = new BehaviorSubject(0);
                // o2 is the indicator. It indicates whether it is tracked or not
                const o2 = new BehaviorSubject(1);
                // o3 is the late emitter. It doesn't emit immediately
                const o3 = new Subject<number>();
                const r = run(() => {
                    ++counter;
                    _(o2);
                    const n = $(o) % 2 ? $(o3) : -1;
                    return n + $(o2);
                });
                sub = r.subscribe(observer);

                // o3 not subscribed yet. No problem.
                expect(observer.next).toBeCalledWith(0); // -1 + 1
                expect(counter).toEqual(1);

                // o2 is tracked
                o2.next(2);
                expect(observer.next).toBeCalledWith(1); // -1 + 2
                expect(counter).toEqual(2);

                // Will start to observe late emitter o3 now.
                // It doesn't have a value yet so the expression will be aborted.
                // o2 will be untracked now because its value change doesn't change
                // the outcome of the expression.
                o.next(1);
                expect(observer.next).toBeCalledWith(1); // No change
                expect(counter).toEqual(3);

                // o2 is not tracked so won't run the expression
                o2.next(3);
                expect(observer.next).toBeCalledWith(1); // No change
                expect(counter).toEqual(3); // Same as before

                // o3 now has a value, so o2 will be tracked and it's new value (3)
                // will be used.
                o3.next(1);
                expect(observer.next).toBeCalledWith(4); // 1 (o3) + 3 (o2)
                expect(counter).toEqual(4);

                // o2 is tracked again
                o2.next(4);
                expect(observer.next).toBeCalledWith(5); // 1 (o3) + 4 (o2)
                expect(counter).toEqual(5);
            });
        });

        describe('strength', () => {
            let isO2Subscribed: boolean;
            let counter: number;
            let o: BehaviorSubject<number>;
            let o2: Observable<number>;
            let o2_next: (n: number) => void;
            let o3: Subject<number>;

            beforeEach(() => {
                isO2Subscribed = false;
                counter = 0;
                o = new BehaviorSubject(1);
                o2_next  = _ => {};
                o2 = new Observable<number>(obs => {
                    isO2Subscribed = true;
                    obs.next(1);
                    o2_next = obs.next.bind(obs);
                    return () => isO2Subscribed = false;
                });
                o3 = new Subject<number>();
            });

            it('unsubscribes a dep when it is not relevant any longer due to branching', () => {
                const r = run(() => {
                    ++counter;
                    // When o is odd, o2 is tracked
                    // When o is even, o2 is not tracked and should be unsubscribed
                    return $(o) % 2 ? $(o2) : -1;
                });
                sub = r.subscribe(observer);

                expect(observer.next).toBeCalledWith(1);
                expect(counter).toEqual(1);
                expect(isO2Subscribed).toBeTruthy();

                // Becomes unused, so will be unsubscribed.
                o.next(2);
                expect(observer.next).toBeCalledWith(-1);
                expect(counter).toEqual(2);
                expect(isO2Subscribed).toBeFalsy();

                // Becomes used again, so will be subscribed.
                o.next(1);
                expect(observer.next).toBeCalledWith(1);
                expect(counter).toEqual(3);
                expect(isO2Subscribed).toBeTruthy();
            });

            it('doesn\'t unsubscribes a dep when it becomes unreachable due to late subscription', () => {
                // o is the discriminator. It determines whether o3 is observed
                // o2 is the detector. It detects whether it is observed or not
                // o3 is the late emitter. It doesn't emit immediately
                o.next(0);
                const r = run(() => {
                    ++counter;
                    const n = $(o) % 2 ? $(o3) : -1;
                    return n + $(o2);
                });
                sub = r.subscribe(observer);

                // o3 not subscribed yet. No problem.
                expect(observer.next).toBeCalledWith(0); // -1 + 1
                expect(counter).toEqual(1);
                expect(isO2Subscribed).toBeTruthy();

                // Will start to observe late emitter o3 now.
                // Currently the spec says that by default, it should *not*
                // unsubscribe an observable when it becomes (temporary)
                // unreachable due to late subscription.
                o.next(1);
                expect(observer.next).toBeCalledWith(0); // No change
                expect(counter).toEqual(2);
                expect(isO2Subscribed).toBeTruthy(); // Still subscribed

                // But since a value change of o2, wouldn't currently have any
                // effect, it temporarily isn't tracked.
                o2_next(2);
                expect(observer.next).toBeCalledWith(0); // No change
                expect(counter).toEqual(2); // also no change
                expect(isO2Subscribed).toBeTruthy(); // Still subscribed

                // o3 now has a value, so o2 will be tracked again. It's newly
                // acquired value (2) will be used.
                o3.next(1);
                expect(observer.next).toBeCalledWith(3); // 1 (o3) + 2 (o2)
                expect(counter).toEqual(3);
                expect(isO2Subscribed).toBeTruthy();

                // Will have effect now
                o2_next(3);
                expect(observer.next).toBeCalledWith(4); // 1 (o3) + 3 (o2)
                expect(counter).toEqual(4); // changed again
                expect(isO2Subscribed).toBeTruthy();
            });

            it('unsubscribes a weak dep when it becomes unreachable due to late subscription', () => {
                // o is the discriminator. It determines whether o3 is observed
                // o2 is the detector. It detects whether it is observed or not
                // o3 is the late emitter. It doesn't emit immediately
                o.next(0);
                const r = run(() => {
                    ++counter;
                    const n = $(o) % 2 ? $(o3) : -1;
                    return n + $.weak(o2); // weak tracking
                });
                sub = r.subscribe(observer);

                // o3 not subscribed yet. No problem.
                expect(observer.next).toBeCalledWith(0); // -1 + 1
                expect(counter).toEqual(1);
                expect(isO2Subscribed).toBeTruthy();

                // Will start to observe late emitter o3 now.
                // It doesn't have a value yet so the expression will be aborted.
                // Note that o2 will be unsubscribed now because it is weak. Note
                // that this is OK, because a new value in o2 would not be able to
                // change the outcome of the expression, so it becomes irrelevant.
                o.next(1);
                expect(observer.next).toBeCalledWith(0); // No change
                expect(counter).toEqual(2);
                expect(isO2Subscribed).toBeFalsy(); // Is now unsubscribed

                // Will abort again cause o3 still doesn't have a value
                o.next(3);
                expect(observer.next).toBeCalledWith(0); // No change
                expect(counter).toEqual(3);
                expect(isO2Subscribed).toBeFalsy(); // Still unsubscribed

                // o3 now has a value, so o2 will be subscribed again
                o3.next(1);
                expect(observer.next).toBeCalledWith(2); // 1 (o3) + 1 (o2)
                expect(counter).toEqual(4);
                expect(isO2Subscribed).toBeTruthy(); // Subscribed again
            });

            it('will ajust strength when dep used multiple times in different context', () => {
                const r = run(() => {
                    ++counter;
                    const n = $(o) % 2 ? $(o3) : $(o2); // always strongly bound in false case
                    return n
                        + $.weak(o2) // first weakly bound
                        + $(o2); // later strongly bound
                });
                sub = r.subscribe(observer);

                expect(observer.next).not.toBeCalled();
                expect(isO2Subscribed).toBeFalsy();

                o3.next(4);
                expect(observer.next).toBeCalledWith(6); // 4 (o3) + 1 (o2) + 1 (o2)
                expect(isO2Subscribed).toBeTruthy();

                // unsubscribes o3 so it needs to emit again later
                o.next(0);

                // Subscribes o3 again but it doesn't emit. So for o2 to be still subscribed
                // it needs to have 'normal' strength.
                o.next(1);
                expect(isO2Subscribed).toBeTruthy();
            });

            it('will bring back strength when normal dep not used anymore', () => {
                o.next(0);
                const r = run(() => {
                    ++counter;
                    switch($(o))
                    {
                    case 0: return $.weak(o2) + $(o2);
                    case 1: return $.weak(o2);
                    case 2: return $(o3) + $(o2);
                    }
                });
                sub = r.subscribe(observer);

                expect(isO2Subscribed).toBeTruthy();

                // Remains subscribed due to strongness 'normal'
                o.next(2);
                expect(isO2Subscribed).toBeTruthy();

                // It should now reduce its strength to 'weak', because
                // the 'normal' bound o2 is not used in a succeeded run.
                o.next(1);
                expect(isO2Subscribed).toBeTruthy();

                // Hence should now be unsubscribed.
                o.next(2);
                expect(isO2Subscribed).toBeFalsy();
            });
        });
    });

    describe('untracked with late emission', () => {
        it('always tracks a dep until it emits', () => {
            const o = new Subject<number>();
            const r = run(() => _(o));
            sub = r.subscribe(observer);

            // Waiting for a value of o...
            expect(observer.next).not.toBeCalled();
            expect(observer.complete).not.toBeCalled();

            // o receiving a value. Untracked so complete immediately
            o.next(3);
            expect(observer.next).toBeCalledWith(3);
            expect(observer.complete).toBeCalled();
        });

        it('will eventually start listening for tracked dep', () => {
            const o = new Subject<number>();
            const o2 = new BehaviorSubject(2);
            const r = run(() => _(o) + $(o2));
            sub = r.subscribe(observer);

            // Waiting for a value of o... o2 not observed yet.
            expect(observer.next).not.toBeCalled();

            // o receiving a value. Will listen to tracked o2 now.
            o.next(3);
            expect(observer.next).toBeCalledWith(5); // 3 (o) + 2 (o2)

            o2.next(1);
            expect(observer.next).toBeCalledWith(4); // 3 (o) + 1 (o2)
        });

        it('will only change on first value of untracked dep', () => {
            const o = new Subject<number>();
            const o2 = new BehaviorSubject(2);
            const r = run(() => $(o2) + _(o));
            sub = r.subscribe(observer);

            // Waiting for a value of o...
            expect(observer.next).not.toBeCalled();

            // o receiving first value.
            o.next(3);
            expect(observer.next).toBeCalledWith(5); // 3 (o) + 2 (o2)

            // o receiving second value. But untracked so expression not called.
            o.next(4);
            expect(observer.next).toBeCalledWith(5); // Not changed

            // o2 receives new value. Will use changed value of o now too.
            o2.next(6);
            expect(observer.next).toBeCalledWith(10); // 4 (o) + 6 (o2)
        });

        it('will complete anyway when untracked value completes before it emits', () => {
            const o = new Subject<number>();
            const r = run(() => _(o));
            sub = r.subscribe(observer);

            expect(observer.next).not.toBeCalled();
            expect(observer.complete).not.toBeCalled();

            o.complete();
            expect(observer.next).not.toBeCalled();
            expect(observer.complete).toBeCalled();
        });

        it('will not complete when untracked value completes before it emits when tracking other value', () => {
            const o = new Subject<number>();
            const o2 = new BehaviorSubject(2);
            const r = run(() => $(o2) + _(o));
            sub = r.subscribe(observer);

            expect(observer.next).not.toBeCalled();
            expect(observer.complete).not.toBeCalled();

            // o completes before it emits.
            // expression will not complete yet because it might be that a new value of o2
            // will branch around o.
            o.complete();
            expect(observer.next).not.toBeCalled();
            expect(observer.complete).not.toBeCalled();
        });
    });


    // TODO: cover logic branching w/ late subscription
});
