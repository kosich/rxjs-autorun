import { BehaviorSubject, defer, of, Subject, Subscription, throwError } from 'rxjs';
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
        expect(observer.next.mock.calls.length).toEqual(0);
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

    // TODO: cover logic branching w/ late subscription
});
